import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runCredentialProcess, type CredentialProcessRunner } from './credential-store.js';

const OPENAI_TUNNEL_KEYCHAIN_SERVICE = 'online.kruart.awh.local-agent.openai-runtime';
const TUNNEL_ID = /(?:^|[\s,{])["']?tunnel_id["']?\s*:\s*["']?(tunnel_[a-z0-9]{32})["']?/m;
const MAX_PROFILE_BYTES = 64 * 1024;

export class DesktopTunnelConfigError extends Error {
  constructor(message: string, readonly code = 'TUNNEL_DESKTOP_CONFIG_INVALID') {
    super(message);
    this.name = 'DesktopTunnelConfigError';
  }
}

async function fixedToolchainBinary(home: string): Promise<string | undefined> {
  const candidate = join(home, 'Library', 'Application Support', 'AWH', 'Toolchain', 'tunnel-client-current');
  try {
    const info = await stat(candidate);
    return info.isFile() ? candidate : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new DesktopTunnelConfigError('AWH tunnel-client toolchain could not be inspected');
  }
}

async function profileTunnelId(home: string): Promise<string | undefined> {
  const directory = join(home, 'Library', 'Application Support', 'AWH', 'SecureMcpTunnel', 'profiles');
  let entries;
  try {
    entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.(?:json|ya?ml)$/i.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new DesktopTunnelConfigError('AWH Secure MCP Tunnel profiles could not be inspected');
  }
  if (entries.length === 0) return undefined;
  if (entries.length > 1) throw new DesktopTunnelConfigError('Multiple AWH Secure MCP Tunnel profiles are configured');

  const path = join(directory, entries[0]!.name);
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_PROFILE_BYTES) throw new DesktopTunnelConfigError('AWH Secure MCP Tunnel profile is invalid');
  const text = await readFile(path, 'utf8');
  const match = TUNNEL_ID.exec(text);
  if (!match?.[1]) throw new DesktopTunnelConfigError('AWH Secure MCP Tunnel profile does not contain a valid tunnel id');
  return match[1];
}

async function macRuntimeKey(
  runner: CredentialProcessRunner,
): Promise<string | undefined> {
  const result = await runner('/usr/bin/security', [
    'find-generic-password',
    '-s', OPENAI_TUNNEL_KEYCHAIN_SERVICE,
    '-w',
  ]);
  if (result.exitCode === 44) return undefined;
  if (result.exitCode !== 0) throw new DesktopTunnelConfigError('AWH Secure MCP Tunnel credential is unavailable');

  const value = result.stdout.endsWith('\r\n')
    ? result.stdout.slice(0, -2)
    : result.stdout.endsWith('\n') ? result.stdout.slice(0, -1) : result.stdout;
  if (!value || value.length > 4096 || !/^[0-9A-Za-z_-]+$/.test(value)) {
    throw new DesktopTunnelConfigError('AWH Secure MCP Tunnel credential is invalid');
  }
  return value;
}

export async function resolveDesktopTunnelEnvironment(
  _dataDir: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
  runner: CredentialProcessRunner = runCredentialProcess,
  home: string = homedir(),
  platformName: NodeJS.Platform = process.platform,
): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...baseEnv };

  if (platformName === 'darwin' && !env.TUNNEL_CLIENT_BIN?.trim()) {
    const binary = await fixedToolchainBinary(home);
    if (binary) env.TUNNEL_CLIENT_BIN = binary;
  }
  if (platformName === 'darwin' && !env.CONTROL_PLANE_TUNNEL_ID?.trim()) {
    const tunnelId = await profileTunnelId(home);
    if (tunnelId) env.CONTROL_PLANE_TUNNEL_ID = tunnelId;
  }
  if (platformName === 'darwin' && !env.CONTROL_PLANE_API_KEY?.trim()) {
    const runtimeKey = await macRuntimeKey(runner);
    if (runtimeKey) env.CONTROL_PLANE_API_KEY = runtimeKey;
  }

  return env;
}
