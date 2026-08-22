import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ALLOWED_STAGES, BASIC_AUTH_HOST, BASIC_AUTH_KEY, BASIC_AUTH_USER, parseRotationOutput, validateAssets } from '../scripts/ops/basic-auth-rotation.mjs';

test('Basic Auth primitive has a fixed asset, host, user and no secret-bearing shell path', async () => {
  const path = validateAssets();
  const source = await readFile(path, 'utf8');
  assert.equal(BASIC_AUTH_HOST, '157-85-108-142.sslip.io');
  assert.equal(BASIC_AUTH_USER, 'awh-preview');
  assert.equal(BASIC_AUTH_KEY, 'awh/preview-basic-auth-password');
  assert.match(source, /test ! -L "\$F"/);
  assert.match(source, /\/etc\/nginx\/\.awh-preview-users\.\$ID\.tmp/);
  assert.match(source, /sudo -n mv -f "\$T" "\$F"/);
  assert.doesNotMatch(source, /\$\{password\}|\$\{token\}|\$\{nonce\}/i);
});

test('stage/error contract accepts only sanitized allowlisted output', () => {
  const parsed = parseRotationOutput('ROTATE_STAGE=PRECHECK\nROTATE_STAGE=HASH_RECEIVED\nROTATE_RESULT=PASS');
  assert.equal(parsed.ROTATE_RESULT, 'PASS');
  assert.equal(ALLOWED_STAGES.has('AUTH_VERIFY'), true);
  assert.throws(() => parseRotationOutput('ROTATE_STAGE=PRECHECK\nsecret-value'), /ROTATION_OUTPUT_INVALID/);
  assert.throws(() => parseRotationOutput('ROTATE_FAILED_AT=RUN_SHELL\nROTATE_FAILURE_CODE=X'), /ROTATION_FAILURE_STAGE_INVALID/);
  assert.throws(() => parseRotationOutput('ROTATE_STAGE=PRECHECK\nROTATE_FAILURE_CODE=raw-stderr'), /ROTATION_OUTPUT_INVALID/);
});

test('rollback contract and metadata protections are explicit', async () => {
  const source = await readFile(validateAssets(), 'utf8');
  assert.match(source, /cp -p "\$F" "\$B"/);
  assert.match(source, /chown "\$O:\$G" "\$T"/);
  assert.match(source, /chmod "\$M" "\$T"/);
  assert.match(source, /ROLLBACK=PASS/);
  assert.match(source, /ACTION=\$\{4-rotate\}/);
  assert.match(source, /ACTION.*rollback/);
  assert.match(source, /ACTION.*cleanup/);
  assert.match(source, /ROTATE_FAILED_AT=\$1/);
  assert.doesNotMatch(source, /userdel|chmod 777|curl[^\n]*-k/);
});

test('primitive never accepts a plaintext password on the remote boundary', async () => {
  const [local, remote] = await Promise.all([
    readFile(new URL('../scripts/ops/basic-auth-rotation.mjs', import.meta.url), 'utf8'),
    readFile(validateAssets(), 'utf8'),
  ]);
  assert.match(local, /passwd.*-apr1.*-stdin/);
  assert.match(local, /\$\{hash\}\\n/);
  assert.match(remote, /H=\$\(cat\)/);
  assert.doesNotMatch(remote, /\$\{PASSWORD\}|\$\{PLAINTEXT\}|\$\{secret\}/i);
  assert.doesNotMatch(`${local}\n${remote}`, /console\.log\(password|console\.log\(hash/);
});

test('post-replacement verification has an explicit rollback-before-cleanup contract', async () => {
  const source = await readFile(new URL('../scripts/ops/basic-auth-rotation.mjs', import.meta.url), 'utf8');
  assert.match(source, /command\('rollback'\)/);
  assert.match(source, /command\('cleanup'\)/);
  assert.ok(source.indexOf("command('rollback')") < source.indexOf("command('cleanup')"));
});
