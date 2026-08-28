import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import {
  PERSONA_PRESETS,
  buildEnv,
  buildProfile,
  parseEnvFile,
} from './setup-config.mjs';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const envPath = join(projectRoot, '.env');
const profilePath = join(projectRoot, '.runtime', 'persona-profile.json');

class SecretSafeOutput extends Writable {
  muted = false;

  _write(chunk, encoding, callback) {
    if (!this.muted) process.stdout.write(chunk, encoding);
    callback();
  }
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('配置向导需要交互式终端。请在 Terminal、PowerShell 或 Codex 可见终端中运行 npm run setup。');
  process.exit(1);
}

const promptOutput = new SecretSafeOutput();
const rl = createInterface({ input: process.stdin, output: promptOutput, terminal: true });

function displayDefault(value) {
  return value ? ` [${value}]` : '';
}

async function askText(label, defaultValue = '', required = false) {
  while (true) {
    const answer = (await rl.question(`${label}${displayDefault(defaultValue)}：`)).trim();
    const value = answer || defaultValue;
    if (!required || value) return value;
    console.log('此项不能为空。');
  }
}

async function askSecret(label, currentValue = '', required = false) {
  while (true) {
    process.stdout.write(`${label}${currentValue ? ' [留空保留现有值]' : ''}：`);
    promptOutput.muted = true;
    const answer = (await rl.question('')).trim();
    promptOutput.muted = false;
    process.stdout.write('\n');
    const value = answer || currentValue;
    if (!required || value) return value;
    console.log('此项不能为空。');
  }
}

async function askChoice(label, options, currentValue) {
  console.log(`\n${label}`);
  options.forEach((option, index) => console.log(`  ${index + 1}. ${option.label}`));
  const currentIndex = Math.max(
    0,
    options.findIndex((option) => option.value === currentValue),
  );
  while (true) {
    const answer = (await rl.question(`请选择 [${currentIndex + 1}]：`)).trim();
    const index = answer ? Number(answer) - 1 : currentIndex;
    if (Number.isInteger(index) && options[index]) return options[index].value;
    console.log('请输入列表中的序号。');
  }
}

async function askYesNo(label, currentValue) {
  const value = await askChoice(
    label,
    [
      { label: '是', value: true },
      { label: '否', value: false },
    ],
    currentValue,
  );
  return value;
}

async function askPositiveInteger(label, defaultValue) {
  while (true) {
    const value = Number(await askText(label, String(defaultValue), true));
    if (Number.isInteger(value) && value > 0) return value;
    console.log('请输入大于 0 的整数。');
  }
}

function readExistingJson(path) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function existingBoolean(value, fallback) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

async function main() {
  console.log('\n企业微信 Codex 桥接服务配置向导');
  console.log('所有选择只写入当前机器的 .env 和 .runtime，不会进入 Git。\n');

  const existingEnv = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, 'utf8')) : {};
  if (existsSync(envPath)) {
    const continueSetup = await askYesNo('检测到已有配置，是否基于现有值重新设置', true);
    if (!continueSetup) return;
  }

  const botId = await askText('企业微信 Bot ID', existingEnv.WECOM_BOT_ID, true);
  const botSecret = await askSecret('企业微信 Bot Secret（输入不会回显）', existingEnv.WECOM_BOT_SECRET, true);

  const existingProfile = readExistingJson(profilePath);
  const personaPreset = await askChoice(
    '机器人回复人设',
    [
      { label: '专业简洁', value: 'professional' },
      { label: '温和简洁', value: 'warm' },
      { label: '自定义', value: 'custom' },
    ],
    existingProfile ? 'custom' : 'professional',
  );
  const preset = PERSONA_PRESETS[personaPreset];
  const name =
    personaPreset === 'custom'
      ? await askText('人设名称', existingProfile?.name || '企微工作助手', true)
      : preset.name;
  const personaPrompt =
    personaPreset === 'custom'
      ? await askText('完整人设说明', existingProfile?.personaPrompt || '', true)
      : preset.personaPrompt;
  const offTopicReminderEnabled = await askYesNo(
    '连续多次偏离工作话题时是否提醒',
    Boolean(existingProfile?.offTopicReminderThreshold),
  );
  const offTopicReminderThreshold = offTopicReminderEnabled
    ? await askPositiveInteger(
        '连续多少次后提醒',
        existingProfile?.offTopicReminderThreshold || 3,
      )
    : 0;
  const offTopicReminder = offTopicReminderEnabled
    ? await askText(
        '提醒文案',
        existingProfile?.offTopicReminder || '聊得有点远啦，回到工作吧。',
        true,
      )
    : '';

  console.log('\nCodex 模型名、推理强度和速度都可以留空；留空会继承使用者自己的 Codex 配置。');
  const codexModel = await askText('Codex 首选模型', existingEnv.CODEX_MODEL);
  const codexFallbackModel = await askText(
    '额度或限流时使用的备用模型（可留空）',
    existingEnv.CODEX_FALLBACK_MODEL,
  );
  const codexReasoningEffort = await askChoice(
    'Codex 推理强度',
    [
      { label: '继承当前 Codex 配置', value: '' },
      { label: 'low', value: 'low' },
      { label: 'medium', value: 'medium' },
      { label: 'high', value: 'high' },
      { label: 'xhigh', value: 'xhigh' },
    ],
    existingEnv.CODEX_REASONING_EFFORT || '',
  );
  const codexServiceTier = await askChoice(
    'Codex 速度策略',
    [
      { label: '继承当前 Codex 配置', value: '' },
      { label: 'Fast（仅在所选模型支持时生效）', value: 'fast' },
    ],
    existingEnv.CODEX_SERVICE_TIER || '',
  );
  let codexWorkdir = await askText(
    'Codex 主工作目录',
    existingEnv.CODEX_WORKDIR || projectRoot,
    true,
  );
  codexWorkdir = resolve(codexWorkdir);
  if (!existsSync(codexWorkdir) || !statSync(codexWorkdir).isDirectory()) {
    throw new Error(`Codex 主工作目录不存在：${codexWorkdir}`);
  }
  const codexAdditionalDirs = await askText(
    'Codex 附加授权目录（多个目录用英文分号分隔，可留空）',
    existingEnv.CODEX_ADDITIONAL_DIRS,
  );
  const codexSandbox = await askChoice(
    'Codex 文件权限',
    [
      { label: 'workspace-write：可写授权目录', value: 'workspace-write' },
      { label: 'read-only：仅查看', value: 'read-only' },
    ],
    existingEnv.CODEX_SANDBOX || 'workspace-write',
  );
  const persistentConversation = await askYesNo(
    '同一企微会话是否持续使用同一个 Codex 上下文',
    !existingBoolean(existingEnv.CODEX_EPHEMERAL, false),
  );

  const autostart = await askYesNo(
    '当前用户登录后是否自动启动服务',
    existingBoolean(existingEnv.SERVICE_AUTOSTART, false),
  );
  const applyAutostartNow = await askYesNo('保存后立即应用这项自启动选择', true);

  const envText = buildEnv({
    botId,
    botSecret,
    autostart,
    codexModel,
    codexFallbackModel,
    codexReasoningEffort,
    codexServiceTier,
    codexWorkdir,
    codexAdditionalDirs,
    codexSandbox,
    codexEphemeral: !persistentConversation,
  });
  const profile = buildProfile({
    name,
    personaPrompt,
    offTopicReminderEnabled,
    offTopicReminder,
    offTopicReminderThreshold,
  });

  await mkdir(dirname(profilePath), { recursive: true });
  await writeFile(envPath, envText, { encoding: 'utf8', mode: 0o600 });
  await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  console.log('\n本机配置已写入 .env 和 .runtime/persona-profile.json。');

  if (applyAutostartNow) {
    const result = spawnSync(process.execPath, [join(projectRoot, 'scripts', 'apply-autostart.mjs')], {
      cwd: projectRoot,
      stdio: 'inherit',
      windowsHide: true,
    });
    if (result.status !== 0) {
      throw new Error('配置已保存，但自启动设置应用失败；修复环境后运行 npm run autostart:apply。');
    }
  } else {
    console.log('稍后可运行 npm run autostart:apply 应用自启动选择。');
  }
  console.log('下一步运行 npm run doctor，并在企微中完成消息与文档转换验收。');
}

try {
  await main();
} finally {
  rl.close();
}
