import assert from 'node:assert/strict';
import test from 'node:test';
import { queueExactDeviceAction, type GatewayControlClient } from '../src/gateway-server.js';
import type { WorkerConversation, WorkerPeer, WorkerTask } from '../src/control-plane-worker-client.js';

const projectId = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
const m5Id = 'a5e185c7-1b52-4852-9776-ca3012f3a6a6';
const intelId = 'b5e185c7-1b52-4852-9776-ca3012f3a6a6';
const taskId = 'c5e185c7-1b52-4852-9776-ca3012f3a6a6';

function worker(deviceId: string, changes: Partial<WorkerPeer> = {}): WorkerPeer {
  return {
    deviceId, displayName: 'Art’s Mac', platform: 'darwin', arch: deviceId === m5Id ? 'arm64' : 'x64',
    appVersion: '1.0.0', state: 'READY', lastSeenAt: '2026-10-08T03:30:00Z',
    capabilities: ['device.gui.operate', 'tool.awh-device-runtime'], detectedTools: ['AWH Device Runtime'],
    activity: 'ONLINE', role: 'OWNER', routingEnabled: true, requiresOwnerApproval: false,
    workloads: ['BROWSER'], purpose: 'Enrolled device', ...changes,
  };
}

function reply(goal: string, taskChanges: Partial<WorkerTask> = {}): WorkerConversation {
  const task: WorkerTask = {
    taskId, projectId, conversationId: null, goal,
    state: 'WAITING_FOR_WORKER', progress: 0, assignedDevice: null, approvalStatus: null,
    execution: {
      executionId: 'd5e185c7-1b52-4852-9776-ca3012f3a6a6', executorKind: 'DEVICE',
      requiredCapability: 'device.gui.operate', vaultRevisionId: null,
      state: 'WAITING_FOR_CAPABILITY', continuation: null, capabilityPlan: null,
    },
    ...taskChanges,
  };
  return {
    conversation: { conversationId: 'e5e185c7-1b52-4852-9776-ca3012f3a6a6', projectId, createdAt: '2026-10-08T03:30:00Z', updatedAt: '2026-10-08T03:30:00Z', lastTaskId: taskId },
    messages: [], tasks: [task], artifacts: [], approvals: [],
  };
}

function fixture(devices: WorkerPeer[], respond: (goal: string, target: string) => WorkerConversation = (goal) => reply(goal)) {
  const submits: Array<{ target: string | null | undefined; goal: string; key: string }> = [];
  const client: GatewayControlClient = {
    async devices() { return devices; },
    async projects() { return [{ projectId, name: 'AWH', type: 'APP', sourceRevision: null, vaultReady: true, memoryReady: true }]; },
    async submitConversation(_project, goal, key, target) {
      submits.push({ goal, key, target });
      return respond(goal, target ?? '');
    },
    async readConversation() { throw new Error('not needed'); },
  };
  return { client, submits };
}

test('fresh enrolled M5 is selected by immutable ID even when Intel has the same display name', async () => {
  const { client, submits } = fixture([worker(intelId), worker(m5Id)]);
  const result = await queueExactDeviceAction(client, { targetDeviceId: m5Id, projectId, instruction: 'เปิด Chrome แล้วตรวจหน้าเว็บ', idempotencyKey: 'm5-chrome-test-001' });
  assert.equal(result.ok, true);
  assert.equal(submits.length, 1);
  assert.equal(submits[0]?.target, m5Id);
  assert.match(submits[0]?.goal ?? '', new RegExp(m5Id));
  if (result.ok) assert.equal(result.target.deviceId, m5Id);
});

test('offline or stale M5 cannot silently fall back to online Intel', async () => {
  for (const state of ['STALE', 'OFFLINE'] as const) {
    const { client, submits } = fixture([worker(intelId), worker(m5Id, { state, activity: state })]);
    const result = await queueExactDeviceAction(client, { targetDeviceId: m5Id, projectId, instruction: 'ตรวจหน้าเว็บ' });
    assert.deepEqual({ ok: result.ok, error: result.ok ? null : result.error }, { ok: false, error: 'DEVICE_NOT_ONLINE' });
    assert.equal(submits.length, 0);
  }
});

test('enrolled device without routing permission is rejected before sending', async () => {
  const { client, submits } = fixture([worker(m5Id, { routingEnabled: false })]);
  const result = await queueExactDeviceAction(client, { targetDeviceId: m5Id, projectId, instruction: 'ตรวจหน้าเว็บ' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, 'DEVICE_ROUTING_DISABLED');
  assert.equal(submits.length, 0);
});

test('Hub conversation without acknowledged task never returns success', async () => {
  const { client } = fixture([worker(m5Id)], goal => ({ ...reply(goal), tasks: [], conversation: null }));
  const result = await queueExactDeviceAction(client, { targetDeviceId: m5Id, projectId, instruction: 'ตรวจหน้าเว็บ' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, 'DEVICE_TASK_NOT_ACKNOWLEDGED');
});

test('Hub acknowledgement of a task for a different device fails closed', async () => {
  const { client } = fixture([worker(m5Id)], goal => reply(goal, { assignedDevice: intelId }));
  const result = await queueExactDeviceAction(client, { targetDeviceId: m5Id, projectId, instruction: 'ตรวจหน้าเว็บ' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, 'DEVICE_TASK_TARGET_MISMATCH');
});

test('Hub acknowledgement of VPS or missing execution fails closed', async () => {
  const baseline = reply('placeholder').tasks[0]!;
  for (const execution of [null, { ...baseline.execution!, executorKind: 'VPS' as const }]) {
    const { client } = fixture([worker(m5Id)], goal => reply(goal, { execution }));
    const result = await queueExactDeviceAction(client, { targetDeviceId: m5Id, projectId, instruction: 'ตรวจหน้าเว็บ' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, 'DEVICE_EXECUTION_NOT_CONFIRMED');
  }
});

test('a reused idempotency response with a previous device goal cannot be counted as this task', async () => {
  const { client } = fixture([worker(m5Id), worker(intelId)], goal => reply(goal.replace(m5Id, intelId)));
  const result = await queueExactDeviceAction(client, { targetDeviceId: m5Id, projectId, instruction: 'เปิดเว็บ', idempotencyKey: 'same-key-001' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, 'DEVICE_TASK_NOT_ACKNOWLEDGED');
});

test('a server-rejected task is never reported as accepted', async () => {
  const { client } = fixture([worker(m5Id)], goal => reply(goal, { state: 'FAILED' }));
  const result = await queueExactDeviceAction(client, { targetDeviceId: m5Id, projectId, instruction: 'เปิดเว็บ' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, 'DEVICE_TASK_REJECTED');
});
