import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, dirname, extname, isAbsolute, join } from 'node:path';
import { spawn } from 'node:child_process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type PackageCommand = 'test' | 'lint' | 'typecheck' | 'build' | 'check';
export type ApprovedProjectOperation = 'test' | 'typecheck' | 'build' | 'qa-fast' | 'qa-local' | 'qa-full';

const APPROVED_PROJECT_SCRIPTS: Record<ApprovedProjectOperation, string> = {
  test: 'test',
  typecheck: 'typecheck',
  build: 'build',
  'qa-fast': 'qa:fast',
  'qa-local': 'qa:local',
  'qa-full': 'qa:full',
};

export interface ProcessInvocation {
  executable: string;
  args: string[];
}

function discoveryDirectories(): string[] {
  const pathEntries = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const home = process.env.HOME ?? process.env.USERPROFILE;
  const userDirectories = home
    ? [join(home, '.local', 'bin'), join(home, 'bin'), join(home, '.asdf', 'shims'), join(home, '.nvm', 'current', 'bin'), join(home, '.fnm', 'current', 'bin')]
    : [];
  const commonDirectories = process.platform === 'darwin'
    ? ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/sbin', '/opt/local/bin', '/opt/local/sbin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
    : process.platform === 'win32'
      ? [
          process.env.ProgramFiles ? join(process.env.ProgramFiles, 'nodejs') : '',
          process.env.APPDATA ? join(process.env.APPDATA, 'npm') : '',
          process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps') : '',
        ]
      : ['/usr/local/bin', '/usr/local/sbin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  return [...new Set([...pathEntries, dirname(process.execPath), ...userDirectories, ...commonDirectories].filter(Boolean))];
}

async function executableExists(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === 'win32' ? constants.F_OK : constants.F_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveExecutable(command: string): Promise<string> {
  if (isAbsolute(command)) {
    if (!(await executableExists(command))) throw new Error(`Executable is not available: ${command}`);
    return command;
  }
  if (!/^[A-Za-z0-9._+-]+$/.test(command)) throw new Error(`Executable name is unsafe: ${command}`);

  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  const hasExtension = extname(command) !== '';

  for (const rawDir of discoveryDirectories()) {
    const dir = rawDir.replace(/^"|"$/g, '');
    const candidates = hasExtension ? [join(dir, command)] : extensions.map((ext) => join(dir, `${command}${ext}`));
    for (const candidate of candidates) {
      if (await executableExists(candidate)) return candidate;
    }
  }

  throw new Error(`Executable not found on PATH: ${command}`);
}

export function execFile(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs = 30_000,
  env?: NodeJS.ProcessEnv,
): Promise<ExecResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(env ? { env } : {}),
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

export function approvedProjectScript(operation: ApprovedProjectOperation): string {
  return APPROVED_PROJECT_SCRIPTS[operation];
}

async function resolvePackageScriptInvocation(
  packageManager: string | undefined,
  script: string,
): Promise<ProcessInvocation> {
  if (!/^[A-Za-z0-9:_-]+$/.test(script)) throw new Error(`Package script name is unsafe: ${script}`);
  const manager: 'npm' | 'pnpm' | 'yarn' = packageManager?.startsWith('pnpm@')
    ? 'pnpm'
    : packageManager?.startsWith('yarn@')
      ? 'yarn'
      : 'npm';
  const managerPath = await resolveExecutable(manager);
  const managerArgs = manager === 'npm' ? ['run', script] : [script];
  if (process.platform === 'win32' && ['.cmd', '.bat'].includes(extname(managerPath).toLowerCase())) {
    const cli = await resolveWindowsPackageCli(manager, managerPath);
    return { executable: process.execPath, args: [cli, ...managerArgs] };
  }
  return { executable: managerPath, args: managerArgs };
}

export async function resolvePackageInvocation(
  packageManager: string | undefined,
  command: PackageCommand,
): Promise<ProcessInvocation> {
  return resolvePackageScriptInvocation(packageManager, command);
}

export async function resolveApprovedProjectInvocation(
  packageManager: string | undefined,
  operation: ApprovedProjectOperation,
): Promise<ProcessInvocation> {
  return resolvePackageScriptInvocation(packageManager, approvedProjectScript(operation));
}

export async function runPackageScript(
  cwd: string,
  packageManager: string | undefined,
  command: PackageCommand,
  env?: NodeJS.ProcessEnv,
): Promise<ExecResult> {
  const invocation = await resolvePackageInvocation(packageManager, command);
  return execFile(invocation.executable, invocation.args, cwd, 15 * 60_000, env);
}
