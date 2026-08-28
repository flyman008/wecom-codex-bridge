import {
  WSClient,
  generateReqId,
  type BaseMessage,
  type EventMessage,
  type FileContent,
  type FileMessage,
  type MixedMessage,
  type QuoteContent,
  type TextMessage,
  type VoiceMessage,
  type WsFrame,
} from '@wecom/aibot-node-sdk';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

import type { AppConfig } from './config.js';
import { conversionOperationFor } from './conversion-policy.js';
import { logger, privateLabel, sdkLogger } from './logger.js';
import { PendingConversionStore, PendingFileStore } from './pending-files.js';
import { RouterAgent } from './router-agent.js';
import { decideRoute, HELP_TEXT, normalizeIncomingText } from './router.js';
import {
  canDispatchFileToCodex,
  type SemanticRouteDecision,
} from './semantic-router.js';
import { TaskRegistry } from './task-registry.js';
import type {
  AgentAdapter,
  AgentAttachment,
  AgentName,
  AgentOperation,
} from './types.js';
import { errorMessage, UserFacingError } from './utils.js';
import { WeComStreamResponder } from './wecom-stream.js';

function quoteText(quote?: QuoteContent): string | undefined {
  if (!quote) return undefined;
  if (quote.text?.content) return quote.text.content;
  if (quote.voice?.content) return quote.voice.content;
  if (quote.mixed?.msg_item) {
    const parts = quote.mixed.msg_item
      .map((item) => item.text?.content ?? (item.image ? '[引用图片]' : ''))
      .filter(Boolean);
    return parts.join('\n');
  }
  if (quote.image) return '[引用图片]';
  if (quote.file) return '[引用文件]';
  return undefined;
}

function mixedText(message: MixedMessage): string {
  return message.mixed.msg_item
    .map((item) => item.text?.content ?? (item.image ? '[图片]' : ''))
    .filter(Boolean)
    .join('\n');
}

export class WeComAgentService {
  readonly client: WSClient;
  private readonly registry: TaskRegistry;
  private readonly controllers = new Set<AbortController>();
  private readonly conversionSessions = new Set<string>();
  private readonly pendingFiles: PendingFileStore;
  private readonly pendingConversions: PendingConversionStore;

  constructor(
    private readonly config: AppConfig,
    private readonly agents: Map<AgentName, AgentAdapter>,
    private readonly routerAgent: RouterAgent,
  ) {
    this.registry = new TaskRegistry(config.router.maxActiveTasksPerUser);
    this.pendingFiles = new PendingFileStore(config.documents);
    this.pendingConversions = new PendingConversionStore(config.documents.attachmentTtlMs);
    this.client = new WSClient({
      botId: config.wecom.botId,
      secret: config.wecom.secret,
      heartbeatInterval: config.wecom.heartbeatIntervalMs,
      maxReconnectAttempts: config.wecom.maxReconnectAttempts,
      maxAuthFailureAttempts: 3,
      logger: sdkLogger,
    });
    this.bindEvents();
  }

  start(): void {
    this.client.connect();
  }

  stop(): void {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.client.disconnect();
  }

  get isConnected(): boolean {
    return this.client.isConnected;
  }

  get activeTasks(): number {
    return this.registry.activeTasks;
  }

  private bindEvents(): void {
    this.client.on('connected', () => logger.info('企微长连接已建立'));
    this.client.on('authenticated', () => logger.info('企微机器人认证成功'));
    this.client.on('disconnected', (reason) => logger.warn('企微长连接已断开', { reason }));
    this.client.on('reconnecting', (attempt) => logger.warn('企微长连接正在重连', { attempt }));
    this.client.on('error', (error) => logger.error('企微 SDK 错误', error));

    this.client.on('event.enter_chat', (frame) => {
      void this.client
        .replyWelcome(frame, {
          msgtype: 'text',
          text: { content: `嗨，我在。问题直接说，文档也可以交给我转成企微在线文档。\n\n${HELP_TEXT}` },
        })
        .catch((error) => logger.error('欢迎语发送失败', error));
    });

    this.client.on('message.text', (frame) => {
      void this.handleText(frame).catch((error) => logger.error('文本消息处理失败', error));
    });
    this.client.on('message.voice', (frame) => {
      void this.handleVoice(frame).catch((error) => logger.error('语音消息处理失败', error));
    });
    this.client.on('message.mixed', (frame) => {
      void this.handleMixed(frame).catch((error) => logger.error('图文消息处理失败', error));
    });
    this.client.on('message.image', (frame) => void this.replyUnsupported(frame, '图片'));
    this.client.on('message.file', (frame) => {
      void this.handleFile(frame).catch((error) => logger.error('文件消息处理失败', error));
    });
    this.client.on('message.video', (frame) => void this.replyUnsupported(frame, '视频'));

    this.client.on('event.template_card_event', (frame) => {
      const event = frame.body?.event;
      logger.info('收到模板卡片交互', { event: event?.event_key ?? 'unknown' });
    });
  }

  private async handleText(frame: WsFrame<TextMessage>): Promise<void> {
    const body = frame.body;
    if (!body) return;
    const text = normalizeIncomingText(body.text.content, body.chattype === 'group');
    await this.handlePrompt(frame, body, text);
  }

  private async handleVoice(frame: WsFrame<VoiceMessage>): Promise<void> {
    const body = frame.body;
    if (!body) return;
    const text = normalizeIncomingText(body.voice.content, body.chattype === 'group');
    await this.handlePrompt(frame, body, text);
  }

  private async handleMixed(frame: WsFrame<MixedMessage>): Promise<void> {
    const body = frame.body;
    if (!body) return;
    const text = normalizeIncomingText(mixedText(body), body.chattype === 'group');
    await this.handlePrompt(frame, body, text);
  }

  private sessionKey(body: BaseMessage): string {
    const actorKey = body.from.userid;
    const conversationKey = body.chattype === 'group' ? body.chatid : actorKey;
    return `${body.chattype}:${conversationKey ?? 'unknown'}:${actorKey}`;
  }

  private async downloadAndStore(
    sessionKey: string,
    file: FileContent,
  ): Promise<import('./types.js').AgentAttachment> {
    const downloaded = await this.client.downloadFile(file.url, file.aeskey);
    return this.pendingFiles.store(sessionKey, downloaded.buffer, downloaded.filename);
  }

  private async handleFile(frame: WsFrame<FileMessage>): Promise<void> {
    const body = frame.body;
    if (!body) return;
    const actorKey = body.from.userid;
    const begin = this.registry.begin(body.msgid, actorKey);
    if (begin === 'duplicate') return;
    if (begin === 'busy') {
      await this.replyDirect(frame, '先等我一下呀，你已有3个任务在处理，完成一个我就继续。');
      return;
    }

    const sessionKey = this.sessionKey(body);
    const controller = new AbortController();
    this.controllers.add(controller);

    try {
      const attachment = await this.downloadAndStore(sessionKey, body.file);
      logger.info('企微文档附件已暂存', {
        extension: attachment.extension,
        sizeBytes: attachment.sizeBytes,
      });
      const pendingConversion = this.pendingConversions.get(sessionKey);
      if (pendingConversion) {
        await this.executeAgent(
          frame,
          body,
          this.agents.get('codex'),
          pendingConversion.prompt,
          sessionKey,
          controller,
          {
            attachment,
            operation: conversionOperationFor(attachment),
            quotedContext: pendingConversion.quotedContext,
          },
        );
      } else {
        await this.replyDirect(
          frame,
          `文件收到了：“${attachment.fileName}”。想生成对应的企微在线文档或表格，15分钟内告诉我“生成企微在线文档”就好。`,
        );
      }
    } catch (error) {
      logger.error('企微文档附件暂存失败', error);
      await this.replyDirect(frame, this.friendlyAttachmentError(error));
    } finally {
      controller.abort();
      this.controllers.delete(controller);
      this.registry.finish(actorKey);
    }
  }

  private async handlePrompt<T extends BaseMessage>(
    frame: WsFrame<T>,
    body: T,
    text: string,
  ): Promise<void> {
    const actorKey = body.from.userid;
    const messageKey = body.msgid;
    const begin = this.registry.begin(messageKey, actorKey);
    if (begin === 'duplicate') return;
    if (begin === 'busy') {
      await this.replyDirect(frame, '先等我一下呀，你已有3个任务在处理，完成一个我就继续。');
      return;
    }

    const sessionKey = this.sessionKey(body);
    const label = privateLabel(sessionKey);
    const controller = new AbortController();
    this.controllers.add(controller);

    try {
      const directToCodex = this.config.router.mode === 'codex_all';
      let route = directToCodex
        ? { agent: 'codex' as const, prompt: text }
        : decideRoute(text, this.config.router.defaultAgent);
      if (route.directReply) {
        await this.replyDirect(frame, route.directReply);
        return;
      }

      let attachment = await this.pendingFiles.get(sessionKey);
      let semanticDecision: SemanticRouteDecision | undefined;
      let focusReminder: string | undefined;
      let personaPrompt = this.routerAgent.personaPrompt;
      let memoryContext: string | undefined;
      let suppressAssistantMemory = false;
      let operation: AgentOperation | undefined;
      const scope = body.chattype === 'group' ? 'group' : 'single';
      const requiresAutomaticRouting = route.requiresSemanticRouting === true;
      if (!directToCodex && (requiresAutomaticRouting || route.agent === 'llm')) {
        try {
          const routerTurn = await this.routerAgent.decide(
            {
              actorKey,
              sessionKey,
              scope,
              text,
              ...(attachment
                ? {
                    attachment: {
                      fileName: attachment.fileName,
                      extension: attachment.extension,
                      sizeBytes: attachment.sizeBytes,
                    },
                  }
                : {}),
            },
            controller.signal,
          );
          semanticDecision = routerTurn.decision;
          focusReminder = routerTurn.focusReminder;
          personaPrompt = routerTurn.personaPrompt;
          memoryContext = routerTurn.memoryContext;
          suppressAssistantMemory = routerTurn.suppressAssistantMemory;
        } catch (error) {
          logger.warn('火山路由判断失败，已按非 Codex 路由处理', {
            error: errorMessage(error),
            session: label,
          });
        }
      } else if (route.agent === 'local') {
        const knownTurn = await this.routerAgent.prepareKnownWorkTurn({
          actorKey,
          sessionKey,
          scope,
          text,
          ...(attachment
            ? {
                attachment: {
                  fileName: attachment.fileName,
                  extension: attachment.extension,
                  sizeBytes: attachment.sizeBytes,
                },
              }
            : {}),
        });
        personaPrompt = knownTurn.personaPrompt;
        memoryContext = knownTurn.memoryContext;
      }

      if (requiresAutomaticRouting) {
        const wantsFileConversion =
          semanticDecision?.intent === 'file_to_wecom' &&
          semanticDecision.confidence >= this.config.router.codexConfidenceThreshold;
        if (wantsFileConversion && !attachment) {
          attachment = await this.pendingFiles.get(sessionKey);
        }
        if (wantsFileConversion && !attachment && body.quote?.file) {
          try {
            attachment = await this.downloadAndStore(sessionKey, body.quote.file);
          } catch (error) {
            await this.replyDirect(frame, `引用的文件没下载好，请重新发一次。`);
            return;
          }
        }

        if (wantsFileConversion && !attachment) {
          this.pendingConversions.set(sessionKey, {
            prompt: text,
            quotedContext: quoteText(body.quote),
          });
          attachment = await this.pendingFiles.get(sessionKey);
          if (!attachment) {
            await this.replyDirect(
              frame,
              '好，我等你的文件。15分钟内发过来，收到后我会自动开始。',
            );
            return;
          }
        }

        if (
          semanticDecision &&
          canDispatchFileToCodex(
            semanticDecision,
            attachment,
            this.config.router.codexConfidenceThreshold,
          )
        ) {
          route = { agent: 'codex', prompt: text };
          operation = conversionOperationFor(attachment);
        } else {
          route = { agent: this.config.router.defaultAgent, prompt: text };
        }
      }

      const agent = route.agent ? this.agents.get(route.agent) : undefined;
      await this.executeAgent(frame, body, agent, route.prompt, sessionKey, controller, {
        ...(attachment ? { attachment } : {}),
        ...(operation ? { operation } : {}),
        quotedContext: quoteText(body.quote),
        ...(focusReminder ? { completionSuffix: focusReminder } : {}),
        personaPrompt,
        ...(memoryContext ? { memoryContext } : {}),
        suppressAssistantMemory,
      });
    } finally {
      controller.abort();
      this.controllers.delete(controller);
      this.registry.finish(actorKey);
    }
  }

  private async executeAgent<T extends BaseMessage>(
    frame: WsFrame<T>,
    body: T,
    agent: AgentAdapter | undefined,
    prompt: string,
    sessionKey: string,
    controller: AbortController,
    context: {
      attachment?: AgentAttachment;
      operation?: AgentOperation;
      quotedContext: string | undefined;
      completionSuffix?: string;
      personaPrompt?: string;
      memoryContext?: string;
      suppressAssistantMemory?: boolean;
    },
  ): Promise<boolean> {
    if (!agent) {
      await this.replyDirect(frame, '这项能力还没准备好，先换个任务吧。');
      return false;
    }
    if (!agent.isAvailable()) {
      await this.replyDirect(frame, agent.unavailableReason());
      return false;
    }

    const conversionOperation = agent.name === 'codex' ? context.operation : undefined;
    const isFileConversion = Boolean(conversionOperation);
    if (isFileConversion && this.conversionSessions.has(sessionKey)) {
      await this.replyDirect(frame, '已经在转啦，稍等我一下。');
      return false;
    }
    if (isFileConversion) this.conversionSessions.add(sessionKey);

    const target = body.chattype === 'group' ? body.chatid : body.from.userid;
    const label = privateLabel(sessionKey);
    const responder = new WeComStreamResponder(this.client, frame, generateReqId('stream'), {
      flushMs: this.config.router.streamFlushMs,
      timeoutMs: this.config.router.streamTimeoutMs,
      ...(target ? { proactiveTarget: target } : {}),
    });

    try {
      logger.info('开始处理企微任务', { session: label, agent: agent.name });
      await responder.open(
        conversionOperation === 'spreadsheet_to_wecom'
          ? '表格收到了，正在生成企微普通在线表格…'
          : conversionOperation === 'document_to_wecom'
            ? '文件收到了，正在生成企微普通在线文档…'
            : '我来看看…',
      );
      let assistantOutput = '';
      const generatedImages: string[] = [];
      for await (const event of agent.run({
        prompt,
        quotedContext: context.quotedContext,
        ...(context.personaPrompt ? { personaPrompt: context.personaPrompt } : {}),
        ...(context.memoryContext ? { memoryContext: context.memoryContext } : {}),
        sessionKey,
        signal: controller.signal,
        ...(conversionOperation ? { operation: conversionOperation } : {}),
        ...(context.attachment ? { attachments: [context.attachment] } : {}),
      })) {
        if (event.kind === 'image') {
          if (!generatedImages.includes(event.filePath)) generatedImages.push(event.filePath);
          continue;
        }
        if (event.kind === 'delta') assistantOutput += event.text;
        else if (event.kind === 'replace') assistantOutput = event.text;
        await responder.update(event);
      }
      if (context.completionSuffix) {
        assistantOutput += `${assistantOutput ? '\n\n' : ''}${context.completionSuffix}`;
        await responder.update({ kind: 'delta', text: `\n\n${context.completionSuffix}` });
      }
      await responder.complete();
      for (const imagePath of generatedImages) {
        await this.sendGeneratedImage(target, imagePath, label);
      }
      if (this.config.router.mode !== 'codex_all') {
        await this.routerAgent
          .recordAssistant(
            body.from.userid,
            sessionKey,
            body.chattype === 'group' ? 'group' : 'single',
            assistantOutput,
            agent.name,
            context.suppressAssistantMemory ?? false,
          )
          .catch((error) =>
            logger.warn('总管 Agent Memory 写入失败', {
              error: errorMessage(error),
              session: label,
            }),
          );
      }
      if (isFileConversion) {
        this.pendingConversions.remove(sessionKey);
        await this.pendingFiles
          .remove(sessionKey)
          .catch((error) => logger.warn('文档暂存目录清理失败', { error: errorMessage(error) }));
      }
      logger.info('企微任务处理完成', { session: label, agent: agent.name });
      return true;
    } catch (error) {
      logger.error('Agent 处理失败', error, { session: label, agent: agent.name });
      if (error instanceof UserFacingError) {
        await responder.fail(error.userMessage, true);
      } else {
        await responder.fail('稍后再试一次吧。');
      }
      return false;
    } finally {
      if (isFileConversion) this.conversionSessions.delete(sessionKey);
    }
  }

  private async replyDirect(frame: WsFrame<unknown>, content: string): Promise<void> {
    await this.client.replyStream(frame, generateReqId('stream'), content, true);
  }

  private async sendGeneratedImage(
    target: string | undefined,
    filePath: string,
    sessionLabel: string,
  ): Promise<void> {
    if (!target) throw new Error('无法确定图片应发送到哪个企微会话');
    const metadata = await stat(filePath);
    if (!metadata.isFile()) throw new Error('Codex 返回的图片路径不是文件');
    if (metadata.size > 50 * 1024 * 1024) throw new Error('Codex 生成的图片超过企微上传限制');

    const upload = await this.client.uploadMedia(await readFile(filePath), {
      type: 'image',
      filename: basename(filePath),
    });
    await this.client.sendMediaMessage(target, 'image', upload.media_id);
    logger.info('Codex 图片已发送至企微会话', {
      session: sessionLabel,
      sizeBytes: metadata.size,
    });
  }

  private async replyUnsupported(frame: WsFrame<unknown>, type: string): Promise<void> {
    try {
      await this.replyDirect(frame, `这个${type}我暂时看不了，发文字或语音转写给我吧。`);
    } catch (error) {
      logger.error('不支持消息类型提示发送失败', error, { type });
    }
  }

  private friendlyAttachmentError(error: unknown): string {
    const message = errorMessage(error);
    if (message.includes('文件超过大小限制') || message.includes('暂不支持该文件类型')) {
      return message;
    }
    return '文件没收好，请重新发一次。';
  }
}
