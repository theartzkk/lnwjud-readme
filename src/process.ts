import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, dirname, extname, isAbsolute, join } from 'node:path';
import { spawn } from 'node:child_process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type PackageCommand = 'test' | 'lint' | 'typecheck' | 'build';

export interface ProcessInvocation {
  executable: string;
  args: string[];
}

export async function resolveExecutable(command: string): Promise<string> {
  if (isAbsolute(command)) {
    await access(command, constants.F_OK);
    return command;
  }

  const pathEntries = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  const hasExtension = extname(command) !== '';

  for (const rawDir of pathEntries) {
    const dir = rawDir.replace(/^"|"$/g, '');
    const candidates = hasExtension ? [join(dir, command)] : extensions.map((ext) => join(dir, `${command}${ext}`));
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.F_OK);
        return candidate;
      } catch {
        // Keep searching PATH without falling back to the workspace directory.
      }
    }
  }

  throw new Error(`Executable not found on PATH: ${command}`);
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

export async function execCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 30_000,
): Promise<ExecResult> {
  const executable = await resolveExecutable(command);
  return execFile(executable, args, cwd, timeoutMs);
}

async function firstExisting(paths: string[]): Promise<string | undefined> {
  for (const path of paths) {
    try {
      await access(path, constants.F_OK);
      return path;
    } catch {
      // Try the next known CLI layout.
    }
  }
  return undefined;
}

async function resolveWindowsPackageCli(manager: 'npm' | 'pnpm' | 'yarn', managerPath: string): Promise<string> {
  const binDir = dirname(managerPath);
  const candidates = manager === 'npm'
    ? [join(binDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')]
    : manager === 'pnpm'
      ? [
          join(binDir, 'node_modules', 'corepack', 'dist', 'pnpm.js'),
          join(binDir, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
          join(binDir, 'node_modules', 'pnpm', 'bin', 'pnpm.js'),
        ]
      : [
          join(binDir, 'node_modules', 'corepack', 'dist', 'yarn.js'),
          join(binDir, 'node_modules', 'yarn', 'bin', 'yarn.js'),
        ];

  const cli = await firstExisting(candidates);
  if (!cli) {
    throw new Error(`Safe Windows ${manager} JavaScript launcher was not found next to ${managerPath}`);
  }
  return cli;
}

export async function resolvePackageInvocation(
  packageManager: string | undefined,
  command: PackageCommand,
): Promise<ProcessInvocation> {
  const manager: 'npm' | 'pnpm' | 'yarn' = packageManager?.startsWith('pnpm@')
    ? 'pnpm'
    : packageManager?.startsWith('yarn@')
      ? 'yarn'
      : 'npm';
  const managerPath = await resolveExecutable(manager);
  const managerArgs = manager === 'npm' ? ['run', command] : [command];

  if (process.platform === 'win32' && ['.cmd', '.bat'].includes(extname(managerPath).toLowerCase())) {
    const cli = await resolveWindowsPackageCli(manager, managerPath);
    return { executable: process.execPath, args: [cli, ...managerArgs] };
  }
  return { executable: managerPath, args: managerArgs };
}

export async function runPackageScript(
  cwd: string,
  packageManager: string | undefined,
  command: PackageCommand,
): Promise<ExecResult> {
  const invocation = await resolvePackageInvocation(packageManager, command);
  return execFile(invocation.executable, invocation.args, cwd, 15 * 60_000);
}
