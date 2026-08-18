import { extname } from 'node:path';
import { execFile, resolveExecutable } from './process.js';

export type CodexSandbox = 'read-only' | 'workspace-write';

export interface CodexStatus {
  available: boolean;
  executable: string | null;
  version: string | null;
  error: string | null;
}

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
