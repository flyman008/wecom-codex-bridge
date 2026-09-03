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
const entryPath = join(projectRoot, 'dist', 'src', 'index.js');
const supervisorPidPath = join(runtimeDir, 'supervisor.pid');
const servicePidPath = join(runtimeDir, 'service.pid');
const statePath = join(runtimeDir, 'supervisor-state.json');
const stopPath = join(runtimeDir, 'service.stop');
const stdoutPath = join(logDir, 'service.stdout.log');
const stderrPath = join(logDir, 'service.stderr.log');
const logPath = join(logDir, 'supervisor.log');

mkdirSync(runtimeDir, { recursive: true });
mkdirSync(logDir, { recursive: true });

function readPid(path) {
  if (!existsSync(path)) return undefined;
  const value = Number(readFileSync(path, 'utf8').trim());
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function processExists(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removePidIfOwned(path, pid) {
  if (readPid(path) === pid) rmSync(path, { force: true });
}

function log(message, details = {}) {
  appendFileSync(
    logPath,
    `${JSON.stringify({ time: new Date().toISOString(), message, ...details })}\n`,
    'utf8',
  );
}

const existingPid = readPid(supervisorPidPath);
if (existingPid && existingPid !== process.pid && processExists(existingPid)) process.exit(0);
if (!existsSync(entryPath) || existsSync(stopPath)) process.exit(existsSync(entryPath) ? 0 : 1);

let child;
let stopping = false;
let restartCount = 0;
let healthFailures = 0;
writeFileSync(supervisorPidPath, `${process.pid}\n`, 'ascii');

function writeState() {
  writeFileSync(
    statePath,
    `${JSON.stringify({
      supervisorPid: process.pid,
      servicePid: child?.pid,
      restartCount,
      healthFailures,
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`,
    'utf8',
  );
}

function forceStop(target) {
  if (!target || target.exitCode !== null || target.signalCode !== null) return;
  spawnSync('taskkill.exe', ['/PID', String(target.pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
  });
}

function startService() {
  if (stopping || existsSync(stopPath)) return;
  const stdoutFd = openSync(stdoutPath, 'a');
  const stderrFd = openSync(stderrPath, 'a');
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
  healthFailures = 0;
  writeFileSync(servicePidPath, `${child.pid}\n`, 'ascii');
  writeState();
  log('Service started', { servicePid: child.pid, restartCount });
  child.once('exit', (code, signal) => {
    const exitedPid = child.pid;
    removePidIfOwned(servicePidPath, exitedPid);
    child = undefined;
    writeState();
    if (stopping || existsSync(stopPath)) return;
    restartCount += 1;
    log('Service exited; restarting', { servicePid: exitedPid, code, signal, restartCount });
    setTimeout(startService, Math.min(30_000, restartCount * 1_000));
  });
}

async function healthy() {
  return new Promise((resolveHealth) => {
    const request = get(
      { hostname: '127.0.0.1', port: 8787, path: '/health', timeout: 5_000 },
      (response) => {
        response.resume();
        resolveHealth(response.statusCode === 200);
      },
    );
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolveHealth(false));
  });
}

setInterval(async () => {
  if (stopping || !child) return;
  if (await healthy()) {
    healthFailures = 0;
  } else {
    healthFailures += 1;
    if (healthFailures >= 3) forceStop(child);
  }
  writeState();
}, 30_000);

function shutdown() {
  if (stopping) return;
  stopping = true;
  removePidIfOwned(supervisorPidPath, process.pid);
  forceStop(child);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, shutdown);
process.on('exit', () => removePidIfOwned(supervisorPidPath, process.pid));
process.on('uncaughtException', (error) => {
  log('Supervisor error', { error: error.stack || error.message });
  shutdown();
  process.exitCode = 1;
});

log('Supervisor started', { supervisorPid: process.pid });
startService();
