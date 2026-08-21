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
