import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { AppConfig } from './config.js';
import {
  type ConversationScope,
  RouterMemoryStore,
  type RouterMemorySnapshot,
} from './router-memory.js';
import {
  type SemanticRouteDecision,
  VolcanoSemanticRouter,
} from './semantic-router.js';
import type { AgentAttachment, AgentName } from './types.js';

interface RouterAgentProfile {
  version: 1;
  name: string;
  personaPrompt: string;
  offTopicReminder: string;
  offTopicReminderThreshold: number;
  memory: {
    recentTurnsPerSession: number;
    maxTurnCharacters: number;
    maxUserFacts: number;
    maxFactCharacters: number;
  };
}

export interface RouterAgentInput {
  actorKey: string;
  sessionKey: string;
  scope: ConversationScope;
  text: string;
  attachment?: Pick<AgentAttachment, 'fileName' | 'extension' | 'sizeBytes'>;
}

export interface RouterAgentTurn {
  decision: SemanticRouteDecision;
  personaPrompt: string;
  memoryContext: string | undefined;
  focusReminder: string | undefined;
  suppressAssistantMemory: boolean;
}

export interface KnownRouteTurn {
  personaPrompt: string;
  memoryContext: string | undefined;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function parseProfile(value: unknown): RouterAgentProfile {
  if (!value || typeof value !== 'object') throw new Error('总管 Agent 人设文件不是对象');
  const record = value as Record<string, unknown>;
  const memory = record.memory as Record<string, unknown> | undefined;
  if (
    record.version !== 1 ||
    typeof record.name !== 'string' ||
    !record.name.trim() ||
    typeof record.personaPrompt !== 'string' ||
    !record.personaPrompt.trim() ||
    typeof record.offTopicReminder !== 'string' ||
    !nonNegativeInteger(record.offTopicReminderThreshold) ||
    (record.offTopicReminderThreshold > 0 && !record.offTopicReminder.trim()) ||
    !memory ||
    !positiveInteger(memory.recentTurnsPerSession) ||
    !positiveInteger(memory.maxTurnCharacters) ||
    !positiveInteger(memory.maxUserFacts) ||
    !positiveInteger(memory.maxFactCharacters)
  ) {
    throw new Error('总管 Agent 人设文件字段无效');
  }
  return {
    version: 1,
    name: record.name.trim(),
    personaPrompt: record.personaPrompt.trim(),
    offTopicReminder: record.offTopicReminder.trim(),
    offTopicReminderThreshold: record.offTopicReminderThreshold,
    memory: {
      recentTurnsPerSession: memory.recentTurnsPerSession,
      maxTurnCharacters: memory.maxTurnCharacters,
      maxUserFacts: memory.maxUserFacts,
      maxFactCharacters: memory.maxFactCharacters,
    },
  };
}

function formatMemory(snapshot: RouterMemorySnapshot): string | undefined {
  const lines: string[] = [];
  if (snapshot.facts.length) {
    lines.push('用户明确要求记住的信息：');
    lines.push(...snapshot.facts.map((fact) => `- ${fact}`));
  }
  if (snapshot.recentTurns.length) {
    if (lines.length) lines.push('');
    lines.push('当前会话最近内容：');
    lines.push(
      ...snapshot.recentTurns.map((turn) =>
        `${turn.role === 'user' ? '用户' : '助手'}：${turn.content}`,
      ),
    );
  }
  if (snapshot.lastRoute) {
    if (lines.length) lines.push('');
    lines.push(`上一次处理类型：${snapshot.lastRoute}`);
  }
  return lines.length ? lines.join('\n') : undefined;
}

export class RouterAgent {
  private constructor(
    private readonly profile: RouterAgentProfile,
    private readonly memory: RouterMemoryStore,
    private readonly semanticRouter: VolcanoSemanticRouter,
    private readonly keySalt: string,
  ) {}

  static async create(
    config: AppConfig['routerAgent'],
    semanticRouter: VolcanoSemanticRouter,
    keySalt: string,
  ): Promise<RouterAgent> {
    const profile = parseProfile(JSON.parse(await readFile(config.profilePath, 'utf8')));
    const memory = await RouterMemoryStore.open(config.memoryPath, profile.memory);
    return new RouterAgent(profile, memory, semanticRouter, keySalt);
  }

  get name(): string {
    return this.profile.name;
  }

  get personaPrompt(): string {
    return this.profile.personaPrompt;
  }

  async decide(input: RouterAgentInput, signal: AbortSignal): Promise<RouterAgentTurn> {
    const keys = this.keys(input.actorKey, input.sessionKey);
    const previousMemory = this.memory.snapshot(keys.user, keys.session);
    const previousMemoryContext = formatMemory(previousMemory);
    const decision = await this.semanticRouter.decide(
      {
        text: input.text,
        ...(input.attachment ? { attachment: input.attachment } : {}),
        ...(previousMemoryContext ? { memoryContext: previousMemoryContext } : {}),
      },
      signal,
    );

    let suppressAssistantMemory = false;
    let offTopicCount = 0;
    if (decision.memoryAction === 'forget_all') {
      await this.memory.forgetUser(keys.user);
      suppressAssistantMemory = true;
    } else {
      if (decision.memoryAction === 'remember' && decision.memoryNote) {
        await this.memory.remember(keys.user, decision.memoryNote);
      }
      offTopicCount = await this.memory.observeWorkRelated(keys.user, decision.workRelated);
    }

    const replyMemory = formatMemory(this.memory.snapshot(keys.user, keys.session));
    if (!suppressAssistantMemory) {
      await this.memory.recordUserTurn(keys.user, keys.session, input.scope, input.text);
    }

    return {
      decision,
      personaPrompt: this.profile.personaPrompt,
      memoryContext: replyMemory,
      focusReminder:
        !decision.workRelated &&
        this.profile.offTopicReminderThreshold > 0 &&
        offTopicCount >= this.profile.offTopicReminderThreshold
          ? this.profile.offTopicReminder
          : undefined,
      suppressAssistantMemory,
    };
  }

  async prepareKnownWorkTurn(input: RouterAgentInput): Promise<KnownRouteTurn> {
    const keys = this.keys(input.actorKey, input.sessionKey);
    const memoryContext = formatMemory(this.memory.snapshot(keys.user, keys.session));
    await this.memory.observeWorkRelated(keys.user, true);
    await this.memory.recordUserTurn(keys.user, keys.session, input.scope, input.text);
    return { personaPrompt: this.profile.personaPrompt, memoryContext };
  }

  async recordAssistant(
    actorKey: string,
    sessionKey: string,
    scope: ConversationScope,
    content: string,
    route: AgentName,
    suppress = false,
  ): Promise<void> {
    if (suppress) return;
    const keys = this.keys(actorKey, sessionKey);
    await this.memory.recordAssistantTurn(keys.user, keys.session, scope, content, route);
  }

  private keys(actorKey: string, sessionKey: string): { user: string; session: string } {
    return {
      user: createHmac('sha256', this.keySalt).update(`user:${actorKey}`).digest('hex'),
      session: createHmac('sha256', this.keySalt).update(`session:${sessionKey}`).digest('hex'),
    };
  }
}
