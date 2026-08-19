import { createHash } from 'node:crypto';
import { stat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { execFile, resolveExecutable, type ExecResult } from './process.js';

const TUNNEL_ID = /^tunnel_[a-z0-9]{32}$/;
const RUNTIME_KEY = /^[0-9A-Za-z_-]+$/;
const TUNNEL_HELP_SIGNATURE = 'Tunnel client for the OpenAI MCP control plane';
const RUNTIME_KEY_REF = 'env:CONTROL_PLANE_API_KEY';
const CONNECT_TIMEOUT_MS = 30_000;
const STATUS_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 15_000;

const REMOTE_ENV_DENY = new Set([
  'OPENAI_API_KEY',
  'OPENAI_ADMIN_KEY',
  'CODEX_API_KEY',
  'NODE_OPTIONS',
  'NODE_PATH',
  'ELECTRON_RUN_AS_NODE',
  'ART_AGENT_ALLOW_WRITE',
  'ART_AGENT_ALLOW_EXEC',
  'ART_AGENT_ALLOW_CODEX',
]);

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

export type TunnelCommandRunner = (
  binary: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
) => Promise<ExecResult>;

export type TunnelRuntimeState = 'connected' | 'starting' | 'stopped';

export interface TunnelRuntimeStatus {
  alias: string;
  state: TunnelRuntimeState;
  connected: boolean;
  processRunning: boolean;
  healthy: boolean;
  ready: boolean;
  runtimeState: string;
}

export interface TunnelConnectResult extends TunnelRuntimeStatus {
  connectAccepted: true;
}

export interface TunnelStopResult extends TunnelRuntimeStatus {
  stopAccepted: true;
}

interface ConfiguredTunnelBinary {
  path: string;
  version: string;
}

interface RuntimeStatusPayload {
  alias?: unknown;
  process_running?: unknown;
  healthy?: unknown;
  ready?: unknown;
  runtime_state?: unknown;
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

export function tunnelRuntimeAlias(workspace: string): string {
  if (!isAbsolute(workspace)) throw new Error('Tunnel runtime workspace must be an absolute canonical path');
  const digest = createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 16);
  return `art-agent-${digest}`;
}

export function tunnelRuntimeEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (REMOTE_ENV_DENY.has(key.toUpperCase())) continue;
    if (value !== undefined) env[key] = value;
  }
  env.ELECTRON_RUN_AS_NODE = '1';
  env.ART_AGENT_ALLOW_WRITE = '0';
  env.ART_AGENT_ALLOW_EXEC = '0';
  env.ART_AGENT_ALLOW_CODEX = '0';
  return env;
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

async function validateConfiguredTunnelBinary(
  configuredPath: string,
  probeBinary: TunnelBinaryProbe,
): Promise<ConfiguredTunnelBinary> {
  if (!isAbsolute(configuredPath)) throw new Error('TUNNEL_CLIENT_BIN must be an absolute path');
  const canonical = await realpath(configuredPath);
  const info = await stat(canonical);
  if (!info.isFile()) throw new Error('Configured tunnel-client path is not a file');
  const probe = await probeBinary(canonical);
  return { path: canonical, version: probe.version };
}

async function requireConfiguredTunnelBinary(
  env: NodeJS.ProcessEnv,
  probeBinary: TunnelBinaryProbe,
): Promise<ConfiguredTunnelBinary> {
  const configuredPath = trimmed(env.TUNNEL_CLIENT_BIN);
  if (!configuredPath) throw new Error('TUNNEL_CLIENT_BIN is not configured');
  return validateConfiguredTunnelBinary(configuredPath, probeBinary);
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
  } else {
    try {
      const binary = await validateConfiguredTunnelBinary(configuredPath, probeBinary);
      binaryReady = true;
      binaryPath = binary.path;
      binaryVersion = binary.version;
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

const defaultTunnelRunner: TunnelCommandRunner = (binary, args, cwd, timeoutMs, env) =>
  execFile(binary, args, cwd, timeoutMs, env);

function parseJsonObject(text: string, operation: string): Record<string, unknown> {
  const trimmedText = text.trim();
  if (!trimmedText) throw new Error(`tunnel-client ${operation} returned no JSON output`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmedText);
  } catch {
    throw new Error(`tunnel-client ${operation} returned invalid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`tunnel-client ${operation} returned an invalid JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function parseRuntimeStatus(alias: string, payload: RuntimeStatusPayload): TunnelRuntimeStatus {
  if (payload.alias !== alias) throw new Error('tunnel-client status alias did not match the requested Art Agent runtime');
  const processRunning = payload.process_running === true;
  const healthy = payload.healthy === true;
  const ready = payload.ready === true;
  const runtimeState = typeof payload.runtime_state === 'string' ? payload.runtime_state : 'unknown';
  const connected = processRunning && healthy && ready && runtimeState === 'ready';
  const state: TunnelRuntimeState = connected ? 'connected' : processRunning ? 'starting' : 'stopped';
  return { alias, state, connected, processRunning, healthy, ready, runtimeState };
}

async function runRuntimeStatus(
  binaryPath: string,
  alias: string,
  env: NodeJS.ProcessEnv,
  runner: TunnelCommandRunner,
): Promise<TunnelRuntimeStatus> {
  const result = await runner(
    binaryPath,
    ['runtimes', 'status', alias, '--json'],
    dirname(binaryPath),
    STATUS_TIMEOUT_MS,
    env,
  );
  if (result.code !== 0) throw new Error(`tunnel-client status exited with code ${result.code}`);
  return parseRuntimeStatus(alias, parseJsonObject(result.stdout, 'status') as RuntimeStatusPayload);
}

export async function tunnelRuntimeStatus(
  workspace: string,
  env: NodeJS.ProcessEnv = process.env,
  probeBinary: TunnelBinaryProbe = probeTunnelClientBinary,
  runner: TunnelCommandRunner = defaultTunnelRunner,
): Promise<TunnelRuntimeStatus> {
  const binary = await requireConfiguredTunnelBinary(env, probeBinary);
  const alias = tunnelRuntimeAlias(workspace);
  return runRuntimeStatus(binary.path, alias, tunnelRuntimeEnvironment(env), runner);
}

export async function connectTunnelRuntime(
  workspace: string,
  appExecutable: string,
  env: NodeJS.ProcessEnv = process.env,
  probeBinary: TunnelBinaryProbe = probeTunnelClientBinary,
  runner: TunnelCommandRunner = defaultTunnelRunner,
): Promise<TunnelConnectResult> {
  const readiness = await inspectTunnelReadiness(workspace, appExecutable, env, probeBinary);
  if (!readiness.ready || !readiness.binaryPath || !readiness.tunnelId || !readiness.mcpCommand) {
    throw new Error(`Tunnel is not ready: ${readiness.blockers.join('; ') || 'required runtime inputs are missing'}`);
  }

  const alias = tunnelRuntimeAlias(workspace);
  const childEnv = tunnelRuntimeEnvironment(env);
  const args = [
    'runtimes',
    'connect',
    '--alias', alias,
    '--tunnel-id', readiness.tunnelId,
    '--runtime-api-key', RUNTIME_KEY_REF,
    '--mcp-command', readiness.mcpCommand,
    '--tunnel-client-bin', readiness.binaryPath,
    '--json',
  ];
  const result = await runner(
    readiness.binaryPath,
    args,
    dirname(readiness.binaryPath),
    CONNECT_TIMEOUT_MS,
    childEnv,
  );
  if (result.code !== 0) throw new Error(`tunnel-client connect exited with code ${result.code}`);
  const connectPayload = parseJsonObject(result.stdout, 'connect');
  if (typeof connectPayload.alias === 'string' && connectPayload.alias !== alias) {
    throw new Error('tunnel-client connect alias did not match the requested Art Agent runtime');
  }

  const status = await runRuntimeStatus(readiness.binaryPath, alias, childEnv, runner);
  return { ...status, connectAccepted: true };
}

export async function stopTunnelRuntime(
  workspace: string,
  env: NodeJS.ProcessEnv = process.env,
  probeBinary: TunnelBinaryProbe = probeTunnelClientBinary,
  runner: TunnelCommandRunner = defaultTunnelRunner,
): Promise<TunnelStopResult> {
  const binary = await requireConfiguredTunnelBinary(env, probeBinary);
  const alias = tunnelRuntimeAlias(workspace);
  const childEnv = tunnelRuntimeEnvironment(env);
  const result = await runner(
    binary.path,
    ['runtimes', 'stop', alias, '--json'],
    dirname(binary.path),
    STOP_TIMEOUT_MS,
    childEnv,
  );
  if (result.code !== 0) throw new Error(`tunnel-client stop exited with code ${result.code}`);
  const stopPayload = parseJsonObject(result.stdout, 'stop');
  if (typeof stopPayload.alias === 'string' && stopPayload.alias !== alias) {
    throw new Error('tunnel-client stop alias did not match the requested Art Agent runtime');
  }

  const status = await runRuntimeStatus(binary.path, alias, childEnv, runner);
  return { ...status, stopAccepted: true };
}
