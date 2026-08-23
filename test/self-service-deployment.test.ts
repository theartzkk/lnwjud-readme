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

test('M11 self-service activation is one v7-to-v11 release with write-only provider storage and exact rollback', async () => {
  const release = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const result = await execFileAsync('/bin/sh', [deploy, '--dry-run', '--self-service'], {
    cwd: root,
    env: { ...process.env, AWH_SOURCE_ROOT: root, AWH_RELEASE_COMMIT: release, AWH_HUB_HOSTNAME: 'awh.example' },
  });
  assert.match(result.stdout, /^M11_DRY_RUN=PASS$/m);
  assert.match(result.stdout, new RegExp(`^M11_RELEASE=${release}$`, 'm'));
  assert.match(result.stdout, /migrate-007,idempotence,migrate-008,idempotence,attachment-storage-ready,migrate-009,idempotence,founding-memory-capability,migrate-010,idempotence,provider-credential-storage-ready,self-service-capability/);
  assert.match(result.stdout, /M11_ROLLBACK=restore-db-v7,pointer,web-pointer,nginx,service-health,m3d-m3e-m4-m7-regression/);
  assert.match(result.stdout, /M11_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL/);

  const [local, remoteSource, migration, credentials, service, app, adapter, recovery] = await Promise.all([
    readFile(deploy, 'utf8'), readFile(remote, 'utf8'), readFile(join(root, 'hub/migrations/010_self_service.sql'), 'utf8'),
    readFile(join(root, 'hub/src/HubProviderCredentialStore.php'), 'utf8'), readFile(join(root, 'hub/src/HubControlPlaneService.php'), 'utf8'),
    readFile(join(root, 'web/app.js'), 'utf8'), readFile(join(root, 'web/control-plane-adapter.js'), 'utf8'), readFile(join(root, 'docs/OWNER_DATA_RECOVERY.md'), 'utf8'),
  ]);
  assert.match(local, /--self-service/);
  assert.match(local, /migrate-self-service\.php/);
  assert.match(remoteSource, /SELF_SERVICE=\$\{20\}/);
  assert.match(remoteSource, /m11-self-service/);
  assert.match(remoteSource, /PRAGMA user_version;.*= 7/s);
  assert.match(remoteSource, /PRAGMA user_version;.*= 8/s);
  assert.match(remoteSource, /PRAGMA user_version;.*= 9/s);
  assert.match(remoteSource, /PRAGMA user_version;.*= 10/s);
  assert.match(remoteSource, /PRAGMA user_version;.*= 11/s);
  assert.match(remoteSource, /PROVIDER_CREDENTIAL_STORAGE_READY/);
  assert.match(remoteSource, /SELF_SERVICE_ROUTE/);
  assert.match(remoteSource, /SELF_SERVICE" = 1 && test .*PRAGMA user_version.* = 11/s);
  assert.match(remoteSource, /m11-self-service.*schema_version = 11/s);
  assert.match(remoteSource, /already-live M11/);
  assert.match(remoteSource, /install -d -o awh-hub -g awh-hub -m 0700 \/var\/lib\/awh-hub\/provider-credentials/);
  assert.match(migration, /control_provider_credentials/);
  assert.match(migration, /control_project_provider_overrides/);
  assert.match(credentials, /DEFAULT_ROOT = '\/var\/lib\/awh-hub\/provider-credentials'/);
  assert.match(credentials, /chmod\(\$temporary, 0600\)/);
  assert.match(credentials, /is_link\(\$path\)/);
  assert.match(service, /Provider secrets are write-only/);
  assert.match(service, /workersForUser/);
  assert.match(app, /ensureOwnerSelfServiceSurface/);
  assert.match(app, /ensureProviderSelfServiceSurface/);
  assert.match(app, /const enabledRow = enabled\?\.closest\('label'\)/);
  assert.match(app, /policy\.insertBefore\(models, enabledRow\)/);
  assert.doesNotMatch(app, /policy\.insertBefore\(models, \$\('provider-enabled'\)\)/);
  assert.match(app, /memory-search-form/);
  assert.match(app, /AWH จะไม่แสดงหรือส่งคืน key นี้/);
  assert.match(adapter, /updateProviderCredential/);
  assert.match(recovery, /Owner-only break-glass path/);
  assert.doesNotMatch(`${local}\n${remoteSource}\n${migration}\n${credentials}\n${service}\n${app}\n${adapter}`, /(?:BEGIN [A-Z ]+PRIVATE KEY|AWH_OPENAI_API_KEY\s*=|Authorization: Bearer sk-[A-Za-z0-9_-]{20,})/i);
});

test('M11 deployment assets remain valid POSIX shell', async () => {
  await execFileAsync('/bin/sh', ['-n', deploy]);
  await execFileAsync('/bin/sh', ['-n', remote]);
});
