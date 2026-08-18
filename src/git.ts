import { pageText, type TextPage, type TextPageOptions } from './context.js';
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

async function safeDiffPaths(cwd: string): Promise<{
  code: number;
  stderr: string;
  safePaths: string[];
  hiddenPathCount: number;
}> {
  const names = await git(cwd, ['diff', 'HEAD', '--name-only', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', '--']);
  if (names.code !== 0) return { code: names.code, stderr: names.stderr, safePaths: [], hiddenPathCount: 0 };
  const paths = names.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const safePaths = paths.filter(isSafeGitPath);
  return {
    code: 0,
    stderr: '',
    safePaths,
    hiddenPathCount: paths.length - safePaths.length,
  };
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

export async function gitDiff(cwd: string, requestedPath?: string): Promise<ExecResult> {
  const paths = await safeDiffPaths(cwd);
  if (paths.code !== 0) return { code: paths.code, stdout: '', stderr: paths.stderr };
  const normalizedRequested = requestedPath?.trim().replaceAll('\\', '/');
  const selectedPaths = normalizedRequested
    ? paths.safePaths.filter((path) => path === normalizedRequested)
    : paths.safePaths;
  if (selectedPaths.length === 0) return { code: 0, stdout: '', stderr: '' };
  return git(cwd, ['diff', 'HEAD', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', '--', ...selectedPaths]);
}

export interface GitDiffPageResult {
  code: number;
  stderr: string;
  changedPathCount: number;
  hiddenPathCount: number;
  availablePaths: string[];
  pathsTruncated: boolean;
  selectedPath: string | null;
  pathFound: boolean | null;
  page?: TextPage;
}

export async function gitDiffPage(
  cwd: string,
  options: TextPageOptions & { path?: string } = {},
): Promise<GitDiffPageResult> {
  const paths = await safeDiffPaths(cwd);
  if (paths.code !== 0) {
    return {
      code: paths.code,
      stderr: paths.stderr,
      changedPathCount: 0,
      hiddenPathCount: 0,
      availablePaths: [],
      pathsTruncated: false,
      selectedPath: options.path?.trim().replaceAll('\\', '/') ?? null,
      pathFound: options.path ? false : null,
    };
  }

  const selectedPath = options.path?.trim().replaceAll('\\', '/') ?? null;
  const pathFound = selectedPath ? paths.safePaths.includes(selectedPath) : null;
  const diff = await gitDiff(cwd, selectedPath ?? undefined);
  if (diff.code !== 0) {
    return {
      code: diff.code,
      stderr: diff.stderr,
      changedPathCount: paths.safePaths.length,
      hiddenPathCount: paths.hiddenPathCount,
      availablePaths: paths.safePaths.slice(0, 100),
      pathsTruncated: paths.safePaths.length > 100,
      selectedPath,
      pathFound,
    };
  }

  return {
    code: 0,
    stderr: '',
    changedPathCount: paths.safePaths.length,
    hiddenPathCount: paths.hiddenPathCount,
    availablePaths: paths.safePaths.slice(0, 100),
    pathsTruncated: paths.safePaths.length > 100,
    selectedPath,
    pathFound,
    page: pageText(diff.stdout, options),
  };
}

export async function gitLog(cwd: string, limit: number): Promise<ExecResult> {
  return git(
    cwd,
    ['log', `-${Math.max(1, Math.min(limit, 50))}`, '--date=iso-strict', '--pretty=format:%h%x09%ad%x09%s'],
  );
}
