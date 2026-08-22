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

test('M10 Founding Memory release is one bounded M7-to-M8-to-M9-to-M10 activation with safe import and rollback gates', async () => {
  const release = 'dddddddddddddddddddddddddddddddddddddddd';
  const result = await execFileAsync('/bin/sh', [deploy, '--dry-run', '--founding-memory'], {
    cwd: root,
    env: { ...process.env, AWH_SOURCE_ROOT: root, AWH_RELEASE_COMMIT: release, AWH_HUB_HOSTNAME: 'awh.example' },
  });
  assert.match(result.stdout, /^M10_DRY_RUN=PASS$/m);
  assert.match(result.stdout, new RegExp('^M10_RELEASE=' + release + '$', 'm'));
  assert.match(result.stdout, /migrate-007,idempotence,migrate-008,idempotence,attachment-storage-ready,migrate-009,idempotence,founding-memory-import,idempotence,founding-memory-capability/);
  assert.match(result.stdout, /M10_ROLLBACK=restore-db-v7,pointer,web-pointer,nginx,service-health,m3d-m3e-m4-m7-regression/);
  assert.match(result.stdout, /M10_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL/);

  const [local, remoteSource, migration, service, seed] = await Promise.all([
    readFile(deploy, 'utf8'),
    readFile(remote, 'utf8'),
    readFile(join(root, 'hub/migrations/009_founding_memory.sql'), 'utf8'),
    readFile(join(root, 'hub/src/HubFoundingMemoryService.php'), 'utf8'),
    readFile(join(root, 'hub/src/HubFoundingMemorySeed.php'), 'utf8'),
  ]);
  assert.match(local, /--founding-memory/);
  assert.match(local, /migrate-founding-memory\.php/);
  assert.match(remoteSource, /FOUNDING_MEMORY=\$\{19\}/);
  assert.match(remoteSource, /m10-founding-memory/);
  assert.match(remoteSource, /PRAGMA user_version;.*= 7/s);
  assert.match(remoteSource, /PRAGMA user_version;.*= 8/s);
  assert.match(remoteSource, /PRAGMA user_version;.*= 9/s);
  assert.match(remoteSource, /PRAGMA user_version;.*= 10/s);
  const start = remoteSource.indexOf('if test "$FOUNDING_MEMORY" = 1; then\n  # M10 is the one bounded activation');
  const end = remoteSource.indexOf('elif test "$FINAL_PRODUCT" = 1; then', start);
  assert.ok(start >= 0 && end > start, 'M10 migration branch is present');
  const branch = remoteSource.slice(start, end);
  assert.match(branch, /\$UNIFIED_MIGRATION/);
  assert.match(branch, /\$FINAL_MIGRATION/);
  assert.match(branch, /\$FOUNDING_MIGRATION/);
  assert.doesNotMatch(branch, /register-m4-projects|OWNER_AUTH_SETUP|OWNER_PASSWORD/);
  assert.match(remoteSource, /FOUNDING_MEMORY_ROUTE/);
  assert.match(remoteSource, /test "\$\(sudo sqlite3 "\$DB" 'PRAGMA user_version;'\)" = 7 \|\| ok=0/);
  assert.match(migration, /control_memory_import_batches/);
  assert.match(migration, /control_memory_records/);
  assert.match(migration, /control_memory_revisions/);
  assert.match(service, /PROJECT_SHARED/);
  assert.match(service, /OWNER_PRIVATE/);
  assert.match(service, /Sensitive material cannot be stored as ordinary memory/);
  assert.match(seed, /Current source\/runtime evidence always has higher authority/);
  assert.doesNotMatch([local, remoteSource, migration, service, seed].join('\n'), /(?:BEGIN [A-Z ]+PRIVATE KEY|AWH_OPENAI_API_KEY\s*=|Authorization: Bearer sk-[A-Za-z0-9_-]{20,})/i);
});

test('M10 deployment assets remain valid POSIX shell', async () => {
  await execFileAsync('/bin/sh', ['-n', deploy]);
  await execFileAsync('/bin/sh', ['-n', remote]);
});
