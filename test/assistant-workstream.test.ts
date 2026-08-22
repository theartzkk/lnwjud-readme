import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ControlPlaneWorkerClient } from '../src/control-plane-worker-client.js';
import { DEVICE_TOKEN_CREDENTIAL_KEY, type CredentialStore } from '../src/credential-store.js';

class FixtureCredentials implements CredentialStore {
  async get(key: string): Promise<string | null> { return key === DEVICE_TOKEN_CREDENTIAL_KEY ? 'fixture-device-token' : null; }
  async set(): Promise<void> {}
  async delete(): Promise<void> {}
}

const ids = { device: '423b45c0-23e1-408d-ae0f-ac5eca7f6900', project: '523b45c0-23e1-408d-ae0f-ac5eca7f6900', conversation: '623b45c0-23e1-408d-ae0f-ac5eca7f6900', message: '723b45c0-23e1-408d-ae0f-ac5eca7f6900', task: '823b45c0-23e1-408d-ae0f-ac5eca7f6900' };

function conversationResponse() {
  return { schemaVersion: 1, conversation: { conversationId: ids.conversation, projectId: ids.project, createdAt: '2026-08-22T00:00:00Z', updatedAt: '2026-08-22T00:00:00Z', lastTaskId: ids.task }, messages: [{ messageId: ids.message, taskId: ids.task, kind: 'assistant', sequence: 2, body: 'รับเรื่องแล้ว กำลังรออุปกรณ์ที่เหมาะสม', createdAt: '2026-08-22T00:00:00Z' }], tasks: [{ schemaVersion: 1, taskId: ids.task, projectId: ids.project, conversationId: ids.conversation, goal: 'ตรวจ source อย่างเดียว', state: 'WAITING_FOR_WORKER', progress: 0, assignedDevice: null, approvalStatus: null }], artifacts: [], approvals: [] };
}

test('device Work submission uses the existing secure credential boundary and one bounded canonical request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-workstream-client-'));
  try {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new ControlPlaneWorkerClient('https://hub.example/api/v1', root, new FixtureCredentials(), async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(conversationResponse()), { status: 201 });
    });
    const result = await client.submitConversation(ids.project, 'ตรวจ source อย่างเดียว', 'desktop-work-0001');
    assert.equal(result.conversation?.conversationId, ids.conversation);
    assert.equal(result.tasks[0]?.conversationId, ids.conversation);
    assert.equal(calls[0]?.url, 'https://hub.example/api/v1/control/worker/conversations');
    assert.equal((calls[0]?.init.headers as Record<string, string>).Authorization, 'Bearer fixture-device-token');
    const payload = JSON.parse(String(calls[0]?.init.body));
    assert.deepEqual({ ...payload, deviceId: '[device]' }, { schemaVersion: 1, deviceId: '[device]', projectId: ids.project, message: 'ตรวจ source อย่างเดียว', idempotencyKey: 'desktop-work-0001' });
    assert.match(payload.deviceId, /^[0-9a-f-]{36}$/i);
    assert.doesNotMatch(String(calls[0]?.init.body), /fixture-device-token/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('worker Work client rejects malformed conversation state rather than rendering untrusted task data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-workstream-invalid-'));
  try {
    const malformed = conversationResponse(); malformed.messages[0] = { ...malformed.messages[0], sequence: 0 };
    const client = new ControlPlaneWorkerClient('https://hub.example/api/v1', root, new FixtureCredentials(), async () => new Response(JSON.stringify(malformed), { status: 200 }));
    await assert.rejects(() => client.readConversation(ids.project), /response is invalid/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});
