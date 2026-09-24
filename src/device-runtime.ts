import { access, readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AwhDeviceRuntime {
  guiMcpUrl: string | null;
  guiToolkitCommand: string | null;
  systemMcpCommand: string | null;
}

export interface DeviceRuntimeProbeOptions {
  home?: string;
  platform?: NodeJS.Platform;
  pathAvailable?: (path: string) => Promise<boolean>;
  tcpReady?: (url: string) => Promise<boolean>;
}

function validatedLoopbackMcpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 512) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)) return null;
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/mcp') return null;
  const port = Number(url.port || '80');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  return url.toString();
}
async function defaultPathAvailable(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function defaultTcpReady(value: string): Promise<boolean> {
  const url = new URL(value);
  const port = Number(url.port || '80');
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const socket = connect({ host: url.hostname.replace(/^\[|\]$/g, ''), port });
    const finish = (ready: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(800, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function discoverGuiMcpUrl(home: string, tcpReady: (url: string) => Promise<boolean>): Promise<string | null> {
  const config = join(home, 'Library', 'Application Support', 'lnwjud', 'tunnel-client', 'lnwjud.yaml');
  try {
    const raw = await readFile(config, 'utf8');
    if (raw.length > 128 * 1024) return null;
    const parsed = JSON.parse(raw) as { mcp?: { server_urls?: Array<{ url?: unknown }> } };
    const candidate = validatedLoopbackMcpUrl(parsed.mcp?.server_urls?.[0]?.url);
    return candidate && await tcpReady(candidate) ? candidate : null;
  } catch { return null; }
}
export async function discoverAwhDeviceRuntime(options: DeviceRuntimeProbeOptions = {}): Promise<AwhDeviceRuntime> {
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const pathAvailable = options.pathAvailable ?? defaultPathAvailable;
  const tcpReady = options.tcpReady ?? defaultTcpReady;
  const guiMcpUrl = platform === 'darwin' ? await discoverGuiMcpUrl(home, tcpReady) : null;
  const guiToolkitCandidates = platform === 'darwin' ? [join(home, '.kruart', 'ai-control', 'kui')] : [];
  let guiToolkitCommand: string | null = null;
  for (const candidate of guiToolkitCandidates) {
    if (await pathAvailable(candidate)) { guiToolkitCommand = candidate; break; }
  }
  const systemCandidates = platform === 'darwin' ? [
    join(home, 'Library', 'Application Support', 'AWH', 'RemoteWorker', 'runtime', 'node_modules', '.bin', 'desktop-commander'),
    join(home, '.local', 'share', 'bay-remote', 'node_modules', '.bin', 'desktop-commander'),
  ] : [];
  let systemMcpCommand: string | null = null;
  for (const candidate of systemCandidates) {
    if (await pathAvailable(candidate)) { systemMcpCommand = candidate; break; }
  }
  return { guiMcpUrl, guiToolkitCommand, systemMcpCommand };
}

export function deviceProvidersForCapability(capability: string): { gui: boolean; system: boolean } {
  if (/^(?:device\.screen\.inspect|device\.gui\.(?:inspect|operate)|browser\.automation)$/.test(capability)) return { gui: true, system: false };
  if (/^(?:device\.process|workspace\.files|system\.shell)$/.test(capability)) return { gui: false, system: true };
  return { gui: false, system: false };
}
