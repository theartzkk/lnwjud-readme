import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('TeamAI harness stays projection-only and preserves AWH authorities', () => {
  const policy = JSON.parse(readFileSync('config/teamai-harness-policy.json', 'utf8'));
  assert.equal(policy.enabled, false);
  assert.equal(policy.mode, 'projection-only');
  assert.equal(policy.authority.canonicalSource, 'AWH');
  assert.equal(policy.authority.projectMemory, 'AWH');
  assert.equal(policy.authority.taskQueue, 'AWH');
  assert.equal(policy.authority.execution, 'AWH');
  assert.equal(policy.authority.approvals, 'AWH');
  assert.equal(policy.authority.ownerIdentity, 'AWH');
  assert.equal(policy.authority.schoolIdentityAndData, 'BAY EXCUSE X');
  assert.equal(policy.authority.mcpRegistry, 'AWH');
  assert.ok(policy.forbiddenCapabilities.includes('secret_export'));
  assert.ok(policy.forbiddenCapabilities.includes('automatic_hook_injection'));
  assert.ok(policy.forbiddenCapabilities.includes('automatic_learning_promotion'));
});

test('TeamAI projection preflight produces a bounded provenance-linked export', () => {
  const result = spawnSync(process.execPath, ['scripts/qa/teamai-harness-preflight.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, GITHUB_SHA: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /TEAMAI_HARNESS_PREFLIGHT=PASS/);
  assert.match(result.stdout, /teamai=0\.22\.0/);
});
