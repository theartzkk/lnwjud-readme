import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ControlPlaneWorkerClient } from '../src/control-plane-worker-client.js';
import { DEVICE_TOKEN_CREDENTIAL_KEY, type CredentialStore } from '../src/credential-store.js';

class MemoryCredentials implements CredentialStore {
  values = new Map<string, string>();
  async get(key: string): Promise<string | null> { return this.values.get(key) ?? null; }
  async set(key: string, value: string): Promise<void> { this.values.set(key, value); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
}

test('worker client uses the enrolled credential only in a fixed Authorization header', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-worker-client-'));
  const credentials = new MemoryCredentials(); credentials.values.set(DEVICE_TOKEN_CREDENTIAL_KEY, 'fixture-token-never-output');
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = async (url: URL | RequestInfo, init?: RequestInit): Promise<Response> => { calls.push({ url: String(url), init: init ?? {} }); const body = JSON.parse(String(init?.body)) as { deviceId: string }; return new Response(JSON.stringify({ schemaVersion: 1, deviceId: body.deviceId, state: 'READY', lastSeenAt: '2026-08-21T00:00:00.000Z' }), { status: 200 }); };
  const client = new ControlPlaneWorkerClient('https://hub.example/api/v1', root, credentials, fetchImpl);
  const result = await client.heartbeat(['project-memory:read']);
  assert.equal(result.state, 'READY');
  assert.equal(calls[0]?.url, 'https://hub.example/api/v1/control/workers/heartbeat');
  assert.equal((calls[0]?.init.headers as Record<string, string>).Authorization, 'Bearer fixture-token-never-output');
  assert.equal(calls[0]?.init.credentials, 'omit');
  assert.doesNotMatch(String(calls[0]?.init.body), /fixture-token/);
  assert.doesNotMatch(await readFile(join(root, 'device.json'), 'utf8').catch(() => ''), /fixture-token/);
});

test('worker client rejects unsafe API bases and malformed claim responses', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-worker-client-'));
  const credentials = new MemoryCredentials(); credentials.values.set(DEVICE_TOKEN_CREDENTIAL_KEY, 'fixture-token');
  assert.throws(() => new ControlPlaneWorkerClient('https://hub.example/api/v1?token=bad', root, credentials), /invalid/i);
  const client = new ControlPlaneWorkerClient('https://hub.example/api/v1', root, credentials, async () => new Response(JSON.stringify({ schemaVersion: 1, task: { taskId: 'bad' } }), { status: 200 }));
  await assert.rejects(() => client.claim(), /response is invalid/i);
});

test('worker conversation client accepts current Hub schema 3 and rejects unknown schemas', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-worker-conversation-'));
  const credentials = new MemoryCredentials(); credentials.values.set(DEVICE_TOKEN_CREDENTIAL_KEY, 'fixture-token');
  const projectId = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
  const current = { schemaVersion: 3, conversation: null, messages: [], tasks: [], artifacts: [], approvals: [] };
  const client = new ControlPlaneWorkerClient('https://hub.example/api/v1', root, credentials, async () => new Response(JSON.stringify(current), { status: 200 }));
  assert.equal((await client.readConversation(projectId)).conversation, null);
  assert.equal((await client.submitConversation(projectId, 'ทดสอบ schema ปัจจุบัน', 'schema-v3-test')).tasks.length, 0);

  const future = new ControlPlaneWorkerClient('https://hub.example/api/v1', root, credentials, async () => new Response(JSON.stringify({ ...current, schemaVersion: 4 }), { status: 200 }));
  await assert.rejects(() => future.readConversation(projectId), /response is invalid/i);
});

test('worker conversation client preserves bounded continuation lineage from the canonical execution projection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-worker-lineage-'));
  const credentials = new MemoryCredentials(); credentials.values.set(DEVICE_TOKEN_CREDENTIAL_KEY, 'fixture-token');
  const projectId = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
  const taskId = '213b45c0-23e1-408d-ae0f-ac5eca7f6900';
  const rootTaskId = '313b45c0-23e1-408d-ae0f-ac5eca7f6900';
  const executionId = '413b45c0-23e1-408d-ae0f-ac5eca7f6900';
  const payload = { schemaVersion: 3, conversation: null, messages: [], tasks: [{ taskId, projectId, conversationId: null, goal: 'read-only continuation', state: 'COMPLETED', progress: 100, assignedDevice: null, approvalStatus: null, execution: { executionId, executorKind: 'VPS', requiredCapability: 'project.read', vaultRevisionId: null, state: 'COMPLETED', continuation: { rootTaskId, step: 1, maxSteps: 6 } } }], artifacts: [], approvals: [] };
  const client = new ControlPlaneWorkerClient('https://hub.example/api/v1', root, credentials, async () => new Response(JSON.stringify(payload), { status: 200 }));
  const task = (await client.readConversation(projectId)).tasks[0];
  assert.deepEqual(task?.execution?.continuation, { rootTaskId, step: 1, maxSteps: 6 });
  assert.equal(task?.execution?.executorKind, 'VPS');
});

test('worker project projection carries memory readiness and treats an older Hub omission as not ready', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-worker-projects-memory-'));
  const credentials = new MemoryCredentials(); credentials.values.set(DEVICE_TOKEN_CREDENTIAL_KEY, 'fixture-token');
  const projectId = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
  const base = { projectId, name: 'AWH', type: 'node', sourceRevision: null, vaultReady: true };
  let response = { schemaVersion: 1, projects: [{ ...base, memoryReady: true }] } as Record<string, unknown>;
  const client = new ControlPlaneWorkerClient('https://hub.example/api/v1', root, credentials, async () => new Response(JSON.stringify(response), { status: 200 }));
  assert.equal((await client.projects())[0]?.memoryReady, true);
  response = { schemaVersion: 1, projects: [base] };
  assert.equal((await client.projects())[0]?.memoryReady, false);
});

test('worker client publishes bounded Project Memory metadata without paths or contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-worker-memory-'));
  const credentials = new MemoryCredentials(); credentials.values.set(DEVICE_TOKEN_CREDENTIAL_KEY, 'fixture-token');
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const projectId = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
  const files = ['CURRENT_STATE.md', 'PROJECT.md', 'HANDOFF.md', 'TASKS.md', 'ARCHITECTURE.md', 'DECISIONS.md'].map((name) => ({ name, status: 'present' as const, sha256: 'a'.repeat(64), sizeBytes: 12 }));
  const client = new ControlPlaneWorkerClient('https://hub.example/api/v1', root, credentials, async (url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>; calls.push({ url: String(url), body });
    return new Response(JSON.stringify({ schemaVersion: 1, projectId, memoryReady: true, observedAt: '2026-08-31T00:00:00Z' }), { status: 200 });
  });
  await client.publishProjectMemory(projectId, files);
  assert.equal(calls[0]?.url, 'https://hub.example/api/v1/control/worker/projects/memory');
  assert.equal(calls[0]?.body.projectId, projectId);
  assert.deepEqual((calls[0]?.body.files as typeof files).map((file) => file.name).sort(), files.map((file) => file.name).sort());
  assert.doesNotMatch(JSON.stringify(calls[0]?.body), /workspacePath|\/Users\/|content/i);
});
