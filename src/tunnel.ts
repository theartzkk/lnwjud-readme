import { stat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { execFile, resolveExecutable } from './process.js';

const TUNNEL_ID = /^tunnel_[a-z0-9]{32}$/;
const RUNTIME_KEY = /^[0-9A-Za-z_-]+$/;
const TUNNEL_HELP_SIGNATURE = 'Tunnel client for the OpenAI MCP control plane';

export interface TunnelReadiness {
  binaryConfigured: boolean;
  binaryReady: boolean;
  binaryPath?: string;
  binaryVersion?: string;
  pathDiagnosticCandidate?: string;
  runtimeKeyPresent: boolean;
  runtimeKeyValid: boolean;
  tunnelIdPresent: boolean;
  tunnelIdValid: boolean;
  tunnelId?: string;
  packagedMcpReady: boolean;
  appExecutable?: string;
  appAsar?: string;
  mcpCommand?: string;
  ready: boolean;
  blockers: string[];
}

export interface TunnelBinaryProbeResult {
  version: string;
  help: string;
}

export type TunnelBinaryProbe = (path: string) => Promise<TunnelBinaryProbeResult>;

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result ? result : undefined;
}

function quoteTunnelCommandArg(value: string): string {
  if (/[\0\r\n]/.test(value)) throw new Error('Tunnel MCP command arguments must not contain NUL or newlines');
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function packagedMcpPaths(appExecutable: string): { appExecutable: string; appAsar: string; entrypoint: string } {
  if (!isAbsolute(appExecutable)) throw new Error('Packaged Art Agent executable path must be absolute');
  const appAsar = join(dirname(appExecutable), 'resources', 'app.asar');
  return {
    appExecutable,
    appAsar,
    entrypoint: join(appAsar, 'dist', 'index.js'),
  };
}

export function buildPackagedMcpCommand(appExecutable: string, workspace: string): string {
  if (!isAbsolute(workspace)) throw new Error('Remote workspace path must be absolute');
  const paths = packagedMcpPaths(appExecutable);
  return [
    paths.appExecutable,
    paths.entrypoint,
    '--workspace',
    workspace,
    '--remote-tunnel',
  ].map(quoteTunnelCommandArg).join(' ');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function pathDiagnosticCandidate(): Promise<string | undefined> {
  try {
    return await resolveExecutable('tunnel-client');
  } catch {
    return undefined;
  }
}

export async function probeTunnelClientBinary(path: string): Promise<TunnelBinaryProbeResult> {
  const cwd = dirname(path);
  const versionResult = await execFile(path, ['--version'], cwd, 5_000);
  if (versionResult.code !== 0) throw new Error(`--version exited with code ${versionResult.code}`);
  const version = (versionResult.stdout || versionResult.stderr).trim().split(/\r?\n/, 1)[0]?.trim();
  if (!version) throw new Error('--version returned no version text');

  const helpResult = await execFile(path, ['--help'], cwd, 5_000);
  if (helpResult.code !== 0) throw new Error(`--help exited with code ${helpResult.code}`);
  const help = `${helpResult.stdout}\n${helpResult.stderr}`;
  if (!help.includes(TUNNEL_HELP_SIGNATURE) || !/(?:^|\s)runtimes(?:\s|$)/m.test(help)) {
    throw new Error('binary identity does not match OpenAI tunnel-client');
  }
  return { version, help };
}

export async function inspectTunnelReadiness(
  workspace: string,
  appExecutable: string,
  env: NodeJS.ProcessEnv = process.env,
  probeBinary: TunnelBinaryProbe = probeTunnelClientBinary,
): Promise<TunnelReadiness> {
  const configuredPath = trimmed(env.TUNNEL_CLIENT_BIN);
  const runtimeKey = trimmed(env.CONTROL_PLANE_API_KEY);
  const runtimeKeyPresent = runtimeKey !== undefined;
  const runtimeKeyValid = runtimeKey !== undefined && RUNTIME_KEY.test(runtimeKey);
  const tunnelId = trimmed(env.CONTROL_PLANE_TUNNEL_ID);
  const tunnelIdPresent = tunnelId !== undefined;
  const tunnelIdValid = tunnelId !== undefined && TUNNEL_ID.test(tunnelId);
  const blockers: string[] = [];

  let binaryReady = false;
  let binaryPath: string | undefined;
  let binaryVersion: string | undefined;
  let diagnosticCandidate: string | undefined;

  if (!configuredPath) {
    blockers.push('TUNNEL_CLIENT_BIN is not configured');
    diagnosticCandidate = await pathDiagnosticCandidate();
  } else if (!isAbsolute(configuredPath)) {
    blockers.push('TUNNEL_CLIENT_BIN must be an absolute path');
  } else {
    try {
      const canonical = await realpath(configuredPath);
      const info = await stat(canonical);
      if (!info.isFile()) {
        blockers.push('Configured tunnel-client path is not a file');
      } else {
        const probe = await probeBinary(canonical);
        binaryReady = true;
        binaryPath = canonical;
        binaryVersion = probe.version;
      }
    } catch (error) {
      blockers.push(`Configured tunnel-client validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!runtimeKeyPresent) blockers.push('CONTROL_PLANE_API_KEY is not present');
  else if (!runtimeKeyValid) blockers.push('CONTROL_PLANE_API_KEY is malformed');
  if (!tunnelIdPresent) blockers.push('CONTROL_PLANE_TUNNEL_ID is not present');
  else if (!tunnelIdValid) blockers.push('CONTROL_PLANE_TUNNEL_ID is malformed');

  let packagedMcpReady = false;
  let appAsar: string | undefined;
  let mcpCommand: string | undefined;
  try {
    const paths = packagedMcpPaths(appExecutable);
    appAsar = paths.appAsar;
    if (!(await fileExists(paths.appExecutable))) {
      blockers.push('Packaged ArtAgent executable was not found');
    } else if (!(await fileExists(paths.appAsar))) {
      blockers.push('Packaged resources/app.asar was not found');
    } else {
      packagedMcpReady = true;
      mcpCommand = buildPackagedMcpCommand(paths.appExecutable, workspace);
    }
  } catch (error) {
    blockers.push(`Packaged MCP layout is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    binaryConfigured: configuredPath !== undefined,
    binaryReady,
    ...(binaryPath ? { binaryPath } : {}),
    ...(binaryVersion ? { binaryVersion } : {}),
    ...(diagnosticCandidate ? { pathDiagnosticCandidate: diagnosticCandidate } : {}),
    runtimeKeyPresent,
    runtimeKeyValid,
    tunnelIdPresent,
    tunnelIdValid,
    ...(tunnelIdValid && tunnelId ? { tunnelId } : {}),
    packagedMcpReady,
    ...(isAbsolute(appExecutable) ? { appExecutable } : {}),
    ...(appAsar ? { appAsar } : {}),
    ...(mcpCommand ? { mcpCommand } : {}),
    ready: binaryReady && runtimeKeyValid && tunnelIdValid && packagedMcpReady,
    blockers,
  };
}
