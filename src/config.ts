import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { AgentName } from './types.js';

export interface AppConfig {
  wecom: {
    botId: string;
    secret: string;
    heartbeatIntervalMs: number;
    maxReconnectAttempts: number;
  };
  router: {
    mode: 'semantic' | 'codex_all';
    defaultAgent: AgentName;
    maxActiveTasksPerUser: number;
    streamFlushMs: number;
    streamTimeoutMs: number;
    codexConfidenceThreshold: number;
  };
  routerAgent: {
    profilePath: string;
    memoryPath: string;
  };
  healthPort: number;
  llm: {
    baseUrl: string | undefined;
    apiKey: string | undefined;
    model: string | undefined;
    systemPrompt: string;
    timeoutMs: number;
  };
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
  localAgent: {
    url: string | undefined;
    token: string | undefined;
    timeoutMs: number;
    allowRemote: boolean;
  };
}

export function parseRoutingMode(value: string | undefined): 'semantic' | 'codex_all' {
  const normalized = value?.trim().toLowerCase() || 'semantic';
  if (normalized === 'semantic' || normalized === 'codex_all') return normalized;
  throw new Error('ROUTING_MODE 只能是 semantic 或 codex_all');
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

function decimal(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = optional(env, key);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${key} 必须是 ${min} 到 ${max} 之间的数字`);
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

function defaultAgent(env: NodeJS.ProcessEnv): AgentName {
  const value = optional(env, 'DEFAULT_AGENT') ?? 'llm';
  if (value === 'llm' || value === 'local') return value;
  throw new Error('DEFAULT_AGENT 只能是 llm 或 local；Codex 仅允许用于文档转企微在线文档');
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
    router: {
      mode: parseRoutingMode(optional(env, 'ROUTING_MODE')),
      defaultAgent: defaultAgent(env),
      maxActiveTasksPerUser: integer(env, 'MAX_ACTIVE_TASKS_PER_USER', 3),
      streamFlushMs: integer(env, 'STREAM_FLUSH_MS', 800, 100),
      streamTimeoutMs: integer(env, 'STREAM_TIMEOUT_MS', 330_000, 10_000),
      codexConfidenceThreshold: decimal(env, 'CODEX_ROUTE_CONFIDENCE', 0.85, 0.5, 1),
    },
    routerAgent: {
      profilePath: resolve(
        optional(env, 'ROUTER_AGENT_PROFILE_PATH') ?? '.runtime/router-agent.profile.json',
      ),
      memoryPath: resolve(optional(env, 'ROUTER_AGENT_MEMORY_PATH') ?? '.runtime/router-memory.json'),
    },
    healthPort: integer(env, 'HEALTH_PORT', 8787, 0),
    llm: {
      baseUrl: optional(env, 'LLM_BASE_URL'),
      apiKey: optional(env, 'LLM_API_KEY'),
      model: optional(env, 'LLM_MODEL'),
      systemPrompt:
        optional(env, 'LLM_SYSTEM_PROMPT') ??
        '你是企业微信里的工作助手。请准确回答，并遵守本次部署配置的人设与会话规则。',
      timeoutMs: integer(env, 'LLM_TIMEOUT_MS', 180_000, 1_000),
    },
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
    localAgent: {
      url: optional(env, 'LOCAL_AGENT_URL'),
      token: optional(env, 'LOCAL_AGENT_TOKEN'),
      timeoutMs: integer(env, 'LOCAL_AGENT_TIMEOUT_MS', 600_000, 1_000),
      allowRemote: boolean(env, 'ALLOW_REMOTE_LOCAL_AGENT', false),
    },
  };
}
