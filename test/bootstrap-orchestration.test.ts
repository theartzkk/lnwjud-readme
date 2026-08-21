import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { runBootstrapOrchestration, verifyInternalHubHealth, verifyProtectedPerimeter } from '../scripts/deploy/bootstrap-owner.mjs';
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
      verifyExternal: async (apiBase) => {
        assert.equal(apiBase, 'https://hub.example/api/v1');
        return { health: 401, status: 401, projects: 401 };
      },
      verifyInternal: async (target) => {
        assert.equal(target, 'awh-vps');
        return { schemaVersion: 1, status: 'ok', service: 'awh-hub-read-foundation' };
      },
      apiBase: 'https://hub.example/api/v1',
    });
    assert.equal(provisioned, true);
    assert.equal(deployed, true);
    assert.equal(createHash('sha256').update(bootstrapNonce).digest('hex'), provisionedDigest);
    assert.equal(requests.length, 2);
    assert.equal(result.enrolled, true);
    assert.equal(result.credentialStored, true);
    assert.deepEqual(result.hub.external, { health: 401, status: 401, projects: 401 });
    assert.deepEqual(result.hub.internal, { schemaVersion: 1, status: 'ok', service: 'awh-hub-read-foundation' });
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
      verifyExternal: async () => ({ health: 401, status: 401, projects: 401 }),
      verifyInternal: async () => ({ schemaVersion: 1, status: 'ok', service: 'awh-hub-read-foundation' }),
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

test('protected external perimeter accepts 401 without forwarding Basic Auth or bearer credentials', async () => {
  const requests = [];
  const result = await verifyProtectedPerimeter('https://hub.example/api/v1', async (input, init) => {
    requests.push({ input: String(input), init });
    return new Response('', { status: 401 });
  });
  assert.deepEqual(result, { health: 401, status: 401, projects: 401 });
  assert.deepEqual(requests.map((request) => request.input), [
    'https://hub.example/api/v1/health',
    'https://hub.example/api/v1/status',
    'https://hub.example/api/v1/projects',
  ]);
  for (const request of requests) {
    assert.equal(request.init.credentials, 'omit');
    assert.equal(Object.hasOwn(request.init.headers, 'Authorization'), false);
    assert.equal(Object.hasOwn(request.init.headers, 'Cookie'), false);
  }
});

test('unexpected public 200, redirect/fetch failure, and non-401 responses fail closed', async () => {
  await assert.rejects(() => verifyProtectedPerimeter('https://hub.example/api/v1', async () => new Response('{}', { status: 200 })));
  await assert.rejects(() => verifyProtectedPerimeter('https://hub.example/api/v1', async () => { throw new Error('TLS failure'); }));
  await assert.rejects(() => verifyProtectedPerimeter('https://hub.example/api/v1', async () => new Response('', { status: 404 })));
});

test('trusted internal Hub health reuses the deployed PHP front controller with fixed read-only argv', async () => {
  let receivedExecutable = '';
  let receivedArgs = [];
  const result = await verifyInternalHubHealth('awh-vps', {
    sshImpl: async (executable, args) => {
      receivedExecutable = executable;
      receivedArgs = [...args];
      return { exitCode: 0, stdout: JSON.stringify({ schemaVersion: 1, status: 'ok', service: 'awh-hub-read-foundation', requestId: 'safe-request-id' }) };
    },
  });
  assert.deepEqual(result, { schemaVersion: 1, status: 'ok', service: 'awh-hub-read-foundation' });
  assert.equal(receivedExecutable, 'ssh');
  assert.deepEqual(receivedArgs, [
    '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'awh-vps', 'sudo', '-n', 'env',
    'AWH_HUB_DB_PATH=/var/lib/awh-hub/awh.sqlite', 'REQUEST_METHOD=GET', 'REQUEST_URI=/api/v1/health',
    '/usr/bin/php', '/opt/awh-hub/public/index.php',
  ]);
});

test('trusted internal Hub health rejects malformed, wrong, oversized, or failed responses without logging them', async () => {
  await assert.rejects(() => verifyInternalHubHealth('awh-vps', { sshImpl: async () => ({ exitCode: 0, stdout: '<html>401</html>' }) }));
  await assert.rejects(() => verifyInternalHubHealth('awh-vps', { sshImpl: async () => ({ exitCode: 0, stdout: JSON.stringify({ schemaVersion: 1, status: 'down', service: 'awh-hub-read-foundation' }) }) }));
  await assert.rejects(() => verifyInternalHubHealth('awh-vps', { sshImpl: async () => ({ exitCode: 0, stdout: JSON.stringify({ schemaVersion: 1, status: 'ok', service: 'other' }) }) }));
  await assert.rejects(() => verifyInternalHubHealth('awh-vps', { sshImpl: async () => ({ exitCode: 1, stdout: '' }) }));
  const secret = 'device-token-must-not-appear';
  await assert.rejects(() => verifyInternalHubHealth('awh-vps', { sshImpl: async () => ({ exitCode: 0, stdout: JSON.stringify({ schemaVersion: 1, status: 'ok', service: 'awh-hub-read-foundation', token: secret }) }) }));
});
