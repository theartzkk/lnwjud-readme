import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, win32 as pathWin32 } from 'node:path';

export type RemoteDesktopConnectorState = 'READY' | 'AUTHORIZATION_REQUIRED' | 'STARTING' | 'UNAVAILABLE';

export interface RemoteDesktopConnectorStatus {
  state: RemoteDesktopConnectorState;
  authorized: boolean;
  running: boolean;
  managed: boolean;
  reason: string | null;
}

interface ConnectorPaths {
  session: string;
  node: string;
  entry: string;
  pid: string;
  log: string;
  legacySupervisor: string | null;
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

function paths(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): ConnectorPaths | null {
  if (platform === 'darwin') {
    const awh = join(home, 'Library', 'Application Support', 'AWH');
    const systemEntry = join(awh, 'SystemRuntime', 'runtime', 'node_modules', '@wonderwhy-er', 'desktop-commander', 'dist', 'index.js');
    const privateNodeRoot = join(awh, 'Toolchain');
    // Exact Node version is resolved below by directory discovery only inside
    // AWH-owned Toolchain; no PATH or user command is accepted.
    return {
      session: join(home, '.desktop-commander-device', 'device.json'),
      node: privateNodeRoot,
      entry: systemEntry,
      pid: join(awh, 'DeviceRuntime', 'remote-desktop.pid'),
      log: join(home, 'Library', 'Logs', 'AWH-Remote-Desktop-MCP.log'),
      legacySupervisor: join(home, 'Library', 'LaunchAgents', 'com.awh.remote-worker.plist'),
    };
  }
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA;
    const profile = env.USERPROFILE;
    if (!local || !profile) return null;
    const awh = pathWin32.join(local, 'AWH');
    return {
      session: pathWin32.join(profile, '.desktop-commander-device', 'device.json'),
      node: pathWin32.join(awh, 'Toolchain'),
      entry: pathWin32.join(awh, 'SystemRuntime', 'runtime', 'node_modules', '@wonderwhy-er', 'desktop-commander', 'dist', 'index.js'),
      pid: pathWin32.join(awh, 'DeviceRuntime', 'remote-desktop.pid'),
      log: pathWin32.join(awh, 'DeviceRuntime', 'remote-desktop.log'),
      legacySupervisor: null,
    };
  }
  return null;
}

async function resolvePrivateNode(platform: NodeJS.Platform, toolchainRoot: string): Promise<string | null> {
  const { readdir } = await import('node:fs/promises');
  let entries: string[];
  try { entries = await readdir(toolchainRoot); } catch { return null; }
  const candidates = entries.filter((name) => /^node-24\.21\.0-(?:arm64|x64)$/.test(name)).sort();
  for (const name of candidates) {
    const node = platform === 'win32' ? pathWin32.join(toolchainRoot, name, 'node.exe') : join(toolchainRoot, name, 'bin', 'node');
    if (await exists(node)) return node;
  }
  return null;
}

async function authorizedSession(path: string): Promise<boolean> {
  try {
    const raw = await readFile(path, 'utf8');
    if (raw.length < 20 || raw.length > 64 * 1024) return false;
    const value = JSON.parse(raw) as { deviceId?: unknown; session?: { access_token?: unknown; refresh_token?: unknown } };
    const refresh = value.session?.refresh_token;
    return typeof value.deviceId === 'string' && /^[A-Za-z0-9._:-]{8,160}$/.test(value.deviceId)
      && typeof value.session?.access_token === 'string' && value.session.access_token.length > 16
      && (refresh === undefined || refresh === null || (typeof refresh === 'string' && refresh.length >= 8));
  } catch { return false; }
}

function processAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 2) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function managedPid(path: string): Promise<number | null> {
  try {
    const value = Number((await readFile(path, 'utf8')).trim());
    return processAlive(value) ? value : null;
  } catch { return null; }
}

export async function remoteDesktopConnectorStatus(platform: NodeJS.Platform = process.platform, home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<RemoteDesktopConnectorStatus> {
  const spec = paths(platform, home, env);
  if (!spec) return { state: 'UNAVAILABLE', authorized: false, running: false, managed: false, reason: 'PLATFORM_NOT_SUPPORTED' };
  const [authorized, pid, entry, legacy] = await Promise.all([authorizedSession(spec.session), managedPid(spec.pid), exists(spec.entry), spec.legacySupervisor ? exists(spec.legacySupervisor) : Promise.resolve(false)]);
  if (!entry) return { state: 'UNAVAILABLE', authorized, running: Boolean(pid || legacy), managed: Boolean(pid), reason: 'REMOTE_DESKTOP_RUNTIME_MISSING' };
  if (pid && authorized) return { state: 'READY', authorized: true, running: true, managed: true, reason: null };
  // Existing AWH installations may still have the old launchd supervisor.
  // Honor it during migration instead of starting a duplicate remote session.
  if (legacy && authorized) return { state: 'READY', authorized: true, running: true, managed: false, reason: 'LEGACY_SUPERVISOR_PRESENT' };
  if (pid) return { state: 'AUTHORIZATION_REQUIRED', authorized: false, running: true, managed: true, reason: 'ONE_TIME_BROWSER_APPROVAL_REQUIRED' };
  return { state: authorized ? 'STARTING' : 'AUTHORIZATION_REQUIRED', authorized, running: false, managed: false, reason: authorized ? 'CONNECTOR_NOT_RUNNING' : 'ONE_TIME_BROWSER_APPROVAL_REQUIRED' };
}

export async function ensureRemoteDesktopConnector(platform: NodeJS.Platform = process.platform, home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<RemoteDesktopConnectorStatus> {
  const spec = paths(platform, home, env);
  if (!spec) return { state: 'UNAVAILABLE', authorized: false, running: false, managed: false, reason: 'PLATFORM_NOT_SUPPORTED' };
  const current = await remoteDesktopConnectorStatus(platform, home, env);
  if (current.running) return current;
  const node = await resolvePrivateNode(platform, spec.node);
  if (!node || !(await exists(spec.entry))) return { ...current, state: 'UNAVAILABLE', reason: 'REMOTE_DESKTOP_RUNTIME_MISSING' };
  await mkdir(dirname(spec.pid), { recursive: true, mode: 0o700 });
  await mkdir(dirname(spec.log), { recursive: true, mode: 0o700 }).catch(() => undefined);
  await rm(spec.pid, { force: true }).catch(() => undefined);
  const fd = openSync(spec.log, 'a', 0o600);
  try {
    const child = spawn(node, [spec.entry, 'remote', '--persist-session'], {
      detached: true,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', fd, fd],
      env: { ...env, AWH_REMOTE_DESKTOP_MANAGED: '1' },
    });
    child.unref();
    if (!child.pid || child.pid < 2) return { ...current, state: 'UNAVAILABLE', reason: 'REMOTE_DESKTOP_START_FAILED' };
    await writeFile(spec.pid, String(child.pid) + '\n', { encoding: 'utf8', mode: 0o600 });
  } finally { closeSync(fd); }
  await new Promise((resolve) => setTimeout(resolve, 750));
  const next = await remoteDesktopConnectorStatus(platform, home, env);
  return next.authorized && next.running
    ? { ...next, state: 'READY', reason: null }
    : { ...next, state: 'AUTHORIZATION_REQUIRED', reason: 'ONE_TIME_BROWSER_APPROVAL_REQUIRED' };
}
