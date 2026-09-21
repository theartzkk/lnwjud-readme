import { extname } from 'node:path';
import { execFile, resolveExecutable } from './process.js';

export type CodexSandbox = 'read-only' | 'workspace-write';

export interface CodexDeviceProviders {
  guiMcpUrl?: string | null;
  systemMcpCommand?: string | null;
}

export interface CodexStatus {
  available: boolean;
  executable: string | null;
  version: string | null;
  error: string | null;
}

const MAX_CODEX_INSTRUCTION_CHARS = 32 * 1024;
const SECRET_VALUE_TEXT = /(?:bearer\s+[A-Za-z0-9._~-]{16,}|(?:password|secret|token|api[_-]?key)\s*[=:]\s*[^\s&]{4,}|-----begin\s+(?:private|open)[^-]*key)/i;

export function codexInstructionContainsSecretValue(value: string): boolean {
  return SECRET_VALUE_TEXT.test(value);
}

/** Allow normal multi-line prompt structure while rejecting non-text control bytes. */
export function codexInstructionContainsUnsafeControl(value: string): boolean {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

export function buildCodexArgs(workspace: string, sandbox: CodexSandbox): string[] {
  return [
    'exec',
    '--experimental-json',
    '--ephemeral',
    '--sandbox',
    sandbox,
    '--skip-git-repo-check',
    '--cd',
    workspace,
    '--config',
    'web_search="disabled"',
    '--config',
    'sandbox_workspace_write.network_access=false',
    '--config',
    'approval_policy="never"',
  ];
}

function sanitizedCodexOutput(workspace: string, stdout: string, stderr: string, code: number): string {
  const output = `${stdout}\n${stderr}`
    .replaceAll(workspace, '[workspace]')
    .replace(/(?:Bearer\s+)[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/((?:password|secret|token|api[_-]?key)\s*[=:]\s*)[^\s&]+/gi, '$1[redacted]')
    .replace(/(?:\/Users\/|\/home\/|[A-Za-z]:[\\/])[^\s'"\`]+/g, '[path]')
    .replace(/\blnwjud\b/gi, 'AWH Device Runtime')
    .replace(/Desktop\s+Commander/gi, 'AWH Device Runtime')
    .slice(-1_200);
  return output.trim() || (code === 0 ? 'Codex task completed' : `Codex task failed with exit ${code}`);
}

function validLoopbackMcp(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)
      && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/mcp'
      && Number.isInteger(Number(url.port)) && Number(url.port) >= 1024 && Number(url.port) <= 65535;
  } catch { return false; }
}

function validAbsoluteExecutable(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

export function buildCodexDeviceArgs(workspace: string, providers: CodexDeviceProviders): string[] {
  const args = [
    'exec',
    '--experimental-json',
    '--ignore-user-config',
    '--ephemeral',
    '--approve-for-me',
    '--skip-git-repo-check',
    '--cd',
    workspace,
    '--config',
    'web_search="disabled"',
  ];
  let count = 0;
  if (providers.guiMcpUrl) {
    if (!validLoopbackMcp(providers.guiMcpUrl)) throw new Error('AWH device GUI MCP endpoint is invalid');
    args.push('--config', `mcp_servers.awh_device_gui.url=${JSON.stringify(providers.guiMcpUrl)}`);
    args.push('--config', 'mcp_servers.awh_device_gui.enabled=true');
    count += 1;
  }
  if (providers.systemMcpCommand) {
    if (!validAbsoluteExecutable(providers.systemMcpCommand) || /[\u0000-\u001f\u007f]/.test(providers.systemMcpCommand)) throw new Error('AWH device system MCP executable is invalid');
    args.push('--config', `mcp_servers.awh_device_system.command=${JSON.stringify(providers.systemMcpCommand)}`);
    args.push('--config', 'mcp_servers.awh_device_system.args=[]');
    args.push('--config', 'mcp_servers.awh_device_system.enabled=true');
    count += 1;
  }
  if (count === 0) throw new Error('AWH device runtime is unavailable');
  return args;
}

export function codexEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    'PATH',
    'PATHEXT',
    'SystemRoot',
    'SYSTEMROOT',
    'COMSPEC',
    'HOME',
    'USERPROFILE',
    'LOCALAPPDATA',
    'APPDATA',
    'TEMP',
    'TMP',
    'CODEX_HOME',
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const name of allowed) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

export async function resolveCodexExecutable(): Promise<string> {
  const executable = await resolveExecutable('codex');
  if (process.platform === 'win32' && ['.cmd', '.bat'].includes(extname(executable).toLowerCase())) {
    throw new Error('Codex bridge requires a native Codex executable on Windows; .cmd/.bat shims are refused');
  }
  return executable;
}

export async function codexStatus(cwd: string): Promise<CodexStatus> {
  try {
    const executable = await resolveCodexExecutable();
    const result = await execFile(executable, ['--version'], cwd, 10_000);
    if (result.code !== 0) {
      return { available: false, executable, version: null, error: result.stderr || `exit ${result.code}` };
    }
    return { available: true, executable, version: result.stdout.trim(), error: null };
  } catch (error) {
    return { available: false, executable: null, version: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The only AWH AI execution bridge. The complete bounded instruction is content
 * passed as one argv item; it is never interpreted as a shell command. The
 * caller must have already passed the task/project approval boundary.
 */
export async function runCodexGoal(workspace: string, instruction: string, sandbox: CodexSandbox = 'read-only'): Promise<{ code: number; summary: string }> {
  if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > MAX_CODEX_INSTRUCTION_CHARS || codexInstructionContainsUnsafeControl(instruction) || codexInstructionContainsSecretValue(instruction)) throw new Error('Codex instruction is invalid');
  const executable = await resolveCodexExecutable();
  const result = await execFile(executable, [...buildCodexArgs(workspace, sandbox), instruction.trim()], workspace, 15 * 60_000, codexEnvironment());
  return { code: result.code, summary: sanitizedCodexOutput(workspace, result.stdout, result.stderr, result.code) };
}

export async function runCodexDeviceGoal(workspace: string, instruction: string, providers: CodexDeviceProviders): Promise<{ code: number; summary: string }> {
  if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > MAX_CODEX_INSTRUCTION_CHARS || codexInstructionContainsUnsafeControl(instruction) || codexInstructionContainsSecretValue(instruction)) throw new Error('Codex instruction is invalid');
  const executable = await resolveCodexExecutable();
  const result = await execFile(executable, [...buildCodexDeviceArgs(workspace, providers), instruction.trim()], workspace, 15 * 60_000, codexEnvironment());
  return { code: result.code, summary: sanitizedCodexOutput(workspace, result.stdout, result.stderr, result.code) };
}
