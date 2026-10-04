import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';

const WATCHDOG_DIR = 'watchdog';
const CRASH_WINDOW_MS = 10 * 60 * 1000;
const MAX_CRASH_RESTARTS = 3;

export type AgentWatchdogState = 'HEALTHY' | 'RESTARTING' | 'BLOCKED_RESTART_STORM' | 'STOPPED';

export interface AgentWatchdogStatus {
  schemaVersion: 1;
  state: AgentWatchdogState;
  crashCount: number;
  at: string;
  pid?: number | null;
}

export interface AgentWatchdogHandle {
  pid: number | null;
  markerPath: string;
  isRunning(): boolean;
  markExpectedExit(): void;
  markHealthy(): Promise<void>;
}

function cleanPath(value: string): string {
  if (!isAbsolute(value) || /[\u0000-\u001f\u007f]/.test(value) || value.length > 2048) throw new Error('AWH_WATCHDOG_PATH_INVALID');
  return value;
}

export function boundedCrashTimestamps(values: number[], now = Date.now()): number[] {
  return values.filter((value) => Number.isFinite(value) && value > 0 && value <= now && now - value <= CRASH_WINDOW_MS).slice(-MAX_CRASH_RESTARTS);
}

export function watchdogRestartAllowed(values: number[], now = Date.now()): boolean {
  return boundedCrashTimestamps(values, now).length < MAX_CRASH_RESTARTS;
}

function watchdogRoot(dataDir: string): string { return join(dataDir, WATCHDOG_DIR); }

async function readCrashState(dataDir: string): Promise<number[]> {
  try {
    const raw = await readFile(join(watchdogRoot(dataDir), 'crashes.json'), 'utf8');
    if (raw.length > 4096) return [];
    const parsed = JSON.parse(raw) as { timestamps?: unknown };
    return Array.isArray(parsed.timestamps)
      ? boundedCrashTimestamps(parsed.timestamps.filter((item): item is number => typeof item === 'number'))
      : [];
  } catch {
    return [];
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temp = path + '.tmp-' + process.pid;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  await rename(temp, path);
}

function atomicJsonSync(path: string, value: unknown): void {
  const temp = path + '.tmp-' + process.pid;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, path);
}

async function waitForProcessExit(pid: number): Promise<void> {
  for (;;) {
    try { process.kill(pid, 0); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH' || code !== 'EPERM') return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
}

export function startAgentWatchdog(dataDir: string, appExecutable: string, scriptPath: string): AgentWatchdogHandle {
  const cleanDataDir = cleanPath(dataDir);
  const root = watchdogRoot(cleanDataDir);
  const executable = cleanPath(appExecutable);
  const script = cleanPath(scriptPath);
  if (!existsSync(script)) throw new Error('AWH_WATCHDOG_SCRIPT_MISSING');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const markerPath = join(root, 'expected-' + randomUUID() + '.marker');
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  const child = spawn(executable, [script, '--awh-agent-watchdog', String(process.pid), cleanDataDir, markerPath, executable], {
    detached: true,
    stdio: 'ignore',
    shell: false,
    windowsHide: true,
    env,
  });
  let running = child.pid !== undefined;
  child.once('exit', () => { running = false; });
  child.once('error', () => { running = false; });
  child.unref();

  return {
    pid: child.pid ?? null,
    markerPath,
    isRunning(): boolean { return running; },
    markExpectedExit(): void {
      try {
        writeFileSync(markerPath, 'expected\n', { encoding: 'utf8', mode: 0o600 });
        const crashes = boundedCrashTimestamps([]);
        atomicJsonSync(join(root, 'status.json'), {
          schemaVersion: 1,
          state: 'STOPPED',
          crashCount: crashes.length,
          at: new Date().toISOString(),
          pid: process.pid,
        } satisfies AgentWatchdogStatus);
      } catch { /* marker failure keeps recovery conservative */ }
    },
    async markHealthy(): Promise<void> {
      const crashes = await readCrashState(cleanDataDir);
      await atomicJson(join(root, 'status.json'), {
        schemaVersion: 1,
        state: 'HEALTHY',
        crashCount: crashes.length,
        at: new Date().toISOString(),
        pid: process.pid,
      } satisfies AgentWatchdogStatus);
    },
  };
}

export async function readAgentWatchdogStatus(dataDir: string): Promise<AgentWatchdogStatus | null> {
  try {
    const raw = await readFile(join(watchdogRoot(dataDir), 'status.json'), 'utf8');
    if (raw.length > 4096) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    const state = value.state;
    if (
      value.schemaVersion !== 1 ||
      !['HEALTHY', 'RESTARTING', 'BLOCKED_RESTART_STORM', 'STOPPED'].includes(String(state)) ||
      !Number.isSafeInteger(value.crashCount) ||
      typeof value.at !== 'string' ||
      !Number.isFinite(Date.parse(value.at))
    ) return null;
    const pid = value.pid === null || Number.isSafeInteger(value.pid) ? value.pid as number | null | undefined : undefined;
    return { schemaVersion: 1, state: state as AgentWatchdogState, crashCount: Number(value.crashCount), at: value.at, ...(pid !== undefined ? { pid } : {}) };
  } catch {
    return null;
  }
}

async function runWatchdog(args: string[]): Promise<void> {
  if (args.length !== 4) return;
  const parentPid = Number(args[0]);
  const dataDir = cleanPath(args[1]!);
  const markerPath = cleanPath(args[2]!);
  const appExecutable = cleanPath(args[3]!);
  if (!Number.isSafeInteger(parentPid) || parentPid < 1) return;

  const root = resolve(watchdogRoot(dataDir));
  const marker = resolve(markerPath);
  if (!marker.startsWith(root + sep)) return;
  await mkdir(root, { recursive: true, mode: 0o700 });
  await waitForProcessExit(parentPid);

  if (existsSync(marker)) {
    await rm(marker, { force: true });
    const crashes = await readCrashState(dataDir);
    await atomicJson(join(root, 'status.json'), {
      schemaVersion: 1,
      state: 'STOPPED',
      crashCount: crashes.length,
      at: new Date().toISOString(),
      pid: parentPid,
    } satisfies AgentWatchdogStatus);
    return;
  }

  const now = Date.now();
  const crashes = await readCrashState(dataDir);
  if (!watchdogRestartAllowed(crashes, now)) {
    await atomicJson(join(root, 'status.json'), {
      schemaVersion: 1,
      state: 'BLOCKED_RESTART_STORM',
      crashCount: crashes.length,
      at: new Date(now).toISOString(),
      pid: parentPid,
    } satisfies AgentWatchdogStatus);
    return;
  }

  const next = [...crashes, now];
  await atomicJson(join(root, 'crashes.json'), { schemaVersion: 1, timestamps: next });
  await atomicJson(join(root, 'status.json'), {
    schemaVersion: 1,
    state: 'RESTARTING',
    crashCount: next.length,
    at: new Date(now).toISOString(),
    pid: parentPid,
  } satisfies AgentWatchdogStatus);
  await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(appExecutable, [], { detached: true, stdio: 'ignore', shell: false, windowsHide: true, env });
  child.unref();
}

if (process.argv[2] === '--awh-agent-watchdog') {
  void runWatchdog(process.argv.slice(3)).then(() => process.exit(0), () => process.exit(1));
}
