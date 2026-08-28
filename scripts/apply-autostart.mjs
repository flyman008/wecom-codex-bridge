import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseEnvFile } from './setup-config.mjs';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const envPath = join(projectRoot, '.env');
if (!existsSync(envPath)) {
  console.error('缺少 .env；请先运行 npm run setup。');
  process.exit(1);
}

const env = parseEnvFile(readFileSync(envPath, 'utf8'));
if (env.SERVICE_AUTOSTART !== 'true' && env.SERVICE_AUTOSTART !== 'false') {
  console.error('SERVICE_AUTOSTART 必须由安装人设置为 true 或 false；请重新运行 npm run setup。');
  process.exit(1);
}

const enabled = env.SERVICE_AUTOSTART === 'true';
if (enabled && !existsSync(join(projectRoot, 'dist', 'src', 'index.js'))) {
  console.error('缺少构建产物；请先运行 npm run check。');
  process.exit(1);
}

let command;
let args;
if (process.platform === 'win32') {
  command = 'powershell.exe';
  args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(projectRoot, 'scripts', enabled ? 'install-autostart.ps1' : 'uninstall-autostart.ps1'),
  ];
} else if (process.platform === 'darwin') {
  command = '/bin/bash';
  args = [join(projectRoot, 'scripts', enabled ? 'install-autostart.sh' : 'uninstall-autostart.sh')];
} else if (!enabled) {
  console.log('当前系统没有安装本项目的自启动项。');
  process.exit(0);
} else {
  console.error('当前系统没有内置自启动安装器；请使用系统服务管理器手动配置。');
  process.exit(1);
}

const result = spawnSync(command, args, {
  cwd: projectRoot,
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
