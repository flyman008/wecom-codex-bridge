import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { get } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = join(projectRoot, '.runtime');
const logDir = join(projectRoot, 'logs');
const keeperPath = join(projectRoot, 'scripts', 'service-keeper.mjs');
const supervisorPath = join(projectRoot, 'scripts', 'service-supervisor.mjs');
const entryPath = join(projectRoot, 'dist', 'src', 'index.js');
const keeperPidPath = join(runtimeDir, 'keeper.pid');
const supervisorPidPath = join(runtimeDir, 'supervisor.pid');
const servicePidPath = join(runtimeDir, 'service.pid');
const stopPath = join(runtimeDir, 'service.stop');
const keeperLogPath = join(logDir, 'keeper.log');
const supervisorStdoutPath = join(logDir, 'supervisor.stdout.log');
const supervisorStderrPath = join(logDir, 'supervisor.stderr.log');

mkdirSync(runtimeDir, { recursive: true });
mkdirSync(logDir, { recursive: true });

function log(message, details = {}) {
  appendFileSync(
    keeperLogPath,
    `${JSON.stringify({ time: new Date().toISOString(), message, keeperPid: process.pid, ...details })}\n`,
    'utf8',
  );
}

function readPid(path) {
  if (!existsSync(path)) return undefined;
  const value = Number(readFileSync(path, 'utf8').trim());
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function expectedProcessExists(pid, commandMarker) {
  if (!processExists(pid)) return false;
  if (process.platform !== 'win32') return true;
  const script = [
    '$processInfo = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $env:WECOM_CHECK_PID)',
    'if ($processInfo -and $processInfo.CommandLine -and $processInfo.CommandLine.IndexOf($env:WECOM_CHECK_MARKER, [StringComparison]::OrdinalIgnoreCase) -ge 0) { exit 0 }',
    'exit 1',
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      WECOM_CHECK_PID: String(pid),
      WECOM_CHECK_MARKER: commandMarker,
    },
  });
  return result.status === 0;
}

function removePidIfOwned(path, pid) {
  try {
    if (readPid(path) === pid) rmSync(path, { force: true });
  } catch {
    // A replacement process may already own the file.
  }
}

function forceStop(pid) {
  if (!processExists(pid)) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }
  process.kill(pid, 'SIGKILL');
}

function checkHealth() {
  return new Promise((resolveHealth) => {
    const request = get(
      { hostname: '127.0.0.1', port: 8787, path: '/health', timeout: 5_000 },
      (response) => {
        response.resume();
        resolveHealth(response.statusCode === 200);
      },
    );
    request.once('timeout', () => request.destroy(new Error('health timeout')));
    request.once('error', () => resolveHealth(false));
  });
}

function startSupervisor() {
  const orphanedServicePid = readPid(servicePidPath);
  if (orphanedServicePid && expectedProcessExists(orphanedServicePid, entryPath)) {
    forceStop(orphanedServicePid);
    log('已清理孤立业务进程', { servicePid: orphanedServicePid });
  }
  rmSync(servicePidPath, { force: true });
  rmSync(supervisorPidPath, { force: true });

  const stdoutFd = openSync(supervisorStdoutPath, 'a');
  const stderrFd = openSync(supervisorStderrPath, 'a');
  let supervisor;
  try {
    supervisor = spawn(process.execPath, [supervisorPath], {
      cwd: projectRoot,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', stdoutFd, stderrFd],
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  writeFileSync(supervisorPidPath, `${supervisor.pid}\n`, 'ascii');
  supervisor.unref();
  log('监督进程已启动', { supervisorPid: supervisor.pid });
}

const existingKeeperPid = readPid(keeperPidPath);
if (
  existingKeeperPid &&
  existingKeeperPid !== process.pid &&
  expectedProcessExists(existingKeeperPid, keeperPath)
) {
  process.exit(0);
}

writeFileSync(keeperPidPath, `${process.pid}\n`, 'ascii');
log('保活器已启动');

let stopping = false;
let checkRunning = false;
let healthFailures = 0;

async function runCheck() {
  if (stopping || checkRunning) return;
  if (existsSync(stopPath)) {
    shutdown(0);
    return;
  }
  checkRunning = true;
  try {
    const supervisorPid = readPid(supervisorPidPath);
    if (!supervisorPid || !expectedProcessExists(supervisorPid, supervisorPath)) {
      healthFailures = 0;
      startSupervisor();
      return;
    }

    const servicePid = readPid(servicePidPath);
    const serviceExists =
      servicePid && expectedProcessExists(servicePid, entryPath);
    if (serviceExists && (await checkHealth())) {
      healthFailures = 0;
      return;
    }

    healthFailures += 1;
    log('业务服务检查失败', { healthFailures, servicePid });
    if (healthFailures >= 3) {
      forceStop(supervisorPid);
      log('业务服务连续异常，重启监督进程', { supervisorPid });
      startSupervisor();
      healthFailures = 0;
    }
  } finally {
    checkRunning = false;
  }
}

function shutdown(exitCode) {
  if (stopping) return;
  stopping = true;
  removePidIfOwned(keeperPidPath, process.pid);
  log('保活器已停止');
  process.exit(exitCode);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => shutdown(0));
}

process.on('uncaughtException', (error) => {
  log('保活器发生未捕获异常', { error: error.stack || error.message });
  shutdown(1);
});

process.on('exit', () => removePidIfOwned(keeperPidPath, process.pid));

runCheck().catch((error) => {
  log('首次保活检查失败', { error: error.stack || error.message });
});
setInterval(() => {
  runCheck().catch((error) => {
    log('保活检查失败', { error: error.stack || error.message });
  });
}, 15_000);
