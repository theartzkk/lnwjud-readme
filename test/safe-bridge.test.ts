import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryCredentialStore, DEVICE_TOKEN_CREDENTIAL_KEY } from '../src/credential-store.js';
import {
  executeSafeBridge,
  parseSafeBridgeArgs,
  SafeBridgeError,
  sanitize,
  type SafeBridgeRuntime,
  type SafeBridgeWorkerClient,
} from '../src/integration/safe-bridge.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = '33333333-3333-4333-8333-333333333333';
const EXECUTION_ID = '44444444-4444-4444-8444-444444444444';

function fakeWorker(): SafeBridgeWorkerClient {
  return {
    async projects() {
      return [{ projectId: PROJECT_ID, name: 'AWH', type: 'code', sourceRevision: 'a'.repeat(40), vaultReady: true }];
    },
    async readResults() {
      return {
        results: [{
          taskId: TASK_ID,
          projectId: PROJECT_ID,
          conversationId: null,
          goal: 'sensitive internal goal that should not be emitted by results summary',
          state: 'RUNNING',
          progress: 50,
          assignedDevice: DEVICE_ID,
          approvalStatus: 'PENDING',
          execution: {
            executionId: EXECUTION_ID,
            executorKind: 'DEVICE',
            requiredCapability: 'workspace.read',
            vaultRevisionId: null,
            state: 'RUNNING',
          },
        }],
        artifacts: [{ artifactId: 'artifact-1', accessToken: 'never-leak' }],
        approvals: [{ approvalId: 'approval-1', password: 'never-leak' }],
      };
    },
    async workspace(projectId: string) {
      return { projectId, syncStatus: 'SYNCED', checkpoint: null, lease: null };
    },
  };
}

async function runtime(enrolled = true): Promise<SafeBridgeRuntime> {
  const credentialStore = new InMemoryCredentialStore();
  if (enrolled) await credentialStore.set(DEVICE_TOKEN_CREDENTIAL_KEY, 'x'.repeat(32));
  return {
    config: {
      workspace: '/tmp/awh',
      dataDir: '/tmp/awh-data',
      allowWrite: true,
      allowExec: true,
      allowCodex: true,
      maxReadBytes: 1024,
      maxSearchResults: 10,
      maxTaskLogBytes: 1024,
      hubApiBase: 'https://awh.example.test/api/v1',
      controlPlaneWorker: true,
    },
    credentialStore,
    device: {
      schemaVersion: 1,
      deviceId: DEVICE_ID,
      displayName: 'Test Mac',
      platform: 'darwin',
      arch: 'arm64',
      createdAt: '2026-08-28T00:00:00.000Z',
    },
    worker: fakeWorker(),
    now: () => new Date('2026-08-28T16:30:00.000Z'),
  };
}

test('safe bridge parser exposes only the bounded read allowlist', () => {
  assert.deepEqual(parseSafeBridgeArgs(['status']), { kind: 'status' });
  assert.deepEqual(parseSafeBridgeArgs(['workspace', PROJECT_ID]), { kind: 'workspace', projectId: PROJECT_ID });
  for (const args of [[], ['shell', 'ls'], ['deploy'], ['workspace', '../../etc/passwd'], ['projects', '--url', 'https://evil.test']]) {
    assert.throws(() => parseSafeBridgeArgs(args), (error: unknown) => error instanceof SafeBridgeError && error.code === 'COMMAND_NOT_ALLOWED');
  }
});

test('capability document remains read-only regardless of local AWH permissions', async () => {
  const result = await executeSafeBridge({ kind: 'capabilities' }, await runtime());
  assert.equal(result.readOnly, true);
  const data = result.data as { invariants: Record<string, boolean> };
  assert.equal(data.invariants.rawShell, false);
  assert.equal(data.invariants.write, false);
  assert.equal(data.invariants.execute, false);
  assert.equal(data.invariants.deploy, false);
  assert.equal(data.invariants.databaseMutation, false);
});

test('status reports authenticated read readiness without exposing credential material', async () => {
  const result = await executeSafeBridge({ kind: 'status' }, await runtime());
  const data = result.data as Record<string, unknown>;
  assert.equal(data.enrolled, true);
  assert.equal(data.authenticatedRead, 'ready');
  assert.equal(data.projectCount, 1);
  assert.equal(data.taskCount, 1);
  assert.equal(JSON.stringify(result).includes('never-leak'), false);
  assert.equal(JSON.stringify(result).includes('xxxxxxxx'), false);
});

test('results omit task goal and redact sensitive object keys', async () => {
  const result = await executeSafeBridge({ kind: 'results' }, await runtime());
  const encoded = JSON.stringify(result);
  assert.equal(encoded.includes('sensitive internal goal'), false);
  assert.equal(encoded.includes('never-leak'), false);
  assert.equal(encoded.includes('[redacted]'), true);
  const data = result.data as { tasks: Array<Record<string, unknown>> };
  assert.equal(data.tasks[0]?.state, 'RUNNING');
  assert.equal('goal' in (data.tasks[0] ?? {}), false);
});

test('status fails closed when the device has no session credential', async () => {
  const result = await executeSafeBridge({ kind: 'status' }, await runtime(false));
  const data = result.data as Record<string, unknown>;
  assert.equal(data.enrolled, false);
  assert.equal(data.authenticatedRead, 'not-ready');
});

test('workspace accepts only a canonical UUID and returns bounded metadata', async () => {
  const result = await executeSafeBridge({ kind: 'workspace', projectId: PROJECT_ID }, await runtime());
  assert.deepEqual(result.data, { workspace: { projectId: PROJECT_ID, syncStatus: 'SYNCED', checkpoint: null, lease: null } });
});

test('sanitizer redacts secret-shaped keys and bounds deep data', () => {
  const value = sanitize({ token: 'abc', nested: { password: 'def', normal: 'ok' } });
  assert.deepEqual(value, { token: '[redacted]', nested: { password: '[redacted]', normal: 'ok' } });
});
