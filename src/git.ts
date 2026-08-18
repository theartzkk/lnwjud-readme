import { spawn } from 'node:child_process';
import { assertNotSecret } from './security.js';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function execFile(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs = 30_000,
): Promise<ExecResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const max = 512 * 1024;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Process timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < max) stdout += chunk.slice(0, max - stdout.length);
    });
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < max) stderr += chunk.slice(0, max - stderr.length);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveResult({ code: code ?? -1, stdout, stderr });
    });
  });
}

function isSafeGitPath(path: string): boolean {
  try {
    assertNotSecret(path);
    return true;
  } catch {
    return false;
  }
}

export async function gitStatus(cwd: string): Promise<ExecResult> {
  const result = await execFile('git', ['status', '--short', '--branch'], cwd);
  if (result.code !== 0) return result;
  const lines = result.stdout.split(/\r?\n/);
  const safeLines = lines.filter((line) => {
    if (!line || line.startsWith('## ')) return true;
    const path = line.length > 3 ? line.slice(3).trim() : line;
    const pieces = path.split(' -> ');
    return pieces.every(isSafeGitPath);
  });
  const hiddenCount = lines.filter(Boolean).length - safeLines.filter(Boolean).length;
  if (hiddenCount > 0) safeLines.push(`[${hiddenCount} secret-path status entr${hiddenCount === 1 ? 'y' : 'ies'} hidden]`);
  return { ...result, stdout: safeLines.join('\n') };
}

export async function gitDiff(cwd: string): Promise<ExecResult> {
  const names = await execFile('git', ['diff', 'HEAD', '--name-only', '--no-ext-diff', '--'], cwd);
  if (names.code !== 0) return names;
  const safePaths = names.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).filter(isSafeGitPath);
  if (safePaths.length === 0) return { code: 0, stdout: '', stderr: '' };
  return execFile('git', ['diff', 'HEAD', '--no-ext-diff', '--', ...safePaths], cwd);
}

export async function gitLog(cwd: string, limit: number): Promise<ExecResult> {
  return execFile(
    'git',
    ['log', `-${Math.max(1, Math.min(limit, 50))}`, '--date=iso-strict', '--pretty=format:%h%x09%ad%x09%s'],
    cwd,
  );
}
