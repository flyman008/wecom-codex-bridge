import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { AgentName } from './types.js';

export type ConversationScope = 'single' | 'group';

export interface MemoryTurn {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

interface UserMemory {
  facts: string[];
  consecutiveOffTopic: number;
  lastSeenAt: string;
}

interface SessionMemory {
  userKey: string;
  scope: ConversationScope;
  recentTurns: MemoryTurn[];
  lastRoute?: AgentName;
  lastSeenAt: string;
}

interface PersistedRouterMemory {
  version: 1;
  users: Record<string, UserMemory>;
  sessions: Record<string, SessionMemory>;
}

export interface RouterMemoryLimits {
  recentTurnsPerSession: number;
  maxTurnCharacters: number;
  maxUserFacts: number;
  maxFactCharacters: number;
}

export interface RouterMemorySnapshot {
  facts: readonly string[];
  consecutiveOffTopic: number;
  recentTurns: readonly MemoryTurn[];
  lastRoute: AgentName | undefined;
}

function emptyMemory(): PersistedRouterMemory {
  return { version: 1, users: {}, sessions: {} };
}

function compactText(value: string, maxCharacters: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxCharacters);
}

function isPersistedMemory(value: unknown): value is PersistedRouterMemory {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 && Boolean(record.users) && Boolean(record.sessions);
}

export class RouterMemoryStore {
  private readonly filePath: string;
  private state: PersistedRouterMemory = emptyMemory();
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(path: string, private readonly limits: RouterMemoryLimits) {
    this.filePath = resolve(path);
  }

  static async open(path: string, limits: RouterMemoryLimits): Promise<RouterMemoryStore> {
    const store = new RouterMemoryStore(path, limits);
    await store.load();
    return store;
  }

  snapshot(userKey: string, sessionKey: string): RouterMemorySnapshot {
    const user = this.state.users[userKey];
    const session = this.state.sessions[sessionKey];
    return {
      facts: [...(user?.facts ?? [])],
      consecutiveOffTopic: user?.consecutiveOffTopic ?? 0,
      recentTurns: [...(session?.recentTurns ?? [])],
      lastRoute: session?.lastRoute,
    };
  }

  async recordUserTurn(
    userKey: string,
    sessionKey: string,
    scope: ConversationScope,
    content: string,
  ): Promise<void> {
    this.ensureUser(userKey);
    const session = this.ensureSession(userKey, sessionKey, scope);
    this.pushTurn(session, 'user', content);
    await this.persist();
  }

  async recordAssistantTurn(
    userKey: string,
    sessionKey: string,
    scope: ConversationScope,
    content: string,
    route: AgentName,
  ): Promise<void> {
    this.ensureUser(userKey);
    const session = this.ensureSession(userKey, sessionKey, scope);
    if (content.trim()) this.pushTurn(session, 'assistant', content);
    session.lastRoute = route;
    await this.persist();
  }

  async observeWorkRelated(userKey: string, workRelated: boolean): Promise<number> {
    const user = this.ensureUser(userKey);
    user.consecutiveOffTopic = workRelated ? 0 : user.consecutiveOffTopic + 1;
    user.lastSeenAt = new Date().toISOString();
    await this.persist();
    return user.consecutiveOffTopic;
  }

  async remember(userKey: string, note: string): Promise<void> {
    const fact = compactText(note, this.limits.maxFactCharacters);
    if (!fact) return;
    const user = this.ensureUser(userKey);
    user.facts = [fact, ...user.facts.filter((item) => item !== fact)].slice(
      0,
      this.limits.maxUserFacts,
    );
    user.lastSeenAt = new Date().toISOString();
    await this.persist();
  }

  async forgetUser(userKey: string): Promise<void> {
    delete this.state.users[userKey];
    for (const [sessionKey, session] of Object.entries(this.state.sessions)) {
      if (session.userKey === userKey) delete this.state.sessions[sessionKey];
    }
    await this.persist();
  }

  private ensureUser(userKey: string): UserMemory {
    const existing = this.state.users[userKey];
    if (existing) return existing;
    const created: UserMemory = {
      facts: [],
      consecutiveOffTopic: 0,
      lastSeenAt: new Date().toISOString(),
    };
    this.state.users[userKey] = created;
    return created;
  }

  private ensureSession(
    userKey: string,
    sessionKey: string,
    scope: ConversationScope,
  ): SessionMemory {
    const existing = this.state.sessions[sessionKey];
    if (existing) return existing;
    const created: SessionMemory = {
      userKey,
      scope,
      recentTurns: [],
      lastSeenAt: new Date().toISOString(),
    };
    this.state.sessions[sessionKey] = created;
    return created;
  }

  private pushTurn(session: SessionMemory, role: MemoryTurn['role'], content: string): void {
    const compact = compactText(content, this.limits.maxTurnCharacters);
    if (!compact) return;
    session.recentTurns.push({ role, content: compact, at: new Date().toISOString() });
    session.recentTurns = session.recentTurns.slice(-this.limits.recentTurnsPerSession);
    session.lastSeenAt = new Date().toISOString();
  }

  private async load(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!isPersistedMemory(parsed)) throw new Error('总管 Agent Memory 文件格式无效');
      this.state = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }

  private async persist(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(this.state, null, 2), 'utf8');
      await rename(temporaryPath, this.filePath);
    });
    await this.writeChain;
  }
}
