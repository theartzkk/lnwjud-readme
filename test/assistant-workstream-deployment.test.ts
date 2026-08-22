import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const deploy = join(ROOT, 'deploy/awh-control-plane/deploy-control-plane.sh');
const remote = join(ROOT, 'deploy/awh-control-plane/remote-deploy-control-plane.sh');

test('M6 workstream activation is a release-locked v5-to-v6 extension with no owner-password transport', async () => {
  const result = await execFileAsync('/bin/sh', [deploy, '--dry-run', '--assistant-workstream'], {
    cwd: ROOT,
    env: { ...process.env, AWH_SOURCE_ROOT: ROOT, AWH_RELEASE_COMMIT: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  });
  assert.match(result.stdout, /^M6_DRY_RUN=PASS$/m);
  assert.match(result.stdout, /^M6_RELEASE=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$/m);
  assert.match(result.stdout, /migrate-005,idempotence,assistant-workstream-capability/);
  assert.match(result.stdout, /M6_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL/);

  const [localSource, remoteSource] = await Promise.all([readFile(deploy, 'utf8'), readFile(remote, 'utf8')]);
  assert.match(localSource, /--assistant-workstream/);
  assert.match(localSource, /if test "\$ASSISTANT_WORKSTREAM" -eq 1; then[\s\S]*ssh -o BatchMode/s);
  assert.match(remoteSource, /test "\$ASSISTANT_WORKSTREAM" = 1; then[\s\S]*PRAGMA user_version;.*= 5/s);
  assert.match(remoteSource, /ASSISTANT_MIGRATION_FIRST/);
  assert.match(remoteSource, /migrate-assistant-workstream\.php/);
  assert.match(remoteSource, /PRAGMA user_version;.*= 6/s);
  assert.match(remoteSource, /m6-assistant-workstream/);
  assert.match(remoteSource, /DB_MUTATED=1/);
  assert.match(remoteSource, /sqlite3 "\$DB" "\.restore '\$BACKUP'"/);
  const m6BranchStart = remoteSource.indexOf('if test "$ASSISTANT_WORKSTREAM" = 1; then\n  # M6 is additive');
  const m6BranchEnd = remoteSource.indexOf('elif test "$COMPAT_REFRESH" = 1; then', m6BranchStart);
  assert.ok(m6BranchStart >= 0 && m6BranchEnd > m6BranchStart, 'M6 migration branch is present');
  assert.doesNotMatch(remoteSource.slice(m6BranchStart, m6BranchEnd), /OWNER_AUTH_SETUP|printf '%s\\n' "\$OWNER_PASSWORD"/);
});

test('M6 deployment scripts remain syntactically valid POSIX shell', async () => {
  await execFileAsync('/bin/sh', ['-n', deploy]);
  await execFileAsync('/bin/sh', ['-n', remote]);
});
