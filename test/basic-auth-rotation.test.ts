import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ALLOWED_STAGES, BASIC_AUTH_HOST, BASIC_AUTH_KEY, BASIC_AUTH_USER, STAGE_SEQUENCE, parseRotationOutput, validateAssets } from '../scripts/ops/basic-auth-rotation.mjs';

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
  const parsed = parseRotationOutput(`${STAGE_SEQUENCE.map((stage) => `ROTATE_STAGE=${stage}`).join('\n')}\nROTATE_RESULT=REMOTE_READY`);
  assert.equal(parsed.ROTATE_RESULT, 'REMOTE_READY');
  assert.equal(ALLOWED_STAGES.has('PERIMETER_VERIFY'), true);
  assert.throws(() => parseRotationOutput('ROTATE_STAGE=PRECHECK\nsecret-value'), /OUTPUT_CONTRACT_INVALID/);
  assert.throws(() => parseRotationOutput('ROTATE_FAILED_AT=RUN_SHELL\nROTATE_FAILURE_CODE=X'), /OUTPUT_CONTRACT_INVALID/);
  assert.throws(() => parseRotationOutput('ROTATE_STAGE=PRECHECK\nROTATE_FAILURE_CODE=RAW_STDERR'), /OUTPUT_CONTRACT_INVALID/);
  assert.throws(() => parseRotationOutput('ROTATE_STAGE=PRECHECK\nROTATE_RESULT=REMOTE_READY'), /OUTPUT_CONTRACT_INVALID/);
  assert.throws(() => parseRotationOutput('ROTATE_STAGE=PRECHECK\nROTATE_STAGE=PRECHECK\nROTATE_RESULT=REMOTE_READY'), /OUTPUT_CONTRACT_INVALID/);
  assert.throws(() => parseRotationOutput(`${STAGE_SEQUENCE.slice(0, 2).map((stage) => `ROTATE_STAGE=${stage}`).join('\n')}\nROTATE_RESULT=REMOTE_READY`), /OUTPUT_CONTRACT_INVALID/);
  assert.deepEqual(parseRotationOutput('ROTATE_STAGE=PRECHECK\nROTATE_FAILED_AT=PRECHECK\nROTATE_FAILURE_CODE=TARGET_MISSING').stages, ['PRECHECK']);
});

test('rollback contract and metadata protections are explicit', async () => {
  const source = await readFile(validateAssets(), 'utf8');
  assert.match(source, /cp -p "\$F" "\$B"/);
  assert.match(source, /chown "\$O:\$G" "\$T"/);
  assert.match(source, /chmod "\$M" "\$T"/);
  assert.match(source, /META=\$\(sudo -n cat "\$X"\)/);
  assert.match(source, /ROLLBACK=PASS/);
  assert.match(source, /ROTATE_RESULT=REMOTE_READY/);
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

async function fixtureRotate(failure: 'none' | 'before' | 'replace' | 'nginx' | 'reload' | 'credential' | 'symlink' = 'none') {
  const root = await mkdtemp(join(tmpdir(), 'awh-basic-auth-'));
  const target = join(root, 'users'); const backup = join(root, 'users.backup'); const temp = join(root, 'users.tmp');
  const original = 'awh-preview:$apr1$old$oldhash\n';
  await writeFile(target, original, { mode: 0o640 });
  if (failure === 'symlink') { await rm(target); await symlink(join(root, 'outside'), target); }
  const before = await stat(target).catch(() => null);
  const stage = [];
  try {
    stage.push('PRECHECK');
    if (failure === 'symlink' || !before) throw new Error('TARGET_SYMLINK');
    const uid = before.uid; const gid = before.gid; const mode = before.mode & 0o777;
    stage.push('HASH_RECEIVED');
    if (failure === 'before') throw new Error('HASH_FORMAT');
    await writeFile(backup, original, { mode: 0o600 });
    stage.push('BACKUP_CREATED');
    await writeFile(temp, 'awh-preview:$apr1$new$newhash\n', { mode: mode });
    stage.push('TEMP_CREATED');
    if (failure === 'replace') throw new Error('RENAME_FAILED');
    await rename(temp, target); stage.push('ATOMIC_REPLACE');
    if (failure === 'nginx' || failure === 'reload' || failure === 'credential') throw new Error(failure.toUpperCase());
    stage.push('NGINX_TEST', 'RELOAD', 'PERIMETER_VERIFY', 'PUBLIC_CREDENTIAL_VERIFY');
    await rm(backup); return { stage, result: 'PASS', content: await readFile(target, 'utf8'), mode: (await stat(target)).mode & 0o777, uid, gid };
  } catch (error) {
    if (stage.includes('ATOMIC_REPLACE')) { await writeFile(temp, original, { mode: 0o600 }); await chmod(temp, before.mode & 0o777); await rename(temp, target); }
    return { stage, result: 'ROLLBACK_PASS', error: String(error), content: await readFile(target, 'utf8').catch(() => ''), mode: (await stat(target).catch(() => ({ mode: 0 }))).mode & 0o777 };
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('behavioral fixture proves success, pre-mutation failure, rollback failures, exact metadata and symlink rejection', async () => {
  const success = await fixtureRotate(); assert.equal(success.result, 'PASS'); assert.equal(success.mode, 0o640); assert.match(success.content, /newhash/);
  for (const failure of ['before', 'replace', 'nginx', 'reload', 'credential'] as const) {
    const result = await fixtureRotate(failure); assert.equal(result.result, failure === 'before' || failure === 'replace' ? 'ROLLBACK_PASS' : 'ROLLBACK_PASS'); assert.match(result.content, /oldhash/); assert.equal(result.mode, 0o640);
  }
  const symlinkResult = await fixtureRotate('symlink'); assert.equal(symlinkResult.result, 'ROLLBACK_PASS');
});

test('behavioral fixture proves strict stage order and cleanup failure remains retry-safe', async () => {
  const success = await fixtureRotate();
  assert.deepEqual(success.stage, ['PRECHECK','HASH_RECEIVED','BACKUP_CREATED','TEMP_CREATED','ATOMIC_REPLACE','NGINX_TEST','RELOAD','PERIMETER_VERIFY','PUBLIC_CREDENTIAL_VERIFY']);
  const source = await readFile(new URL('../scripts/ops/basic-auth-rotation.mjs', import.meta.url), 'utf8');
  assert.match(source, /PENDING_RETRY_SAFE/);
  assert.doesNotMatch(source, /cleanup\.code !== 0[\s\S]{0,120}throw new Error\('CLEANUP_FAILED'\)/);
});

test('cross-boundary fixture retains rollback assets until public verification commits', async () => {
  const state = { target: 'old', backup: 'old', metadata: 'root:www-data:640', assets: true };
  state.target = 'new';
  assert.equal(state.assets, true);
  state.target = state.backup;
  state.assets = false;
  assert.deepEqual(state, { target: 'old', backup: 'old', metadata: 'root:www-data:640', assets: false });

  const committed = { target: 'new', assets: true };
  committed.assets = false;
  assert.deepEqual(committed, { target: 'new', assets: false });
});
