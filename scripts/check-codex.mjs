import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildCodexConfigArgs, resolveCodexCommand } from '../dist/src/agents/codex-cli.js';
import { loadConfig } from '../dist/src/config.js';

const envPath = resolve('.env');
if (!existsSync(envPath)) throw new Error('未找到 .env');
process.loadEnvFile(envPath);

const config = loadConfig();
if (!config.codex.workdir) throw new Error('未配置 CODEX_WORKDIR');
const command = resolveCodexCommand(config.codex.command);
const args = [
  '--sandbox',
  config.codex.sandbox,
  '--cd',
  config.codex.workdir,
  ...config.codex.additionalDirs.flatMap((directory) => ['--add-dir', directory]),
  ...buildCodexConfigArgs(
    config.codex.reasoningEffort,
    config.codex.serviceTier,
    config.codex.model,
  ),
  'exec',
  ...(config.codex.model ? ['--model', config.codex.model] : []),
  '--json',
  '--color',
  'never',
  '--skip-git-repo-check',
  ...(config.codex.ephemeral ? ['--ephemeral'] : []),
  '-',
];
const result = spawnSync(command, args, {
  cwd: config.codex.workdir,
  input: '只回复：Codex连接成功。不要使用任何工具，不要修改文件。',
  encoding: 'utf8',
  timeout: 120_000,
  windowsHide: true,
  maxBuffer: 8 * 1024 * 1024,
});

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`Codex 连通性验证失败（退出码 ${result.status ?? 'unknown'}）`);
}

const events = result.stdout
  .split(/\r?\n/)
  .filter(Boolean)
  .flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
const message = events
  .filter((event) => event?.type === 'item.completed' && event?.item?.type === 'agent_message')
  .at(-1)?.item?.text;
if (typeof message !== 'string' || !message.trim()) {
  throw new Error('Codex 已结束，但没有返回可识别的最终消息');
}

const version = execFileSync(command, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
console.log(JSON.stringify({ ok: true, version, preview: message.trim().slice(0, 40) }));
