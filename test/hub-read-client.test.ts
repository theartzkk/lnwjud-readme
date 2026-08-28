import assert from 'node:assert/strict';
import test from 'node:test';
import { HubReadClient, hubReadRoutePath } from '../src/integration/index.js';

const TOKEN = 'owner-read-token-1234567890';

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const body = JSON.stringify(value);
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(body, { ...init, headers });
}

test('Hub read client uses only an explicit GET route and injects credential internally', async () => {
  let seenUrl = '';
  let seenInit: RequestInit | undefined;
  const client = new HubReadClient({
    baseUrl: 'https://hub.example.test',
    credentials: { getAccessToken: async () => TOKEN },
    fetchImpl: (async (input, init) => {
      seenUrl = String(input);
      seenInit = init;
      return jsonResponse({ ok: true });
    }) as typeof fetch,
  });

  const result = await client.get('status');
  assert.deepEqual(result, { ok: true });
  assert.equal(seenUrl, 'https://hub.example.test/api/v1/status');
  assert.equal(seenInit?.method, 'GET');
  assert.equal(seenInit?.redirect, 'error');
  assert.equal(new Headers(seenInit?.headers).get('authorization'), `Bearer ${TOKEN}`);
  assert.equal(new Headers(seenInit?.headers).get('accept'), 'application/json');
});

test('Hub read client rejects cleartext remote origins but permits loopback development', () => {
  assert.throws(
    () => new HubReadClient({
      baseUrl: 'http://hub.example.test',
      credentials: { getAccessToken: async () => TOKEN },
    }),
    /must use HTTPS/i,
  );

  assert.doesNotThrow(() => new HubReadClient({
    baseUrl: 'http://127.0.0.1:8787',
    credentials: { getAccessToken: async () => TOKEN },
  }));
});

test('Hub read client rejects base URL credentials, paths, queries, and fragments', () => {
  const invalid = [
    'https://user:pass@hub.example.test',
    'https://hub.example.test/api',
    'https://hub.example.test/?token=x',
    'https://hub.example.test/#secret',
  ];

  for (const baseUrl of invalid) {
    assert.throws(() => new HubReadClient({
      baseUrl,
      credentials: { getAccessToken: async () => TOKEN },
    }));
  }
});

test('Hub read client rejects malformed credentials before network access', async () => {
  let called = false;
  const client = new HubReadClient({
    baseUrl: 'https://hub.example.test',
    credentials: { getAccessToken: async () => 'short' },
    fetchImpl: (async () => {
      called = true;
      return jsonResponse({ ok: true });
    }) as typeof fetch,
  });

  await assert.rejects(client.get('projects'), /credential is invalid/i);
  assert.equal(called, false);
});

test('Hub read client enforces response size using both declared and actual bytes', async () => {
  const declared = new HubReadClient({
    baseUrl: 'https://hub.example.test',
    credentials: { getAccessToken: async () => TOKEN },
    maxResponseBytes: 1_024,
    fetchImpl: (async () => jsonResponse({ ok: true }, {
      headers: { 'content-length': '2048' },
    })) as typeof fetch,
  });
  await assert.rejects(declared.get('devices'), /exceeds size limit/i);

  const actual = new HubReadClient({
    baseUrl: 'https://hub.example.test',
    credentials: { getAccessToken: async () => TOKEN },
    maxResponseBytes: 1_024,
    fetchImpl: (async () => jsonResponse({ data: 'x'.repeat(2_000) })) as typeof fetch,
  });
  await assert.rejects(actual.get('devices'), /exceeds size limit/i);
});

test('Hub read client rejects non-JSON and does not echo response body on HTTP error', async () => {
  const nonJson = new HubReadClient({
    baseUrl: 'https://hub.example.test',
    credentials: { getAccessToken: async () => TOKEN },
    fetchImpl: (async () => new Response('hello', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    })) as typeof fetch,
  });
  await assert.rejects(nonJson.get('builds'), /not JSON/i);

  const secretBody = 'sensitive-server-debug-details';
  const failed = new HubReadClient({
    baseUrl: 'https://hub.example.test',
    credentials: { getAccessToken: async () => TOKEN },
    fetchImpl: (async () => new Response(secretBody, {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch,
  });

  await assert.rejects(
    failed.get('releases'),
    (error: unknown) => error instanceof Error
      && error.message === 'Hub read request failed with HTTP 401'
      && !error.message.includes(secretBody)
      && !error.message.includes(TOKEN),
  );
});

test('Hub read route mapping stays bounded to existing read endpoints', () => {
  assert.equal(hubReadRoutePath('status'), '/api/v1/status');
  assert.equal(hubReadRoutePath('projects'), '/api/v1/projects');
  assert.equal(hubReadRoutePath('devices'), '/api/v1/devices');
  assert.equal(hubReadRoutePath('builds'), '/api/v1/builds');
  assert.equal(hubReadRoutePath('releases'), '/api/v1/releases');
});
