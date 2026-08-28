import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface AppConfig {
  wecom: {
    botId: string;
    secret: string;
    heartbeatIntervalMs: number;
    maxReconnectAttempts: number;
  };
  processing: {
    maxActiveTasksPerUser: number;
    streamFlushMs: number;
    streamTimeoutMs: number;
  };
  persona: {
    profilePath: string;
  };
  healthPort: number;
  codex: {
    command: string;
    model: string | undefined;
    fallbackModel: string | undefined;
    reasoningEffort: string | undefined;
    serviceTier: string | undefined;
    workdir: string | undefined;
    additionalDirs: string[];
    sandbox: 'read-only' | 'workspace-write';
    timeoutMs: number;
    ephemeral: boolean;
    sessionPath: string;
  };
  documents: {
    stagingDir: string;
    maxBytes: number;
    attachmentTtlMs: number;
  };
}

export function loadEnvFileIfPresent(path = resolve('.env')): void {
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}

function optional(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export function parseDirectoryList(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(';').map((item) => item.trim()).filter(Boolean))];
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = optional(env, key);
  if (!value) {
    throw new Error(`缺少必填配置：${key}`);
  }
  return value;
}

function integer(env: NodeJS.ProcessEnv, key: string, fallback: number, min = 1): number {
  const raw = optional(env, key);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${key} 必须是大于等于 ${min} 的整数`);
  }
  return value;
}

function boolean(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = optional(env, key)?.toLowerCase();
  if (!raw) return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new Error(`${key} 必须是 true 或 false`);
}

function codexSandbox(env: NodeJS.ProcessEnv): 'read-only' | 'workspace-write' {
  const value = optional(env, 'CODEX_SANDBOX') ?? 'workspace-write';
  if (value === 'read-only' || value === 'workspace-write') return value;
  throw new Error('CODEX_SANDBOX 只能是 read-only 或 workspace-write');
}

function reconnectAttempts(env: NodeJS.ProcessEnv): number {
  const raw = optional(env, 'WECOM_MAX_RECONNECT_ATTEMPTS') ?? '-1';
  const value = Number(raw);
  if (!Number.isInteger(value) || value < -1) {
    throw new Error('WECOM_MAX_RECONNECT_ATTEMPTS 必须是 -1 或非负整数');
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    wecom: {
      botId: required(env, 'WECOM_BOT_ID'),
      secret: required(env, 'WECOM_BOT_SECRET'),
      heartbeatIntervalMs: integer(env, 'WECOM_HEARTBEAT_MS', 30_000, 5_000),
      maxReconnectAttempts: reconnectAttempts(env),
    },
    processing: {
      maxActiveTasksPerUser: integer(env, 'MAX_ACTIVE_TASKS_PER_USER', 3),
      streamFlushMs: integer(env, 'STREAM_FLUSH_MS', 800, 100),
      streamTimeoutMs: integer(env, 'STREAM_TIMEOUT_MS', 330_000, 10_000),
    },
    persona: {
      profilePath: resolve(
        optional(env, 'PERSONA_PROFILE_PATH') ?? '.runtime/persona-profile.json',
      ),
    },
    healthPort: integer(env, 'HEALTH_PORT', 8787, 0),
    codex: {
      command: optional(env, 'CODEX_COMMAND') ?? 'codex',
      model: optional(env, 'CODEX_MODEL'),
      fallbackModel: optional(env, 'CODEX_FALLBACK_MODEL'),
      reasoningEffort: optional(env, 'CODEX_REASONING_EFFORT'),
      serviceTier: optional(env, 'CODEX_SERVICE_TIER'),
      workdir: optional(env, 'CODEX_WORKDIR'),
      additionalDirs: parseDirectoryList(optional(env, 'CODEX_ADDITIONAL_DIRS')),
      sandbox: codexSandbox(env),
      timeoutMs: integer(env, 'CODEX_TIMEOUT_MS', 1_800_000, 10_000),
      ephemeral: boolean(env, 'CODEX_EPHEMERAL', true),
      sessionPath: resolve(
        optional(env, 'CODEX_SESSION_PATH') ?? '.runtime/codex-sessions.json',
      ),
    },
    documents: {
      stagingDir: resolve(optional(env, 'DOCUMENT_STAGING_DIR') ?? '.runtime/incoming'),
      maxBytes: integer(env, 'DOCUMENT_MAX_BYTES', 50 * 1024 * 1024, 1_024),
      attachmentTtlMs: integer(env, 'DOCUMENT_ATTACHMENT_TTL_MS', 15 * 60_000, 60_000),
    },
  };
}
