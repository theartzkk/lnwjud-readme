import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile, resolveExecutable } from './process.js';

export type TaskState = 'running' | 'succeeded' | 'failed' | 'stopped' | 'timed_out' | 'unknown_after_restart';

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
  historyOnly?: boolean;
}

export type TaskSummary = Omit<TaskSnapshot, 'stdout' | 'stderr'>;

interface InternalTask extends TaskSnapshot {
  child: ChildProcess;
  stopReason: 'stopped' | 'timed_out' | null;
  timer: NodeJS.Timeout;
}

interface PersistedTask {
  schema: 1;
  runtimeId: string;
  id: string;
  label: string;
  state: TaskState;
  code: number | null;
  signal: NodeJS.Signals | null;
  startedAt: string;
  finishedAt: string | null;
  truncated: boolean;
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

const TASK_ID = /^[A-Za-z0-9-]{1,120}$/;
const TASK_STATES = new Set<TaskState>(['running', 'succeeded', 'failed', 'stopped', 'timed_out', 'unknown_after_restart']);
const MAX_PERSISTED_TASKS = 500;
const MAX_TASK_METADATA_BYTES = 64 * 1024;
const MAX_TASK_LABEL_CHARS = 200;

export class ManagedTaskRegistry {
  private readonly tasks = new Map<string, InternalTask>();
  private readonly runtimeId = randomUUID();

  constructor(
    private readonly maxLogBytes = 512 * 1024,
    private readonly dataDir?: string,
  ) {}

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
      label: options.label.slice(0, MAX_TASK_LABEL_CHARS),
      state: 'running',
      code: null,
      signal: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      stdout: '',
      stderr: '',
      truncated: false,
      historyOnly: false,
      child,
      stopReason: null,
      timer: setTimeout(() => {
        void this.terminate(id, 'timed_out');
      }, options.timeoutMs ?? 15 * 60_000),
    };
    this.tasks.set(id, task);
    this.persist(task);

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
      this.persist(task);
      this.prune();
      this.prunePersistent();
    });

    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin, 'utf8');
    }
    return this.snapshot(task);
  }

  status(id: string): TaskSnapshot {
    const active = this.tasks.get(id);
    if (active) return this.snapshot(active);
    const historical = this.readPersisted(id);
    if (historical) return historical;
    throw new Error(`Unknown task id: ${id}`);
  }

  logs(id: string): TaskSnapshot {
    return this.snapshot(this.requireActive(id));
  }

  list(limit = 20): TaskSummary[] {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const byId = new Map<string, TaskSnapshot>();
    for (const [id, task] of this.tasks) byId.set(id, this.snapshot(task));
    for (const task of this.readPersistedList()) {
      if (!byId.has(task.id)) byId.set(task.id, task);
    }
    return [...byId.values()]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, boundedLimit)
      .map(({ stdout: _stdout, stderr: _stderr, ...summary }) => summary);
  }

  async stop(id: string): Promise<TaskSnapshot> {
    await this.terminate(id, 'stopped');
    const task = this.requireActive(id);
    for (let attempt = 0; attempt < 50 && task.state === 'running'; attempt += 1) {
      await delay(100);
    }
    return this.snapshot(task);
  }

  private requireActive(id: string): InternalTask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Unknown active task id: ${id}`);
    return task;
  }

  private snapshot(task: InternalTask): TaskSnapshot {
    const { child: _child, stopReason: _stopReason, timer: _timer, ...snapshot } = task;
    return { ...snapshot, historyOnly: false };
  }

  private tasksDir(): string | null {
    return this.dataDir ? join(this.dataDir, 'tasks') : null;
  }

  private taskFile(id: string): string | null {
    if (!TASK_ID.test(id)) return null;
    const root = this.tasksDir();
    return root ? join(root, `${id}.json`) : null;
  }

  private persistedRecord(task: InternalTask): PersistedTask {
    return {
      schema: 1,
      runtimeId: this.runtimeId,
      id: task.id,
      label: task.label,
      state: task.state,
      code: task.code,
      signal: task.signal,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      truncated: task.truncated,
    };
  }

  private persist(task: InternalTask): void {
    const file = this.taskFile(task.id);
    const root = this.tasksDir();
    if (!file || !root) return;
    mkdirSync(root, { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(this.persistedRecord(task))}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, file);
  }

  private parsePersisted(file: string, expectedId?: string): PersistedTask | null {
    try {
      if (statSync(file).size > MAX_TASK_METADATA_BYTES) return null;
      const value = JSON.parse(readFileSync(file, 'utf8')) as Partial<PersistedTask>;
      if (
        value.schema !== 1 ||
        typeof value.runtimeId !== 'string' || value.runtimeId.length > 120 ||
        typeof value.id !== 'string' || !TASK_ID.test(value.id) ||
        (expectedId !== undefined && value.id !== expectedId) ||
        typeof value.label !== 'string' || value.label.length > MAX_TASK_LABEL_CHARS ||
        typeof value.state !== 'string' || !TASK_STATES.has(value.state as TaskState) ||
        (value.code !== null && typeof value.code !== 'number') ||
        (value.signal !== null && typeof value.signal !== 'string') ||
        typeof value.startedAt !== 'string' || Number.isNaN(Date.parse(value.startedAt)) ||
        (value.finishedAt !== null && (typeof value.finishedAt !== 'string' || Number.isNaN(Date.parse(value.finishedAt)))) ||
        typeof value.truncated !== 'boolean'
      ) return null;
      return value as PersistedTask;
    } catch {
      return null;
    }
  }

  private historicalSnapshot(record: PersistedTask): TaskSnapshot {
    const staleRunning = record.state === 'running' && record.runtimeId !== this.runtimeId;
    return {
      id: record.id,
      label: record.label,
      state: staleRunning ? 'unknown_after_restart' : record.state,
      code: record.code,
      signal: record.signal,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      stdout: '',
      stderr: '',
      truncated: record.truncated,
      historyOnly: true,
    };
  }

  private readPersisted(id: string): TaskSnapshot | null {
    const file = this.taskFile(id);
    if (!file) return null;
    const record = this.parsePersisted(file, id);
    return record ? this.historicalSnapshot(record) : null;
  }

  private readPersistedList(): TaskSnapshot[] {
    const root = this.tasksDir();
    if (!root) return [];
    let names: string[];
    try {
      names = readdirSync(root).filter((name) => name.endsWith('.json'));
    } catch {
      return [];
    }
    const out: TaskSnapshot[] = [];
    for (const name of names) {
      const id = name.slice(0, -5);
      if (!TASK_ID.test(id)) continue;
      const record = this.parsePersisted(join(root, name), id);
      if (record) out.push(this.historicalSnapshot(record));
    }
    return out;
  }

  private async terminate(id: string, reason: 'stopped' | 'timed_out'): Promise<void> {
    const task = this.requireActive(id);
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

  private prunePersistent(): void {
    const root = this.tasksDir();
    if (!root) return;
    try {
      const files = readdirSync(root)
        .filter((name) => name.endsWith('.json'))
        .map((name) => ({ name, mtimeMs: statSync(join(root, name)).mtimeMs }))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const entry of files.slice(MAX_PERSISTED_TASKS)) {
        try { unlinkSync(join(root, entry.name)); } catch { /* Best-effort bounded history cleanup. */ }
      }
    } catch {
      // Persistence must never break active task execution.
    }
  }
}
