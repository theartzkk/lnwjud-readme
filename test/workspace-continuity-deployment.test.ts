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

test('M7 continuity activation is release-locked, generic and upgrades accepted v5 through M6 to M7 exactly once', async () => {
  const result = await execFileAsync('/bin/sh', [deploy, '--dry-run', '--workspace-continuity'], { cwd: root, env: { ...process.env, AWH_SOURCE_ROOT: root, AWH_RELEASE_COMMIT: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } });
  assert.match(result.stdout, /^M7_DRY_RUN=PASS$/m);
  assert.match(result.stdout, /^M7_RELEASE=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$/m);
  assert.match(result.stdout, /migrate-005,idempotence,assistant-workstream-capability,migrate-006,idempotence,workspace-continuity-capability/);
  assert.match(result.stdout, /M7_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL/);
  const [localSource, remoteSource] = await Promise.all([readFile(deploy, 'utf8'), readFile(remote, 'utf8')]);
  assert.match(localSource, /--workspace-continuity/);
  assert.match(localSource, /migrate-workspace-continuity\.php/);
  assert.match(remoteSource, /WORKSPACE_CONTINUITY=\$\{16\}/);
  assert.match(remoteSource, /m7-workspace-continuity/);
  assert.match(remoteSource, /migrate-workspace-continuity\.php/);
  assert.match(remoteSource, /PRAGMA user_version;.*= 7/s);
  assert.match(remoteSource, /WORKSPACE_ROUTE/);
  const m7Start = remoteSource.indexOf('if test "$WORKSPACE_CONTINUITY" = 1; then\n  # M7');
  const m7End = remoteSource.indexOf('elif test "$ASSISTANT_WORKSTREAM" = 1; then', m7Start);
  assert.ok(m7Start >= 0 && m7End > m7Start, 'M7 migration branch is present');
  assert.doesNotMatch(remoteSource.slice(m7Start, m7End), /register-m4-projects|OWNER_AUTH_SETUP|OWNER_PASSWORD/);
});

test('M7 deployment scripts remain syntactically valid POSIX shell', async () => {
  await execFileAsync('/bin/sh', ['-n', deploy]);
  await execFileAsync('/bin/sh', ['-n', remote]);
});
