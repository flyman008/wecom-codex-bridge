export const PERSONA_PRESETS = {
  professional: {
    name: '企微工作助手',
    personaPrompt:
      '你是企业微信里的专业工作助手。回复准确、简洁、先给结论，不暴露路由、模型、Agent、CLI 等内部实现细节。',
  },
  warm: {
    name: '企微工作搭档',
    personaPrompt:
      '你是一个温和、可靠、有分寸的工作搭档。回复简洁、直击要害，先给结论；体贴但不油腻，不撒娇，不暴露内部实现细节。',
  },
};

export function parseEnvFile(content) {
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function encodeEnvValue(value) {
  const normalized = String(value ?? '').replace(/\r?\n/g, ' ').trim();
  return normalized ? `"${normalized.replaceAll('"', '\\"')}"` : '';
}

export function buildEnv(settings) {
  const line = (key, value) => `${key}=${encodeEnvValue(value)}`;
  return [
    '# 此文件由 npm run setup 生成，只保存在当前部署机器，不要提交到 Git。',
    '',
    '# 企业微信智能机器人',
    line('WECOM_BOT_ID', settings.botId),
    line('WECOM_BOT_SECRET', settings.botSecret),
    'WECOM_HEARTBEAT_MS=30000',
    'WECOM_MAX_RECONNECT_ATTEMPTS=-1',
    '',
    '# 安装人与路由策略',
    line('SERVICE_AUTOSTART', settings.autostart),
    line('ROUTING_MODE', settings.routingMode),
    line('DEFAULT_AGENT', settings.defaultAgent),
    'MAX_ACTIVE_TASKS_PER_USER=3',
    'STREAM_FLUSH_MS=800',
    'STREAM_TIMEOUT_MS=330000',
    'CODEX_ROUTE_CONFIDENCE=0.85',
    'HEALTH_PORT=8787',
    'ROUTER_AGENT_PROFILE_PATH=.runtime/router-agent.profile.json',
    'ROUTER_AGENT_MEMORY_PATH=.runtime/router-memory.json',
    '',
    '# 语义路由模型；codex_all 模式下可以留空',
    line('LLM_BASE_URL', settings.llmBaseUrl),
    line('LLM_API_KEY', settings.llmApiKey),
    line('LLM_MODEL', settings.llmModel),
    'LLM_SYSTEM_PROMPT=',
    'LLM_TIMEOUT_MS=180000',
    '',
    '# Codex CLI 策略；模型、推理强度和速度留空时继承安装人的 Codex 配置',
    'CODEX_COMMAND=codex',
    line('CODEX_MODEL', settings.codexModel),
    line('CODEX_FALLBACK_MODEL', settings.codexFallbackModel),
    line('CODEX_REASONING_EFFORT', settings.codexReasoningEffort),
    line('CODEX_SERVICE_TIER', settings.codexServiceTier),
    line('CODEX_WORKDIR', settings.codexWorkdir),
    line('CODEX_ADDITIONAL_DIRS', settings.codexAdditionalDirs),
    line('CODEX_SANDBOX', settings.codexSandbox),
    'CODEX_TIMEOUT_MS=1800000',
    line('CODEX_EPHEMERAL', settings.codexEphemeral),
    'CODEX_SESSION_PATH=.runtime/codex-sessions.json',
    '',
    '# 文档附件暂存与限制',
    'DOCUMENT_STAGING_DIR=.runtime/incoming',
    'DOCUMENT_MAX_BYTES=52428800',
    'DOCUMENT_ATTACHMENT_TTL_MS=900000',
    '',
    '# 本地 Agent；未选择时留空',
    line('LOCAL_AGENT_URL', settings.localAgentUrl),
    line('LOCAL_AGENT_TOKEN', settings.localAgentToken),
    'LOCAL_AGENT_TIMEOUT_MS=600000',
    'ALLOW_REMOTE_LOCAL_AGENT=false',
    '',
  ].join('\n');
}

export function buildProfile(settings) {
  return {
    version: 1,
    name: settings.name.trim(),
    personaPrompt: settings.personaPrompt.trim(),
    offTopicReminder: settings.offTopicReminderEnabled
      ? settings.offTopicReminder.trim()
      : '',
    offTopicReminderThreshold: settings.offTopicReminderEnabled
      ? settings.offTopicReminderThreshold
      : 0,
    memory: {
      recentTurnsPerSession: 8,
      maxTurnCharacters: 600,
      maxUserFacts: 20,
      maxFactCharacters: 240,
    },
  };
}
