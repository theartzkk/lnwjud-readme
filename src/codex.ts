import { extname } from 'node:path';
import { execFile, resolveExecutable } from './process.js';

export type CodexSandbox = 'read-only' | 'workspace-write';

export interface CodexStatus {
  available: boolean;
  executable: string | null;
  version: string | null;
  error: string | null;
}

const MAX_CODEX_INSTRUCTION_CHARS = 32 * 1024;

export function buildCodexArgs(workspace: string, sandbox: CodexSandbox): string[] {
  return [
    'exec',
    '--experimental-json',
    '--ephemeral',
    '--sandbox',
    sandbox,
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
  if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > MAX_CODEX_INSTRUCTION_CHARS || /[\u0000-\u001f\u007f]/.test(instruction) || /(?:bearer\s+|password\s*[=:]|secret\s*[=:]|token\s*[=:]|api[_-]?key\s*[=:]|-----begin\s+(?:private|open)[^-]*key)/i.test(instruction)) throw new Error('Codex instruction is invalid');
  const executable = await resolveCodexExecutable();
  const result = await execFile(executable, [...buildCodexArgs(workspace, sandbox), instruction.trim()], workspace, 15 * 60_000, codexEnvironment());
  const output = `${result.stdout}\n${result.stderr}`
    .replaceAll(workspace, '[workspace]')
    .replace(/(?:Bearer\s+)[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/((?:password|secret|token|api[_-]?key)\s*[=:]\s*)[^\s&]+/gi, '$1[redacted]')
    .replace(/(?:\/Users\/|\/home\/|[A-Za-z]:[\\/])[^\s'"`]+/g, '[path]')
    .slice(-1_200);
  return { code: result.code, summary: output.trim() || (result.code === 0 ? 'Codex task completed' : `Codex task failed with exit ${result.code}`) };
}
