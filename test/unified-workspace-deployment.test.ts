import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const deploy = join(root, 'deploy/awh-control-plane/deploy-control-plane.sh');
const remote = join(root, 'deploy/awh-control-plane/remote-deploy-control-plane.sh');

test('M8 unified workspace release is an exact v7-to-v8 migration with no owner-password transport or project seeding', async () => {
  const release = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const result = await execFileAsync('/bin/sh', [deploy, '--dry-run', '--unified-workspace'], { cwd: root, env: { ...process.env, AWH_SOURCE_ROOT: root, AWH_RELEASE_COMMIT: release } });
  assert.match(result.stdout, /^M8_DRY_RUN=PASS$/m);
  assert.match(result.stdout, new RegExp(`^M8_RELEASE=${release}$`, 'm'));
  assert.match(result.stdout, /verify-m7-capability,migrate-007,idempotence,unified-workspace-capability/);
  assert.match(result.stdout, /M8_ROLLBACK=restore-db-v7,pointer,web-pointer,nginx,service-health,m3d-m3e-m4-m7-regression/);
  const [local, remoteSource] = await Promise.all([readFile(deploy, 'utf8'), readFile(remote, 'utf8')]);
  assert.match(local, /--unified-workspace/);
  assert.match(local, /migrate-unified-workspace\.php/);
  assert.match(remoteSource, /UNIFIED_WORKSPACE=\$\{17\}/);
  assert.match(remoteSource, /m8-unified-workspace/);
  assert.match(remoteSource, /PRAGMA user_version;.*= 7/s);
  assert.match(remoteSource, /PRAGMA user_version;.*= 8/s);
  const start = remoteSource.indexOf('if test "$UNIFIED_WORKSPACE" = 1; then\n  # M8');
  const end = remoteSource.indexOf('elif test "$WORKSPACE_CONTINUITY" = 1; then', start);
  assert.ok(start >= 0 && end > start, 'M8 migration branch is present');
  assert.doesNotMatch(remoteSource.slice(start, end), /register-m4-projects|OWNER_AUTH_SETUP|OWNER_PASSWORD/);
});

test('M8 deployment assets remain valid POSIX shell', async () => {
  await execFileAsync('/bin/sh', ['-n', deploy]);
  await execFileAsync('/bin/sh', ['-n', remote]);
});
