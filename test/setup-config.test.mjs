import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildEnv,
  buildProfile,
  encodeEnvValue,
  parseEnvFile,
} from '../scripts/setup-config.mjs';

const baseSettings = {
  botId: 'example-bot',
  botSecret: 'example-secret',
  autostart: false,
  codexModel: '',
  codexFallbackModel: '',
  codexReasoningEffort: '',
  codexServiceTier: '',
  codexWorkdir: 'C:\\work folder',
  codexAdditionalDirs: '',
  codexSandbox: 'workspace-write',
  codexEphemeral: false,
};

test('安装配置保留使用者的 Codex 与服务选择', () => {
  const content = buildEnv(baseSettings);
  const parsed = parseEnvFile(content);
  assert.equal(parsed.SERVICE_AUTOSTART, 'false');
  assert.equal(parsed.CODEX_MODEL, '');
  assert.equal(parsed.CODEX_FALLBACK_MODEL, '');
  assert.equal(parsed.CODEX_WORKDIR, 'C:\\work folder');
  assert.equal(parsed.PERSONA_PROFILE_PATH, '.runtime/persona-profile.json');
});

test('生成的配置可以由 Node 原生环境文件加载器读取', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wecom-setup-env-'));
  const path = join(root, '.env');
  try {
    await writeFile(path, buildEnv(baseSettings), 'utf8');
    process.loadEnvFile(path);
    assert.equal(process.env.CODEX_WORKDIR, 'C:\\work folder');
    assert.equal(process.env.SERVICE_AUTOSTART, 'false');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('环境变量值会安全编码并可重新读取', () => {
  const value = 'D:\\Team Files\\项目 #1';
  assert.equal(parseEnvFile(`VALUE=${encodeEnvValue(value)}`).VALUE, value);
});

test('使用者可以关闭偏题提醒', () => {
  const profile = buildProfile({
    name: '自定义助手',
    personaPrompt: '只按使用者的规则回复。',
    offTopicReminderEnabled: false,
    offTopicReminder: '不应出现',
    offTopicReminderThreshold: 3,
  });
  assert.equal(profile.offTopicReminder, '');
  assert.equal(profile.offTopicReminderThreshold, 0);
});
