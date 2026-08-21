import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { EnrollmentClient, EnrollmentClientError } from '../src/enrollment-client.js';
import { BOOTSTRAP_NONCE_CREDENTIAL_KEY, DEVICE_TOKEN_CREDENTIAL_KEY, InMemoryCredentialStore } from '../src/credential-store.js';

test('local enrollment client closes bootstrap into first-device enrollment and removes the temporary nonce', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-enroll-bootstrap-'));
  const store = new InMemoryCredentialStore();
  const requests: Request[] = [];
  const ownerId = '223b45c0-23e1-408d-ae0f-ac5eca7f6900';
  try {
    const client = new EnrollmentClient('https://hub.example/api/v1', root, store, async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.endsWith('/enrollment/bootstrap')) {
        assert.match(request.headers.get('X-AWH-Bootstrap-Nonce') ?? '', /^[A-Za-z0-9_-]{43}$/);
        assert.equal(new URL(request.url).search, '');
        return new Response(JSON.stringify({ bootstrapClosed: true, initialPairingCode: 'P'.repeat(43), initialPairingExpiresAt: '2026-09-01T00:10:00.000Z' }), { status: 200 });
      }
      assert.equal(request.url, 'https://hub.example/api/v1/enrollment/devices');
      const payload = JSON.parse(await request.text()) as Record<string, unknown>;
      assert.equal(payload.pairingCode, 'P'.repeat(43));
      assert.match(String(payload.deviceId), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      return new Response(JSON.stringify({ accessToken: 'first-device-secret', expiresAt: '2026-09-01T00:00:00.000Z', projectCount: 1 }), { status: 200 });
    });
    const prepared = await client.prepareBootstrapNonce();
    assert.equal(prepared.reused, false);
    const state = await client.bootstrapAndEnroll(['113b45c0-23e1-408d-ae0f-ac5eca7f6900'], 'Art’s Mac', ownerId);
    assert.equal(state.enrolled, true);
    assert.match(state.deviceId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(await store.get(BOOTSTRAP_NONCE_CREDENTIAL_KEY), null);
    assert.equal(await store.get(DEVICE_TOKEN_CREDENTIAL_KEY), 'first-device-secret');
    assert.equal('accessToken' in state, false);
    assert.equal(requests.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('bootstrap refuses to invent a nonce when the secure store was not prepared', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-enroll-bootstrap-'));
  try {
    const client = new EnrollmentClient('https://hub.example/api/v1', root, new InMemoryCredentialStore(), async () => {
      throw new Error('bootstrap request must not run');
    });
    await assert.rejects(() => client.bootstrapAndEnroll(['113b45c0-23e1-408d-ae0f-ac5eca7f6900']), (error: unknown) => error instanceof EnrollmentClientError && error.code === 'BOOTSTRAP_NONCE_MISSING');
  } finally { await rm(root, { recursive: true, force: true }); }
});

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

test('enrolled owner can issue a bounded pairing code without persisting the code', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-enroll-owner-'));
  const store = new InMemoryCredentialStore();
  const projectId = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
  const ownerToken = 'owner-token-never-returned-to-ui';
  const pairingCode = 'P'.repeat(43);
  await store.set(DEVICE_TOKEN_CREDENTIAL_KEY, ownerToken);
  try {
    const client = new EnrollmentClient('https://hub.example/api/v1', root, store, async (input, init) => {
      const request = new Request(input, init);
      assert.equal(request.url, 'https://hub.example/api/v1/enrollment/pairing-codes');
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.get('Authorization'), `Bearer ${ownerToken}`);
      assert.equal(request.headers.get('Content-Type'), 'application/json');
      assert.equal((init as RequestInit).credentials, 'omit');
      assert.equal((init as RequestInit).cache, 'no-store');
      const payload = JSON.parse(await request.text()) as Record<string, unknown>;
      assert.deepEqual(payload, { schemaVersion: 1, projectIds: [projectId], ttlSeconds: 600 });
      return new Response(JSON.stringify({ schemaVersion: 1, pairingCode, expiresAt: new Date(Date.now() + 600_000).toISOString(), projectCount: 1 }), { status: 200 });
    });
    const result = await client.issuePairingCode([projectId]);
    assert.equal(result.pairingCode, pairingCode);
    assert.equal(result.projectCount, 1);
    assert.equal(await store.get(DEVICE_TOKEN_CREDENTIAL_KEY), ownerToken);
    assert.equal(await store.get('awh/pairing-code'), null);
    assert.equal('accessToken' in result, false);
    assert.equal('Authorization' in result, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('owner pairing issuance fails closed for missing credentials, invalid scope and malformed response', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-enroll-owner-'));
  const projectId = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
  try {
    const missing = new EnrollmentClient('https://hub.example/api/v1', root, new InMemoryCredentialStore(), async () => {
      throw new Error('request must not run');
    });
    await assert.rejects(() => missing.issuePairingCode([projectId]), (error: unknown) => error instanceof EnrollmentClientError && error.code === 'DEVICE_NOT_ENROLLED');

    const store = new InMemoryCredentialStore(); await store.set(DEVICE_TOKEN_CREDENTIAL_KEY, 'owner-token');
    const malformed = new EnrollmentClient('https://hub.example/api/v1', root, store, async () => new Response(JSON.stringify({ pairingCode: 'too-short', expiresAt: new Date(Date.now() + 600_000).toISOString(), projectCount: 1 }), { status: 200 }));
    await assert.rejects(() => malformed.issuePairingCode([projectId]), (error: unknown) => error instanceof EnrollmentClientError && error.code === 'RESPONSE_INVALID');
    await assert.rejects(() => malformed.issuePairingCode(['not-a-project-id']), (error: unknown) => error instanceof EnrollmentClientError && error.code === 'PROJECT_SCOPE_INVALID');
    assert.equal(await store.get('awh/pairing-code'), null);
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

test('local enrollment client revokes its own credential without exposing it in state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-enroll-client-'));
  try {
    const store = new InMemoryCredentialStore();
    await store.set('awh/device-token', 'device-token-to-revoke');
    const client = new EnrollmentClient('https://hub.example/api/v1', root, store, async (_input, init) => {
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer device-token-to-revoke');
      return new Response(JSON.stringify({ revoked: true }), { status: 200 });
    });
    const state = await client.revoke();
    assert.equal(state.enrolled, false);
    assert.equal(await store.get('awh/device-token'), null);
    assert.equal('accessToken' in state, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
