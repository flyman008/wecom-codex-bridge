import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

interface StoredSession {
  threadId: string;
  updatedAt: string;
  inputTokens?: number;
}

interface PersistedSessions {
  version: 1;
  sessions: Record<string, StoredSession>;
}

function emptyState(): PersistedSessions {
  return { version: 1, sessions: {} };
}

function validThreadId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function parseState(value: unknown): PersistedSessions {
  if (!value || typeof value !== 'object') throw new Error('Codex 会话映射文件格式无效');
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !record.sessions || typeof record.sessions !== 'object') {
    throw new Error('Codex 会话映射文件格式无效');
  }
  const sessions: Record<string, StoredSession> = {};
  for (const [key, raw] of Object.entries(record.sessions as Record<string, unknown>)) {
    if (!/^[0-9a-f]{64}$/i.test(key) || !raw || typeof raw !== 'object') continue;
    const session = raw as Record<string, unknown>;
    if (!validThreadId(session.threadId) || typeof session.updatedAt !== 'string') continue;
    sessions[key] = {
      threadId: session.threadId,
      updatedAt: session.updatedAt,
      ...(typeof session.inputTokens === 'number' &&
      Number.isInteger(session.inputTokens) &&
      session.inputTokens >= 0
        ? { inputTokens: session.inputTokens }
        : {}),
    };
  }
  return { version: 1, sessions };
}

export class CodexSessionStore {
  private state = emptyState();
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(private readonly filePath: string) {}

  static async open(filePath: string): Promise<CodexSessionStore> {
    const store = new CodexSessionStore(filePath);
    try {
      store.state = parseState(JSON.parse(await readFile(filePath, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return store;
  }

  get(sessionKey: string): string | undefined {
    return this.state.sessions[this.key(sessionKey)]?.threadId;
  }

  getInfo(sessionKey: string): Readonly<StoredSession> | undefined {
    const session = this.state.sessions[this.key(sessionKey)];
    return session ? { ...session } : undefined;
  }

  async set(sessionKey: string, threadId: string): Promise<void> {
    if (!validThreadId(threadId)) throw new Error('Codex 返回了无效的会话 ID');
    const current = this.state.sessions[this.key(sessionKey)];
    this.state.sessions[this.key(sessionKey)] = {
      threadId,
      updatedAt: new Date().toISOString(),
      ...(current?.threadId === threadId && current.inputTokens !== undefined
        ? { inputTokens: current.inputTokens }
        : {}),
    };
    await this.persist();
  }

  async setUsage(sessionKey: string, threadId: string, inputTokens: number): Promise<void> {
    if (!validThreadId(threadId)) throw new Error('Codex 返回了无效的会话 ID');
    if (!Number.isInteger(inputTokens) || inputTokens < 0) {
      throw new Error('Codex 返回了无效的输入 Token 用量');
    }
    const key = this.key(sessionKey);
    const current = this.state.sessions[key];
    if (!current || current.threadId !== threadId) return;
    this.state.sessions[key] = {
      ...current,
      inputTokens,
      updatedAt: new Date().toISOString(),
    };
    await this.persist();
  }

  async remove(sessionKey: string): Promise<void> {
    delete this.state.sessions[this.key(sessionKey)];
    await this.persist();
  }

  private key(sessionKey: string): string {
    return createHash('sha256').update(sessionKey).digest('hex');
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
