import type { WSClient, WsFrameHeaders } from '@wecom/aibot-node-sdk';

import type { AgentEvent } from './types.js';
import { truncateUtf8 } from './utils.js';

interface StreamOptions {
  flushMs: number;
  timeoutMs: number;
  proactiveTarget?: string;
}

export class WeComStreamResponder {
  private output = '';
  private status = '正在处理…';
  private lastSentAt = 0;
  private streamClosed = false;
  private sendChain: Promise<void> = Promise.resolve();
  private detachTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly client: WSClient,
    private readonly frame: WsFrameHeaders,
    private readonly streamKey: string,
    private readonly options: StreamOptions,
  ) {}

  async open(message: string): Promise<void> {
    this.status = message;
    await this.enqueue(async () => {
      await this.client.replyStream(this.frame, this.streamKey, this.render(), false);
    });
    this.lastSentAt = Date.now();
    this.detachTimer = setTimeout(() => void this.detach(), this.options.timeoutMs);
  }

  async update(event: AgentEvent): Promise<void> {
    if (event.kind === 'image') return;
    if (event.kind === 'delta') this.output += event.text;
    else if (event.kind === 'replace') this.output = event.text;
    else this.status = event.text;

    if (this.streamClosed || Date.now() - this.lastSentAt < this.options.flushMs) return;
    await this.enqueue(async () => {
      await this.client.replyStreamNonBlocking(this.frame, this.streamKey, this.render(), false);
    });
    this.lastSentAt = Date.now();
  }

  async complete(): Promise<void> {
    this.clearTimer();
    const content = this.render('搞定了。');
    if (this.streamClosed) {
      await this.sendProactive(content);
      return;
    }

    this.streamClosed = true;
    await this.enqueue(async () => {
      await this.client.replyStream(this.frame, this.streamKey, content, true);
    });
  }

  async fail(errorText: string, exact = false): Promise<void> {
    this.clearTimer();
    const content = truncateUtf8(exact ? errorText : `这次没处理好：${errorText}`, 19_500);
    if (this.streamClosed) {
      await this.sendProactive(content);
      return;
    }

    this.streamClosed = true;
    await this.enqueue(async () => {
      await this.client.replyStream(this.frame, this.streamKey, content, true);
    });
  }

  private async detach(): Promise<void> {
    if (this.streamClosed) return;
    this.streamClosed = true;
    const content = this.render('还在处理，做好后我会告诉你。');
    await this.enqueue(async () => {
      await this.client.replyStream(this.frame, this.streamKey, content, true);
    });
  }

  private async sendProactive(content: string): Promise<void> {
    if (!this.options.proactiveTarget) return;
    await this.client.sendMessage(this.options.proactiveTarget, {
      msgtype: 'markdown',
      markdown: { content },
    });
  }

  private render(emptyFallback?: string): string {
    return truncateUtf8(this.output || emptyFallback || this.status || '正在处理…', 19_500);
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.sendChain.then(operation, operation);
    this.sendChain = next.catch(() => undefined);
    return next;
  }

  private clearTimer(): void {
    if (this.detachTimer) clearTimeout(this.detachTimer);
    this.detachTimer = undefined;
  }
}
