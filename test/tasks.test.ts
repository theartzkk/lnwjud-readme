import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { ManagedTaskRegistry } from '../src/tasks.js';

async function waitForFinish(tasks: ManagedTaskRegistry, id: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (tasks.status(id).state !== 'running') return;
    await delay(25);
  }
  throw new Error('Task did not finish in time');
}

test('managed task captures bounded stdout/stderr and completion state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'art-agent-task-'));
  const tasks = new ManagedTaskRegistry(64 * 1024);
  const task = tasks.start({
    executable: process.execPath,
    args: ['-e', 'console.log("TASK_OUT"); console.error("TASK_ERR")'],
    cwd: root,
    label: 'fixture',
    timeoutMs: 5_000,
  });
  await waitForFinish(tasks, task.id);
  const logs = tasks.logs(task.id);
  assert.equal(logs.state, 'succeeded');
  assert.match(logs.stdout, /TASK_OUT/);
  assert.match(logs.stderr, /TASK_ERR/);
});

test('managed task stop only targets a registry-owned process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'art-agent-task-'));
  const tasks = new ManagedTaskRegistry();
  const task = tasks.start({
    executable: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    cwd: root,
    label: 'long-running-fixture',
    timeoutMs: 30_000,
  });
  await delay(100);
  const stopped = await tasks.stop(task.id);
  assert.equal(stopped.state, 'stopped');
  assert.throws(() => tasks.status('not-owned'), /Unknown task id/);
});

test('task metadata persists across registry restarts without logs or command details', async () => {
  const root = await mkdtemp(join(tmpdir(), 'art-agent-task-'));
  const dataDir = await mkdtemp(join(tmpdir(), 'art-agent-task-data-'));
  const tasks = new ManagedTaskRegistry(64 * 1024, dataDir);
  const task = tasks.start({
    executable: process.execPath,
    args: ['-e', 'console.log("PERSISTED_SECRET_OUTPUT")'],
    cwd: root,
    label: 'project:test',
    timeoutMs: 5_000,
  });
  await waitForFinish(tasks, task.id);

  const restarted = new ManagedTaskRegistry(64 * 1024, dataDir);
  const historical = restarted.status(task.id);
  assert.equal(historical.state, 'succeeded');
  assert.equal(historical.historyOnly, true);
  assert.equal(historical.stdout, '');
  assert.equal(historical.stderr, '');
  assert.deepEqual(restarted.list(10).map((entry) => entry.id), [task.id]);
  assert.throws(() => restarted.logs(task.id), /Unknown active task id/);

  const files = await readdir(join(dataDir, 'tasks'));
  assert.deepEqual(files, [`${task.id}.json`]);
  const raw = await readFile(join(dataDir, 'tasks', files[0]!), 'utf8');
  assert.doesNotMatch(raw, /PERSISTED_SECRET_OUTPUT|console\.log|-e|art-agent-task-/);
  assert.match(raw, /project:test/);
});

test('running metadata from another runtime is never treated as an owned live task', async () => {
  const root = await mkdtemp(join(tmpdir(), 'art-agent-task-'));
  const dataDir = await mkdtemp(join(tmpdir(), 'art-agent-task-data-'));
  const owner = new ManagedTaskRegistry(64 * 1024, dataDir);
  const task = owner.start({
    executable: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    cwd: root,
    label: 'project:test',
    timeoutMs: 30_000,
  });

  const restarted = new ManagedTaskRegistry(64 * 1024, dataDir);
  const historical = restarted.status(task.id);
  assert.equal(historical.state, 'unknown_after_restart');
  assert.equal(historical.historyOnly, true);
  assert.throws(() => restarted.logs(task.id), /Unknown active task id/);
  await assert.rejects(() => restarted.stop(task.id), /Unknown active task id/);

  const stopped = await owner.stop(task.id);
  assert.equal(stopped.state, 'stopped');
});
