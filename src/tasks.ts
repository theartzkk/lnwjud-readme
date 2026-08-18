import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile, resolveExecutable } from './process.js';

export type TaskState = 'running' | 'succeeded' | 'failed' | 'stopped' | 'timed_out';

export interface TaskSnapshot {
  id: string;
  label: string;
  state: TaskState;
  code: number | null;
  signal: NodeJS.Signals | null;
  startedAt: string;
  finishedAt: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

interface InternalTask extends TaskSnapshot {
  child: ChildProcess;
  stopReason: 'stopped' | 'timed_out' | null;
  timer: NodeJS.Timeout;
}

export interface TaskStartOptions {
  executable: string;
  args: string[];
  cwd: string;
  label: string;
  timeoutMs?: number;
  stdin?: string;
  env?: NodeJS.ProcessEnv;
}

export class ManagedTaskRegistry {
  private readonly tasks = new Map<string, InternalTask>();

  constructor(private readonly maxLogBytes = 512 * 1024) {}

  start(options: TaskStartOptions): TaskSnapshot {
    const id = randomUUID();
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });

    const task: InternalTask = {
      id,
      label: options.label,
      state: 'running',
      code: null,
      signal: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      stdout: '',
      stderr: '',
      truncated: false,
      child,
      stopReason: null,
      timer: setTimeout(() => {
        void this.terminate(id, 'timed_out');
      }, options.timeoutMs ?? 15 * 60_000),
    };
    this.tasks.set(id, task);

    const append = (stream: 'stdout' | 'stderr', chunk: Buffer | string) => {
      const value = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const current = task[stream];
      const remaining = this.maxLogBytes - Buffer.byteLength(current, 'utf8');
      if (remaining <= 0) {
        task.truncated = true;
        return;
      }
      const buffer = Buffer.from(value, 'utf8');
      task[stream] += buffer.subarray(0, remaining).toString('utf8');
      if (buffer.byteLength > remaining) task.truncated = true;
    };

    child.stdout?.on('data', (chunk: Buffer | string) => append('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer | string) => append('stderr', chunk));
    child.on('error', (error) => {
      append('stderr', `${error instanceof Error ? error.message : String(error)}\n`);
    });
    child.on('close', (code, signal) => {
      clearTimeout(task.timer);
      task.code = code;
      task.signal = signal;
      task.finishedAt = new Date().toISOString();
      task.state = task.stopReason ?? (code === 0 ? 'succeeded' : 'failed');
      this.prune();
    });

    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin, 'utf8');
    }
    return this.snapshot(task);
  }

  status(id: string): TaskSnapshot {
    return this.snapshot(this.require(id));
  }

  logs(id: string): TaskSnapshot {
    return this.snapshot(this.require(id));
  }

  async stop(id: string): Promise<TaskSnapshot> {
    await this.terminate(id, 'stopped');
    const task = this.require(id);
    for (let attempt = 0; attempt < 50 && task.state === 'running'; attempt += 1) {
      await delay(100);
    }
    return this.snapshot(task);
  }

  private require(id: string): InternalTask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Unknown task id: ${id}`);
    return task;
  }

  private snapshot(task: InternalTask): TaskSnapshot {
    const { child: _child, stopReason: _stopReason, timer: _timer, ...snapshot } = task;
    return { ...snapshot };
  }

  private async terminate(id: string, reason: 'stopped' | 'timed_out'): Promise<void> {
    const task = this.require(id);
    if (task.state !== 'running' || task.stopReason !== null) return;
    task.stopReason = reason;
    const pid = task.child.pid;
    if (!pid) {
      task.child.kill();
      return;
    }

    if (process.platform === 'win32') {
      try {
        const taskkill = await resolveExecutable('taskkill');
        await execFile(taskkill, ['/PID', String(pid), '/T', '/F'], process.cwd(), 10_000);
        return;
      } catch {
        task.child.kill();
        return;
      }
    }

    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      task.child.kill('SIGTERM');
    }
  }

  private prune(): void {
    if (this.tasks.size <= 100) return;
    for (const [id, task] of this.tasks) {
      if (task.state !== 'running') this.tasks.delete(id);
      if (this.tasks.size <= 100) return;
    }
  }
}
