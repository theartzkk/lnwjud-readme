import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ControlPlaneWorkerClient, type WorkerTask } from '../src/control-plane-worker-client.js';
import { buildCodexTaskInstruction, ControlPlaneWorkerRuntime, officeExecutionCapabilities } from '../src/control-plane-worker-runtime.js';
import { loadOrCreateDeviceIdentity } from '../src/device-identity.js';
import type { CredentialStore } from '../src/credential-store.js';

class MemoryCredentials implements CredentialStore {
  async get(): Promise<string | null> { return null; }
  async set(): Promise<void> {}
  async delete(): Promise<void> {}
}

class FixtureWorkerClient extends ControlPlaneWorkerClient {
  heartbeatCalls = 0;
  updates: Array<{ taskId: string; state: string }> = [];
  constructor(dataDir: string, private readonly nextTask: WorkerTask | null) {
    super('https://hub.example/api/v1', dataDir, new MemoryCredentials(), async () => new Response('{}', { status: 200 }));
  }
  override async heartbeat(): Promise<{ deviceId: string; state: string; lastSeenAt: string }> {
    this.heartbeatCalls += 1;
    return { deviceId: '423b45c0-23e1-408d-ae0f-ac5eca7f6900', state: 'READY', lastSeenAt: '2026-08-21T00:00:00.000Z' };
  }
  override async claim(): Promise<WorkerTask | null> { return this.nextTask; }
  override async update(taskId: string, state: string): Promise<WorkerTask> {
    this.updates.push({ taskId, state });
    return this.nextTask ?? { taskId, projectId: '423b45c0-23e1-408d-ae0f-ac5eca7f6900', conversationId: null, goal: 'fixture', state, progress: 0, assignedDevice: null, approvalStatus: null };
  }
}

test('Office inventory becomes executable only for the matching Windows handler', () => {
  assert.deepEqual(officeExecutionCapabilities('darwin', ['tool.office.word', 'tool.office.excel']), []);
  assert.deepEqual(officeExecutionCapabilities('win32', ['tool.office.word']), ['office.word.pdf']);
  assert.deepEqual(officeExecutionCapabilities('win32', ['tool.office.excel', 'tool.office.powerpoint']).sort(), ['office.excel.pdf', 'office.powerpoint.pdf']);
  assert.deepEqual(officeExecutionCapabilities('win32', ['tool.office.word', 'tool.browser.edge']), ['office.word.pdf']);
});

test('desktop worker runtime is wired to heartbeat and truthful idle state', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'awh-worker-runtime-'));
  try {
    const identity = await loadOrCreateDeviceIdentity(dataDir);
    const client = new FixtureWorkerClient(dataDir, null);
    const runtime = new ControlPlaneWorkerRuntime(client, { dataDir, maxReadBytes: 32_000, allowExec: false, allowWrite: false, allowCodex: false });
    const result = await runtime.runOnce();
    assert.deepEqual(result, { status: 'IDLE', deviceId: identity.deviceId });
    assert.equal(client.heartbeatCalls, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('desktop worker runtime rejects an unregistered project before execution', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'awh-worker-runtime-'));
  try {
    await loadOrCreateDeviceIdentity(dataDir);
    const task: WorkerTask = { taskId: '423b45c0-23e1-408d-ae0f-ac5eca7f6900', projectId: '523b45c0-23e1-408d-ae0f-ac5eca7f6900', conversationId: null, goal: 'safe inspection', state: 'PREPARING', progress: 0, assignedDevice: '423b45c0-23e1-408d-ae0f-ac5eca7f6900', approvalStatus: null };
    const client = new FixtureWorkerClient(dataDir, task);
    const runtime = new ControlPlaneWorkerRuntime(client, { dataDir, maxReadBytes: 32_000, allowExec: true, allowWrite: false, allowCodex: false });
    const result = await runtime.runOnce();
    assert.equal(result.status, 'FAILED');
    assert.equal(result.reason, 'PROJECT_CONTEXT_REJECTED');
    assert.deepEqual(client.updates, [{ taskId: task.taskId, state: 'FAILED' }]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('Codex task instruction preserves owner protocol precedence before project memory and Goal', () => {
  const protocol = '# Art ↔ AI Working Constitution\n\nVersion: 1.0\n\nSystem-first, patch-second.';
  const goal = 'แก้ตารางรายงานโดยวิเคราะห์ระบบร่วมทั้งหมดก่อน';
  const instruction = buildCodexTaskInstruction(protocol, goal);
  const ownerIndex = instruction.indexOf('Art ↔ AI Working Constitution');
  const memoryIndex = instruction.indexOf('PROJECT CONTEXT CONTRACT');
  const goalIndex = instruction.indexOf('CURRENT OWNER GOAL');
  assert.ok(ownerIndex >= 0);
  assert.ok(memoryIndex > ownerIndex);
  assert.ok(goalIndex > memoryIndex);
  assert.match(instruction, /PROJECT\.md, HANDOFF\.md, TASKS\.md, ARCHITECTURE\.md, DECISIONS\.md/);
  assert.match(instruction, /system-first and root-cause-first/i);
  assert.match(instruction, /Do not create a parallel system/i);
  assert.match(instruction, new RegExp(goal));
});
