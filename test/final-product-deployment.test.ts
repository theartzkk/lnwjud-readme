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

test('M9 final product release is one bounded v7-to-v8-to-v9 activation with attachment and rollback gates', async () => {
  const release = 'cccccccccccccccccccccccccccccccccccccccc';
  const result = await execFileAsync('/bin/sh', [deploy, '--dry-run', '--final-product'], {
    cwd: root,
    env: { ...process.env, AWH_SOURCE_ROOT: root, AWH_RELEASE_COMMIT: release, AWH_HUB_HOSTNAME: 'awh.example' },
  });
  assert.match(result.stdout, /^M9_DRY_RUN=PASS$/m);
  assert.match(result.stdout, new RegExp(`^M9_RELEASE=${release}$`, 'm'));
  assert.match(result.stdout, /verify-m7-capability,migrate-007,idempotence,migrate-008,idempotence,attachment-storage-ready,final-product-capability/);
  assert.match(result.stdout, /M9_ROLLBACK=restore-db-v7,pointer,web-pointer,nginx,service-health,m3d-m3e-m4-m7-regression/);
  assert.match(result.stdout, /M9_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL/);

  const [local, remoteSource, include, migration, agent, control] = await Promise.all([
    readFile(deploy, 'utf8'),
    readFile(remote, 'utf8'),
    readFile(join(root, 'deploy/nginx/awh-control-plane.conf'), 'utf8'),
    readFile(join(root, 'hub/migrations/008_final_product.sql'), 'utf8'),
    readFile(join(root, 'hub/src/HubNativeAgentService.php'), 'utf8'),
    readFile(join(root, 'hub/src/HubControlPlaneService.php'), 'utf8'),
  ]);
  assert.match(local, /--final-product/);
  assert.match(local, /migrate-final-product\.php/);
  assert.match(remoteSource, /FINAL_PRODUCT=\$\{18\}/);
  assert.match(remoteSource, /m9-final-product/);
  assert.match(remoteSource, /PRAGMA user_version;.*= 7/s);
  assert.match(remoteSource, /PRAGMA user_version;.*= 8/s);
  assert.match(remoteSource, /PRAGMA user_version;.*= 9/s);
  const start = remoteSource.indexOf('elif test "$FINAL_PRODUCT" = 1; then\n  # The final activation');
  const end = remoteSource.indexOf('elif test "$UNIFIED_WORKSPACE" = 1; then', start);
  assert.ok(start >= 0 && end > start, 'M9 migration branch is present');
  assert.doesNotMatch(remoteSource.slice(start, end), /register-m4-projects|OWNER_AUTH_SETUP|OWNER_PASSWORD/);
  assert.match(remoteSource, /ATTACHMENT_STORAGE_READY/);
  assert.match(remoteSource, /FINAL_PRODUCT_ROUTE/);
  // The M9 CLI owns its migration path and accepts only DATABASE_PATH.  The
  // production runner must not append an unused SQL argument: that makes the
  // CLI reject the invocation before SQLite is reached.
  assert.equal((remoteSource.match(/\$FINAL_MIGRATION" "\$DB" >\/dev\/null/g) ?? []).length, 6);
  assert.doesNotMatch(remoteSource, /\$FINAL_MIGRATION" "\$DB" "\$RELEASE\/hub\/migrations\/008_final_product\.sql"/);
  assert.match(remoteSource, /test "\$\(sudo sqlite3 "\$DB" 'PRAGMA user_version;'\)" = 7 \|\| ok=0/);
  assert.match(include, /client_max_body_size 64m/);
  assert.match(migration, /control_provider_policies/);
  assert.match(migration, /control_project_capabilities/);
  assert.match(agent, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(agent, /'store' => false/);
  assert.match(control, /'projectDirectory' => \$directory/);
  assert.match(control, /state <> 'CANCELLED'/);
  assert.doesNotMatch(`${local}\n${remoteSource}\n${migration}\n${agent}\n${control}`, /(?:BEGIN [A-Z ]+PRIVATE KEY|AWH_OPENAI_API_KEY\s*=|Authorization: Bearer sk-[A-Za-z0-9_-]{20,})/i);
});

test('M9 deployment assets remain valid POSIX shell', async () => {
  await execFileAsync('/bin/sh', ['-n', deploy]);
  await execFileAsync('/bin/sh', ['-n', remote]);
});
