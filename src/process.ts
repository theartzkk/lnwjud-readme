import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, extname, isAbsolute, join } from 'node:path';
import { spawn } from 'node:child_process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
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

export async function runPackageScript(
  cwd: string,
  packageManager: string | undefined,
  command: 'test' | 'lint' | 'typecheck' | 'build',
): Promise<ExecResult> {
  const manager = packageManager?.startsWith('pnpm@')
    ? 'pnpm'
    : packageManager?.startsWith('yarn@')
      ? 'yarn'
      : 'npm';
  const managerPath = await resolveExecutable(manager);
  const managerArgs = manager === 'npm' ? ['run', command] : [command];

  if (process.platform === 'win32' && ['.cmd', '.bat'].includes(extname(managerPath).toLowerCase())) {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const cmdPath = join(systemRoot, 'System32', 'cmd.exe');
    await access(cmdPath, constants.F_OK);
    const safeManagerPath = managerPath.replaceAll('"', '""');
    const commandLine = `""${safeManagerPath}" ${managerArgs.join(' ')}"`;
    return execFile(cmdPath, ['/d', '/s', '/c', commandLine], cwd, 15 * 60_000);
  }

  return execFile(managerPath, managerArgs, cwd, 15 * 60_000);
}
