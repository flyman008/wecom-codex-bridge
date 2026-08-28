import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const envPath = join(projectRoot, '.env');
const checks = [];

function add(name, ok, detail) {
  checks.push({ name, ok, detail });
}

function run(command, args) {
  let executable = command;
  if (process.platform === 'win32' && !isAbsolute(command)) {
    const located = spawnSync('where.exe', [command], { encoding: 'utf8', windowsHide: true });
    executable =
      located.stdout
        ?.split(/\r?\n/)
        .map((value) => value.trim())
        .find((value) => value.toLowerCase().endsWith('.exe')) || command;
  }
  return spawnSync(executable, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32' && !isAbsolute(executable),
  });
}

const [major, minor] = process.versions.node.split('.').map(Number);
add('Node.js >= 20.12', major > 20 || (major === 20 && minor >= 12), process.version);

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
  add('.env', true, 'present');
  add('WeCom bot credentials', Boolean(process.env.WECOM_BOT_ID && process.env.WECOM_BOT_SECRET), 'configured');
  add('Codex workdir', Boolean(process.env.CODEX_WORKDIR), 'configured');
  add(
    'Autostart choice',
    process.env.SERVICE_AUTOSTART === 'true' || process.env.SERVICE_AUTOSTART === 'false',
    process.env.SERVICE_AUTOSTART || 'not configured',
  );
  const configuredProfilePath = process.env.PERSONA_PROFILE_PATH || '.runtime/persona-profile.json';
  const profilePath = isAbsolute(configuredProfilePath)
    ? configuredProfilePath
    : join(projectRoot, configuredProfilePath);
  add('Local persona profile', existsSync(profilePath), existsSync(profilePath) ? 'present' : 'missing');
} else {
  add('.env', false, 'missing');
  add('WeCom bot credentials', false, 'not checked');
  add('Codex workdir', false, 'not checked');
  add('Autostart choice', false, 'not checked');
  add('Local persona profile', false, 'not checked');
}

const codexVersion = run('codex', ['--version']);
add('Codex CLI', codexVersion.status === 0, codexVersion.status === 0 ? codexVersion.stdout.trim() : 'unavailable');
const codexLogin = run('codex', ['login', 'status']);
add('Codex login', codexLogin.status === 0, codexLogin.status === 0 ? 'authenticated' : 'not authenticated');

const localWeComCli = join(projectRoot, 'node_modules', '@wecom', 'cli', 'bin', 'wecom.js');
const wecomCommand = existsSync(localWeComCli) ? process.execPath : 'wecom-cli';
const wecomPrefix = existsSync(localWeComCli) ? [localWeComCli] : [];
const wecomVersion = run(wecomCommand, [...wecomPrefix, '--version']);
add('WeCom CLI', wecomVersion.status === 0, wecomVersion.status === 0 ? wecomVersion.stdout.trim() : 'unavailable');
const wecomAuth = run(wecomCommand, [...wecomPrefix, 'auth', 'show', '--status']);
add('WeCom document authorization', wecomAuth.status === 0 && wecomAuth.stdout.trim() === 'authorized', wecomAuth.stdout.trim() || 'not authorized');

add('Build output', existsSync(join(projectRoot, 'dist', 'src', 'index.js')), 'dist/src/index.js');

const pidPath = join(projectRoot, '.runtime', 'service.pid');
let serviceProcessRunning = false;
if (existsSync(pidPath)) {
  const pid = Number(readFileSync(pidPath, 'utf8').trim());
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 0);
      serviceProcessRunning = true;
    } catch {
      // 保留未运行状态。
    }
  }
}
add('Service process', serviceProcessRunning, serviceProcessRunning ? 'running' : 'not running');

let healthOk = false;
let healthDetail = 'service unavailable';
try {
  const port = process.env.HEALTH_PORT || '8787';
  const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3_000) });
  const body = await response.json();
  healthOk = serviceProcessRunning && response.ok && body?.status === 'ok';
  healthDetail =
    !serviceProcessRunning && body?.status === 'ok'
      ? 'another local service responded'
      : body?.status || `HTTP ${response.status}`;
} catch {
  // 保留不可用状态。
}
add('WeCom connection', healthOk, healthDetail);

for (const check of checks) {
  console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}  ${check.detail}`);
}

if (checks.some((check) => !check.ok)) process.exitCode = 1;
