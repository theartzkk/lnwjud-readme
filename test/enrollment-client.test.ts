import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { EnrollmentClient, EnrollmentClientError } from '../src/enrollment-client.js';
import { InMemoryCredentialStore } from '../src/credential-store.js';

test('local enrollment client pairs with the existing device UUID and never returns the credential', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-enroll-client-'));
  const store = new InMemoryCredentialStore();
  const requests: Request[] = [];
  try {
    const client = new EnrollmentClient('https://hub.example/api/v1', root, store, async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(JSON.stringify({ accessToken: 'local-secret-token', expiresAt: '2026-09-01T00:00:00.000Z', projectCount: 1 }), { status: 200 });
    });
    const state = await client.pair('A'.repeat(32));
    assert.equal(state.enrolled, true);
    assert.equal(state.projectCount, 1);
    assert.equal('accessToken' in state, false);
    assert.equal(requests[0]?.url, 'https://hub.example/api/v1/enrollment/devices');
    assert.equal(new URL(requests[0]?.url ?? '').search, '');
    assert.match(await store.get('awh/device-token') ?? '', /local-secret-token/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('local enrollment client rotates only its own stored credential and rejects insecure/arbitrary API URLs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-enroll-client-'));
  try {
    assert.throws(() => new EnrollmentClient('http://evil.example/api/v1', root, new InMemoryCredentialStore()), EnrollmentClientError);
    assert.throws(() => new EnrollmentClient('https://hub.example/api/v1?token=secret', root, new InMemoryCredentialStore()), EnrollmentClientError);
    const store = new InMemoryCredentialStore(); await store.set('awh/device-token', 'old-token');
    const client = new EnrollmentClient('https://hub.example/api/v1', root, store, async (_input, init) => {
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer old-token');
      return new Response(JSON.stringify({ accessToken: 'new-token', expiresAt: '2026-09-01T00:00:00.000Z' }), { status: 200 });
    });
    const state = await client.rotate();
    assert.equal(state.credentialStored, true);
    assert.equal(await store.get('awh/device-token'), 'new-token');
  } finally { await rm(root, { recursive: true, force: true }); }
});
