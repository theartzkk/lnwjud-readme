import assert from 'node:assert/strict';
import test from 'node:test';
import { ControlPlaneWorkerError } from '../src/control-plane-worker-client.js';
import { runWithWorkerCredentialRecovery } from '../src/worker-credential-recovery.js';

test('expired worker credential rotates once and retries the same run', async () => {
  let runs = 0; let rotations = 0;
  const result = await runWithWorkerCredentialRecovery(async () => {
    runs += 1;
    if (runs === 1) throw new ControlPlaneWorkerError('expired', 'TOKEN_REJECTED');
    return 'ready';
  }, async () => { rotations += 1; });
  assert.equal(result, 'ready');
  assert.equal(runs, 2);
  assert.equal(rotations, 1);
});

test('non-credential failures are not retried or rotated', async () => {
  let rotations = 0;
  await assert.rejects(
    () => runWithWorkerCredentialRecovery(async () => { throw new Error('network'); }, async () => { rotations += 1; }),
    /network/,
  );
  assert.equal(rotations, 0);
});
