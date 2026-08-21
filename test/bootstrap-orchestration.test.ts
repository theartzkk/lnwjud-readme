import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { runBootstrapOrchestration, verifyHubHealth } from '../scripts/deploy/bootstrap-owner.mjs';
import { BOOTSTRAP_NONCE_CREDENTIAL_KEY, DEVICE_TOKEN_CREDENTIAL_KEY, InMemoryCredentialStore } from '../src/credential-store.js';
import { EnrollmentClient } from '../src/enrollment-client.js';

const PROJECT_ID = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
const OWNER_ID = '223b45c0-23e1-408d-ae0f-ac5eca7f6900';

test('one-shot orchestration provisions and bootstraps with the exact same secure nonce', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-bootstrap-orchestration-'));
  const store = new InMemoryCredentialStore();
  const requests: Request[] = [];
  let provisionedDigest = '';
  let provisioned = false;
  let deployed = false;
  let bootstrapNonce = '';
  try {
    const client = new EnrollmentClient('https://hub.example/api/v1', root, store, async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.endsWith('/enrollment/bootstrap')) {
        bootstrapNonce = request.headers.get('X-AWH-Bootstrap-Nonce') ?? '';
        return new Response(JSON.stringify({ bootstrapClosed: true, initialPairingCode: 'P'.repeat(43), initialPairingExpiresAt: '2026-09-01T00:10:00.000Z' }), { status: 200 });
      }
      assert.equal(request.url, 'https://hub.example/api/v1/enrollment/devices');
      return new Response(JSON.stringify({ accessToken: 'device-token-only-in-store', expiresAt: '2026-09-01T00:00:00.000Z', projectCount: 1 }), { status: 200 });
    });
    const result = await runBootstrapOrchestration({
      client,
      store,
      target: 'awh-vps',
      projectIds: [PROJECT_ID],
      userId: OWNER_ID,
      provision: async ({ store: receivedStore }) => {
        const nonce = await receivedStore.get(BOOTSTRAP_NONCE_CREDENTIAL_KEY);
        assert.ok(nonce);
        provisionedDigest = createHash('sha256').update(nonce).digest('hex');
        provisioned = true;
      },
      deploy: async () => { deployed = true; },
      verify: async (apiBase) => {
        assert.equal(apiBase, 'https://hub.example/api/v1');
        return { status: 'ok', service: 'awh-hub-read-foundation' };
      },
      apiBase: 'https://hub.example/api/v1',
    });
    assert.equal(provisioned, true);
    assert.equal(deployed, true);
    assert.equal(createHash('sha256').update(bootstrapNonce).digest('hex'), provisionedDigest);
    assert.equal(requests.length, 2);
    assert.equal(result.enrolled, true);
    assert.equal(result.credentialStored, true);
    assert.equal(await store.get(BOOTSTRAP_NONCE_CREDENTIAL_KEY), null);
    assert.equal(await store.get(DEVICE_TOKEN_CREDENTIAL_KEY), 'device-token-only-in-store');
    const resultText = JSON.stringify(result);
    assert.equal(resultText.includes(bootstrapNonce), false);
    assert.equal(resultText.includes(provisionedDigest), false);
    assert.equal(resultText.includes('device-token-only-in-store'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('failed provisioning stops before bootstrap and keeps the prepared nonce for a controlled retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-bootstrap-orchestration-'));
  const store = new InMemoryCredentialStore();
  let requestCount = 0;
  try {
    const client = new EnrollmentClient('https://hub.example/api/v1', root, store, async () => {
      requestCount += 1;
      throw new Error('bootstrap must not run');
    });
    await assert.rejects(() => runBootstrapOrchestration({
      client,
      store,
      target: 'awh-vps',
      projectIds: [PROJECT_ID],
      provision: async () => { throw new Error('fixture provisioning failure'); },
      deploy: async () => { throw new Error('deployment must not run'); },
      verify: async () => ({ status: 'ok', service: 'awh-hub-read-foundation' }),
      apiBase: 'https://hub.example/api/v1',
    }));
    assert.equal(requestCount, 0);
    assert.match(await store.get(BOOTSTRAP_NONCE_CREDENTIAL_KEY) ?? '', /^[A-Za-z0-9_-]{43}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('failed bootstrap reuses the same nonce and never silently generates a replacement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-bootstrap-orchestration-'));
  const store = new InMemoryCredentialStore();
  const nonces: string[] = [];
  try {
    const client = new EnrollmentClient('https://hub.example/api/v1', root, store, async (input, init) => {
      const request = new Request(input, init);
      if (request.url.endsWith('/enrollment/bootstrap')) nonces.push(request.headers.get('X-AWH-Bootstrap-Nonce') ?? '');
      return new Response(JSON.stringify({ code: 'BOOTSTRAP_REJECTED', message: 'rejected' }), { status: 400 });
    });
    await client.prepareBootstrapNonce();
    await assert.rejects(() => client.bootstrapAndEnroll([PROJECT_ID], undefined, OWNER_ID));
    await assert.rejects(() => client.bootstrapAndEnroll([PROJECT_ID], undefined, OWNER_ID));
    assert.equal(nonces.length, 2);
    assert.equal(nonces[0], nonces[1]);
    assert.match(nonces[0] ?? '', /^[A-Za-z0-9_-]{43}$/);
    assert.match(await store.get(BOOTSTRAP_NONCE_CREDENTIAL_KEY) ?? '', /^[A-Za-z0-9_-]{43}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('sanitized Hub verification is same-origin read-only and does not forward credentials', async () => {
  let receivedInit;
  const result = await verifyHubHealth('https://hub.example/api/v1', async (input, init) => {
    assert.equal(String(input), 'https://hub.example/api/v1/health');
    receivedInit = init;
    return new Response(JSON.stringify({ schemaVersion: 1, status: 'ok', service: 'awh-hub-read-foundation' }), { status: 200 });
  });
  assert.deepEqual(result, { status: 'ok', service: 'awh-hub-read-foundation' });
  assert.equal(receivedInit.credentials, 'omit');
  assert.equal(Object.hasOwn(receivedInit.headers, 'Authorization'), false);
});
