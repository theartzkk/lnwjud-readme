import { assertNotSecret } from './security.js';
import { execCommand, type ExecResult } from './process.js';

function isSafeGitPath(path: string): boolean {
  try {
    assertNotSecret(path);
    return true;
  } catch {
    return false;
  }
}

async function git(cwd: string, args: string[], timeoutMs = 30_000): Promise<ExecResult> {
  return execCommand(
    'git',
    ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'submodule.recurse=false', ...args],
    cwd,
    timeoutMs,
  );
}

export async function gitStatus(cwd: string): Promise<ExecResult> {
  const result = await git(cwd, ['status', '--short', '--branch', '--ignore-submodules=all']);
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
  const names = await git(cwd, ['diff', 'HEAD', '--name-only', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', '--']);
  if (names.code !== 0) return names;
  const safePaths = names.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter(isSafeGitPath);
  if (safePaths.length === 0) return { code: 0, stdout: '', stderr: '' };
  return git(cwd, ['diff', 'HEAD', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', '--', ...safePaths]);
}

export async function gitLog(cwd: string, limit: number): Promise<ExecResult> {
  return git(
    cwd,
    ['log', `-${Math.max(1, Math.min(limit, 50))}`, '--date=iso-strict', '--pretty=format:%h%x09%ad%x09%s'],
  );
}
