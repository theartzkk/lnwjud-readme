import { stat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { execFile, resolveExecutable } from './process.js';

const TUNNEL_ID = /^tunnel_[a-z0-9]{32}$/;

export interface TunnelReadiness {
  binaryConfigured: boolean;
  binaryReady: boolean;
  binaryPath?: string;
  binaryVersion?: string;
  pathDiagnosticCandidate?: string;
  runtimeKeyPresent: boolean;
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

export async function inspectTunnelReadiness(
  workspace: string,
  appExecutable: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TunnelReadiness> {
  const configuredPath = trimmed(env.TUNNEL_CLIENT_BIN);
  const runtimeKeyPresent = trimmed(env.CONTROL_PLANE_API_KEY) !== undefined;
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
        const result = await execFile(canonical, ['--version'], dirname(canonical), 5_000);
        if (result.code !== 0) {
          blockers.push(`tunnel-client --version exited with code ${result.code}`);
        } else {
          const version = (result.stdout || result.stderr).trim().split(/\r?\n/, 1)[0]?.trim();
          if (!version) {
            blockers.push('tunnel-client --version returned no version text');
          } else {
            binaryReady = true;
            binaryPath = canonical;
            binaryVersion = version;
          }
        }
      }
    } catch (error) {
      blockers.push(`Configured tunnel-client is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!runtimeKeyPresent) blockers.push('CONTROL_PLANE_API_KEY is not present');
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
    tunnelIdPresent,
    tunnelIdValid,
    ...(tunnelIdValid && tunnelId ? { tunnelId } : {}),
    packagedMcpReady,
    ...(isAbsolute(appExecutable) ? { appExecutable } : {}),
    ...(appAsar ? { appAsar } : {}),
    ...(mcpCommand ? { mcpCommand } : {}),
    ready: binaryReady && runtimeKeyPresent && tunnelIdValid && packagedMcpReady,
    blockers,
  };
}
