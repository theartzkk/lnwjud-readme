import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commandReadyForExecution,
  commandRequiresApproval,
  expectedRiskClass,
  validateCommandJob,
} from '../src/command-bus.js';

const base = {
  schemaVersion: 1 as const,
  jobId: '113b45c0-23e1-408d-ae0f-ac5eca7f6900',
  projectId: '223b45c0-23e1-408d-ae0f-ac5eca7f6900',
  repository: 'theartzkk/lnwjud-readme',
  revision: '9f614813c3fac2132da22553522dbad7befc78d7',
  action: 'qa' as const,
  riskClass: 'routine' as const,
  approval: 'not-required' as const,
  requestedAt: '2026-08-21T15:00:00+07:00',
  requestedBy: 'chatgpt-github-bridge' as const,
};

test('routine command is exact-SHA bounded and ready without approval', () => {
  const job = validateCommandJob(base);
  assert.equal(job.revision, base.revision);
  assert.equal(expectedRiskClass(job.action), 'routine');
  assert.equal(commandRequiresApproval(job), false);
  assert.equal(commandReadyForExecution(job), true);
});

test('production command is blocked until approval is granted', () => {
  const pending = validateCommandJob({
    ...base,
    action: 'deploy_production',
    riskClass: 'production',
    approval: 'pending',
  });
  assert.equal(commandRequiresApproval(pending), true);
  assert.equal(commandReadyForExecution(pending), false);

  const granted = validateCommandJob({ ...pending, approval: 'granted' });
  assert.equal(commandReadyForExecution(granted), true);
});

test('risk and approval cannot be downgraded for production actions', () => {
  assert.throws(() => validateCommandJob({ ...base, action: 'deploy_production' }), /risk class/i);
  assert.throws(() => validateCommandJob({ ...base, action: 'deploy_production', riskClass: 'production' }), /approval/i);
});

test('contract rejects arbitrary command fields, moving refs and malformed repositories', () => {
  assert.throws(() => validateCommandJob({ ...base, command: 'rm -rf /' }), /unrecognized|key/i);
  assert.throws(() => validateCommandJob({ ...base, revision: 'main' }), /invalid|expected|format/i);
  assert.throws(() => validateCommandJob({ ...base, repository: 'https://github.com/theartzkk/lnwjud-readme' }), /invalid|expected|format/i);
});

test('routine actions cannot smuggle approval state', () => {
  assert.throws(() => validateCommandJob({ ...base, approval: 'granted' }), /routine/i);
});
