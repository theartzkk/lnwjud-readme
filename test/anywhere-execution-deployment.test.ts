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

test('M13 Anywhere Execution is Cloud-first, additive, and rollback-safe', async () => {
  const release = 'dddddddddddddddddddddddddddddddddddddddd';
  const result = await execFileAsync('/bin/sh', [deploy, '--dry-run', '--owner-auth', '--anywhere-execution'], {
    cwd: root,
    env: { ...process.env, AWH_SOURCE_ROOT: root, AWH_RELEASE_COMMIT: release, AWH_HUB_HOSTNAME: 'awh.example' },
  });
  assert.match(result.stdout, /^M13_DRY_RUN=PASS$/m);
  assert.match(result.stdout, new RegExp(`^M13_RELEASE=${release}$`, 'm'));
  assert.match(result.stdout, /quiesce-native-executor,migrate-012-only-from-v12/);
  assert.match(result.stdout, /restore-exact-db-baseline/);
  assert.match(result.stdout, /M13_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL/);
  const [local, remoteSource, migrationService, registry, control, durable, webApp] = await Promise.all([
    readFile(deploy, 'utf8'), readFile(remote, 'utf8'),
    readFile(join(root, 'hub/src/HubAnywhereExecutionMigration.php'), 'utf8'),
    readFile(join(root, 'hub/src/HubCapabilityRegistryService.php'), 'utf8'),
    readFile(join(root, 'hub/src/HubControlPlaneService.php'), 'utf8'),
    readFile(join(root, 'hub/src/HubDurableExecutionService.php'), 'utf8'),
    readFile(join(root, 'web/app.js'), 'utf8'),
  ]);
  assert.match(local, /--anywhere-execution/);
  assert.match(local, /ANYWHERE_EXECUTION_ROUTE/);
  assert.match(remoteSource, /ANYWHERE_EXECUTION=\$\{23\}/);
  assert.match(remoteSource, /case "\$M13_START_VERSION" in 12\|13/);
  assert.match(remoteSource, /NATIVE_EXECUTOR_QUIESCED/);
  assert.match(remoteSource, /DEPLOY_BASE_VERSION/);
  assert.match(remoteSource, /DB_MUTATED=1\s+if test "\$M13_REFRESH"/);
  assert.match(remoteSource, /DB_MUTATED=1; stage PROJECT_VAULT_SOURCE_SYNC/);
  assert.match(migrationService, /lnwjud-upstream/);
  assert.match(migrationService, /voice\.tts/);
  assert.match(migrationService, /video\.render/);
  assert.match(registry, /syncDeviceWorker/);
  assert.match(registry, /code\.specialist/);
  assert.match(control, /capabilityStatus/);
  assert.match(control, /syncDeviceWorker/);
  assert.match(durable, /ensureExecutionEnvelope/);
  assert.match(durable, /updateEnvelopeState/);
  assert.match(webApp, /พร้อมใช้จาก AWH Cloud/);
  assert.match(webApp, /ใช้ได้เมื่อมีอุปกรณ์เสริม/);
  assert.doesNotMatch(`${local}\n${remoteSource}\n${migrationService}\n${registry}`, /(?:BEGIN [A-Z ]+PRIVATE KEY|Authorization: Bearer sk-[A-Za-z0-9_-]{20,})/i);
});

test('M13 deployment scripts remain valid POSIX shell', async () => {
  await execFileAsync('/bin/sh', ['-n', deploy]);
  await execFileAsync('/bin/sh', ['-n', remote]);
});
