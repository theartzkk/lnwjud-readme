import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const text = async (p: string) => readFile(join(root, p), 'utf8');

test('database fleet inventory is metadata-only and root-generated', async () => {
  const [inventory, service, timer, backend, router, web] = await Promise.all([
    text('deploy/awh-database/awh-database-inventory.py'),
    text('deploy/systemd/awh-database-inventory.service'),
    text('deploy/systemd/awh-database-inventory.timer'),
    text('hub/src/HubDatabaseStudioService.php'),
    text('hub/src/HubDatabaseStudioRouter.php'),
    text('web/database.js'),
  ]);
  assert.match(inventory, /information_schema\.tables/);
  assert.match(inventory, /--protocol=socket/);
  assert.match(inventory, /sizeBytes/);
  assert.doesNotMatch(inventory, /SELECT \* FROM/);
  assert.doesNotMatch(inventory, /password|credential_ref|DB_PASSWORD/i);
  assert.match(service, /User=root/);
  assert.match(service, /ReadWritePaths=\/var\/lib\/awh-hub/);
  assert.match(timer, /OnUnitActiveSec=15m/);
  assert.match(backend, /public function fleet/);
  assert.match(router, /'fleet' => \$service->fleet/);
  assert.match(web, /studioApi\('fleet'/);
});

test('imported live storage lifecycle stays bounded and protects authorities', async () => {
  const [retention, guard, temp] = await Promise.all([
    text('deploy/awh-storage/awh-retention-manager.py'),
    text('deploy/awh-storage/awh-storage-guard'),
    text('deploy/awh-storage/awh-temp-cleanup'),
  ]);
  assert.match(retention, /active executions/);
  assert.match(retention, /protected\.add/);
  assert.match(retention, /backup verification failed/);
  assert.match(retention, /scheduled\[:3\]/);
  assert.match(retention, /release_keep\.update\(name for _,name,_ in pairs\[:6\]\)/);
  assert.match(retention, /release pointers changed during run/);
  assert.match(guard, /Never touches backups\/releases\/databases\/artifacts/);
  assert.doesNotMatch(guard, /\/var\/backups|\/var\/www\/awh-web\/releases|awh\.sqlite/);
  assert.match(temp, /find \/tmp -xdev -maxdepth 1/);
  assert.match(temp, /-mtime \+7/);
  assert.match(temp, /lsof/);
});

test('migration manifest forbids blind production cutover and disk clone', async () => {
  const [manifestRaw, runbook, readiness, preflight] = await Promise.all([
    text('docs/migration/bay-ecosystem-manifest.json'),
    text('docs/migration/INFINITYFREE_SHADOW_MIGRATION.md'),
    text('docs/VPS_MIGRATION_READINESS_20260907.md'),
    text('deploy/vps-migration/preflight-clean-target.sh'),
  ]);
  const manifest = JSON.parse(manifestRaw);
  assert.equal(manifest.policy.cloneOldDisk, false);
  assert.equal(manifest.policy.productionCutoverAllowed, false);
  assert.equal(manifest.policy.dualWriteAllowed, false);
  const school = manifest.projects.find((p: any) => p.id === 'school-website');
  assert.equal(school.prototypeIsCanonical, false);
  const bay = manifest.projects.find((p: any) => p.id === 'bay-excuse-x');
  assert.equal(bay.database.vpsProofDatabasesAreProduction, false);
  assert.match(runbook, /DNS-only rollback is forbidden/);
  assert.match(readiness, /clean VPS build/);
  assert.match(preflight, /Read-only preflight/);
  assert.doesNotMatch(preflight, /apt(-get)? install|rm -rf|systemctl enable|CREATE DATABASE/i);
});
