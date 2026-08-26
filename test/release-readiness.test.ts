import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateReleaseReadiness } from '../src/release-readiness.js';

const sha = 'a'.repeat(40);
const ready = {
  schemaVersion: 1,
  channel: 'stable',
  version: '1.0.0-rc.1',
  gitSha: sha,
  databaseSchemaVersion: 17,
  backup: 'VERIFIED',
  restoreDrill: 'PASS',
  migrationPlan: 'READY',
  rollbackPlan: 'READY',
  hostKeyVerification: 'VERIFIED',
} as const;

test('release readiness is green only when all durable gates are proven', () => {
  assert.deepEqual(evaluateReleaseReadiness(ready, ready.version, sha), { status: 'READY', reasons: [] });
});

test('release readiness blocks an unverified host key without weakening other gates', () => {
  const result = evaluateReleaseReadiness({ ...ready, hostKeyVerification: 'UNVERIFIED' }, ready.version, sha);
  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(result.reasons, ['HOST_KEY_NOT_VERIFIED']);
});

test('release readiness reports all missing recovery and identity evidence', () => {
  const result = evaluateReleaseReadiness({ ...ready, gitSha: 'b'.repeat(40), backup: 'MISSING', restoreDrill: 'FAILED', rollbackPlan: 'MISSING' }, ready.version, sha);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('RELEASE_SHA_MISMATCH'));
  assert.ok(result.reasons.includes('BACKUP_NOT_VERIFIED'));
  assert.ok(result.reasons.includes('RESTORE_DRILL_NOT_PASSED'));
  assert.ok(result.reasons.includes('ROLLBACK_PLAN_NOT_READY'));
});
