import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { get } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const supervisorPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(supervisorPath), '..');
const runtimeDir = join(projectRoot, '.runtime');
const logDir = join(projectRoot, 'logs');
const entryPath = join(projectRoot, 'dist', 'src', 'index.js');
const supervisorPidPath = join(runtimeDir, 'supervisor.pid');
const servicePidPath = join(runtimeDir, 'service.pid');
const keeperPidPath = join(runtimeDir, 'keeper.pid');
const statePath = join(runtimeDir, 'supervisor-state.json');
const stopPath = join(runtimeDir, 'service.stop');
const keeperPath = join(projectRoot, 'scripts', 'service-keeper.mjs');
const stdoutPath = join(logDir, 'service.stdout.log');
const stderrPath = join(logDir, 'service.stderr.log');
const supervisorLogPath = join(logDir, 'supervisor.log');
const keeperStdoutPath = join(logDir, 'keeper.stdout.log');
const keeperStderrPath = join(logDir, 'keeper.stderr.log');
const maxLogBytes = 10 * 1024 * 1024;

mkdirSync(runtimeDir, { recursive: true });
mkdirSync(logDir, { recursive: true });

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(path) {
  if (!existsSync(path)) return undefined;
  const value = Number(readFileSync(path, 'utf8').trim());
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function rotateLog(path) {
  if (!existsSync(path) || statSync(path).size < maxLogBytes) return;
  const previousPath = `${path}.1`;
  rmSync(previousPath, { force: true });
  renameSync(path, previousPath);
}

rotateLog(supervisorLogPath);

function log(message, details = {}) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    message,
    ...details,
  });
  appendFileSync(supervisorLogPath, `${line}\n`, 'utf8');
}

const existingSupervisorPid = readPid(supervisorPidPath);
if (
  existingSupervisorPid &&
  existingSupervisorPid !== process.pid &&
  expectedWindowsProcessExists(existingSupervisorPid, supervisorPath)
) {
  log('检测到已有监督进程，本次启动退出', { existingSupervisorPid });
  process.exit(0);
}

if (!existsSync(entryPath)) {
  log('服务入口不存在，监督进程无法启动', { entryPath });
  process.exit(1);
}

if (existsSync(stopPath)) {
  log('检测到停止标记，监督进程不启动');
  process.exit(0);
}

let previousState = {};
try {
  previousState = JSON.parse(readFileSync(statePath, 'utf8'));
} catch {
  previousState = {};
}

let child;
let childStartedAt = 0;
let restartCount = Number(previousState.restartCount) || 0;
let restartAttempt = 0;
let healthFailures = 0;
let healthCheckRunning = false;
let stopping = false;
let lastExit = previousState.lastExit;
let restartTimer;
let keeperLaunchPendingUntil = 0;

writeFileSync(supervisorPidPath, `${process.pid}\n`, 'ascii');

function writeState() {
  const state = {
    supervisorPid: process.pid,
    servicePid: child?.pid,
    restartCount,
    restartAttempt,
    healthFailures,
    lastStartAt: childStartedAt ? new Date(childStartedAt).toISOString() : undefined,
    lastExit,
  };
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, statePath);
}

function removePidIfOwned(path, pid) {
  try {
    if (readPid(path) === pid) rmSync(path, { force: true });
  } catch {
    // A later process may already own the file; leave it untouched.
  }
}

function forceStopProcess(target) {
  if (!target || !processExists(target.pid)) return true;
  spawnSync('taskkill.exe', ['/PID', String(target.pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  return !processExists(target.pid);
}

function terminateChild() {
  const target = child;
  if (!target || !processExists(target.pid)) return;
  try {
    target.kill();
  } catch {
    forceStopProcess(target);
    return;
  }
  setTimeout(() => forceStopProcess(target), 5_000).unref();
}

function scheduleServiceStart(delayMs) {
  if (stopping || restartTimer || existsSync(stopPath)) return;
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    startService();
  }, delayMs);
}

function handleTrackedChildLoss(target, { code = null, signal = null, reason } = {}) {
  if (!target || child !== target) return;
  const exitedPid = target.pid;
  const uptimeMs = Date.now() - childStartedAt;
  removePidIfOwned(servicePidPath, exitedPid);
  child = undefined;
  lastExit = {
    at: new Date().toISOString(),
    code,
    signal,
    reason,
    uptimeMs,
  };

  if (stopping || existsSync(stopPath)) {
    writeState();
    log('服务进程已按要求停止', { servicePid: exitedPid, code, signal, reason });
    shutdownSupervisor(0);
    return;
  }

  restartCount += 1;
  restartAttempt = uptimeMs >= 60_000 ? 1 : restartAttempt + 1;
  const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(restartAttempt - 1, 5));
  writeState();
  log('服务进程丢失或意外退出，准备重启', {
    servicePid: exitedPid,
    code,
    signal,
    reason,
    uptimeMs,
    restartCount,
    delayMs,
  });
  scheduleServiceStart(delayMs);
}

function restartTrackedChild(reason) {
  const target = child;
  if (!target) {
    scheduleServiceStart(1_000);
    return;
  }
  if (processExists(target.pid) && !forceStopProcess(target)) {
    log('无法终止异常服务进程，将由下一次检查重试', {
      servicePid: target.pid,
      reason,
    });
    return;
  }
  handleTrackedChildLoss(target, { reason });
}

function startService() {
  if (stopping || existsSync(stopPath)) {
    shutdownSupervisor(0);
    return;
  }

  if (child && processExists(child.pid)) return;

  rotateLog(stdoutPath);
  rotateLog(stderrPath);
  const stdoutFd = openSync(stdoutPath, 'a');
  const stderrFd = openSync(stderrPath, 'a');
  childStartedAt = Date.now();
  healthFailures = 0;

  try {
    child = spawn(process.execPath, [entryPath], {
      cwd: projectRoot,
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', stdoutFd, stderrFd],
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }

  const startedChild = child;

  writeFileSync(servicePidPath, `${startedChild.pid}\n`, 'ascii');
  writeState();
  log('服务进程已启动', { servicePid: startedChild.pid, restartCount });

  startedChild.once('error', (error) => {
    log('服务进程启动错误', { error: error.message });
  });

  startedChild.once('exit', (code, signal) => {
    if (child !== startedChild) {
      log('已忽略旧服务进程的延迟退出事件', {
        servicePid: startedChild.pid,
        code,
        signal,
      });
      return;
    }
    handleTrackedChildLoss(startedChild, { code, signal, reason: 'exit event' });
  });
}

function checkHealth() {
  return new Promise((resolveHealth) => {
    const request = get(
      {
        hostname: '127.0.0.1',
        port: 8787,
        path: '/health',
        timeout: 5_000,
      },
      (response) => {
        response.resume();
        resolveHealth(response.statusCode === 200);
      },
    );
    request.once('timeout', () => request.destroy(new Error('health timeout')));
    request.once('error', () => resolveHealth(false));
  });
}

async function runHealthCheck() {
  if (stopping || healthCheckRunning) return;
  if (!child) {
    scheduleServiceStart(1_000);
    return;
  }
  if (!processExists(child.pid)) {
    restartTrackedChild('process missing without exit event');
    return;
  }
  if (Date.now() - childStartedAt < 20_000) return;
  healthCheckRunning = true;
  try {
    if (await checkHealth()) {
      if (healthFailures) {
        healthFailures = 0;
        writeState();
      }
      return;
    }
    healthFailures += 1;
    writeState();
    log('服务健康检查失败', { servicePid: child.pid, healthFailures });
    if (healthFailures >= 3) {
      log('服务连续三次健康检查失败，触发重启', { servicePid: child.pid });
      restartTrackedChild('three consecutive health check failures');
    }
  } finally {
    healthCheckRunning = false;
  }
}

function expectedWindowsProcessExists(pid, commandMarker) {
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

function ensureKeeper() {
  if (process.platform !== 'win32' || stopping || existsSync(stopPath)) return;
  const keeperPid = readPid(keeperPidPath);
  if (keeperPid && expectedWindowsProcessExists(keeperPid, keeperPath)) {
    keeperLaunchPendingUntil = 0;
    return;
  }
  if (Date.now() < keeperLaunchPendingUntil) return;
  rmSync(keeperPidPath, { force: true });

  const stdoutFd = openSync(keeperStdoutPath, 'a');
  const stderrFd = openSync(keeperStderrPath, 'a');
  let keeperProcess;
  try {
    keeperProcess = spawn(
      process.execPath,
      [keeperPath],
      {
        cwd: projectRoot,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', stdoutFd, stderrFd],
      },
    );
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  keeperLaunchPendingUntil = Date.now() + 10_000;
  keeperProcess.once('error', (error) => {
    keeperLaunchPendingUntil = 0;
    log('保活器启动错误', { error: error.stack || error.message });
  });
  keeperProcess.once('exit', (code, signal) => {
    keeperLaunchPendingUntil = 0;
    log('保活器启动进程已退出', { launcherPid: keeperProcess.pid, code, signal });
  });
  keeperProcess.unref();
  log('检测到保活器缺失，已发起重新启动', { launcherPid: keeperProcess.pid });
}

function shutdownSupervisor(exitCode) {
  stopping = true;
  removePidIfOwned(supervisorPidPath, process.pid);
  if (!child) {
    writeState();
    process.exit(exitCode);
  }
  terminateChild();
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (stopping) return;
    log('监督进程收到停止信号', { signal });
    shutdownSupervisor(0);
  });
}

process.on('uncaughtException', (error) => {
  log('监督进程发生未捕获异常', { error: error.stack || error.message });
  stopping = true;
  terminateChild();
  setTimeout(() => process.exit(1), 5_000).unref();
});

process.on('exit', () => {
  removePidIfOwned(supervisorPidPath, process.pid);
});

setInterval(() => {
  runHealthCheck().catch((error) => {
    log('监督进程健康检查异常', { error: error.stack || error.message });
  });
}, 15_000);
setInterval(() => {
  try {
    ensureKeeper();
  } catch (error) {
    log('保活器检查异常', { error: error.stack || error.message });
  }
}, 15_000);
log('监督进程已启动', { supervisorPid: process.pid });
startService();
setTimeout(() => {
  try {
    ensureKeeper();
  } catch (error) {
    log('首次保活器检查异常', { error: error.stack || error.message });
  }
}, 5_000).unref();
