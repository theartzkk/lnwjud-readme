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
  assert.match(backend, /public function databaseInventory/);
  assert.match(backend, /private function fleetSnapshot/);
  assert.match(router, /'databases' => \$service->databaseInventory/);
  assert.match(web, /studioApi\('databases'/);
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

test('night manifest is pinned to freshly observed source heads and restore evidence', async () => {
  const manifest=JSON.parse(await text('docs/migration/bay-ecosystem-manifest.json'));
  assert.equal(manifest.schemaVersion,2);
  const byId=Object.fromEntries(manifest.projects.map((p:any)=>[p.id,p]));
  assert.equal(byId.awh.sourceRevision,'6900cf447e966fd093b22ad981d56cdde317d35b');
  assert.equal(manifest.sourceMergeEvidence.mergeCommit,'6900cf447e966fd093b22ad981d56cdde317d35b');
  assert.equal(manifest.sourceMergeEvidence.productionActivationAuthorized,false);
  assert.equal(byId.awh.productionRelease,'m20-504ac7b986dd');
  assert.equal(byId['bay-excuse-x'].sourceRevision,'b60b13e38f4362a5b4a4011b63aa65a7d4cbf5d0');
  assert.equal(byId['bay-excuse-x'].sourceVersion,'2.0.0-RC5.4.6');
  assert.equal(byId['bay-excuse-x'].productionExactRevision,'PENDING_READ_ONLY_PRODUCTION_STATE_PROOF');
  assert.equal(byId['bay-learnlab'].defaultRevisionObserved,'d1e02e554d211c8f71b954f35d9a027216f8b41c');
  assert.equal(byId['bay-hub'].sourceRevision,'78ed43fb6d97b2e714ef1e2a28eb796642682afd');
  assert.equal(byId['school-website'].canonicalRevision,null);
  assert.equal(manifest.currentVpsEvidence.restoreEvidence.awhSqlite.state,'PASS');
  assert.equal(manifest.currentVpsEvidence.restoreEvidence.mariaDbStaging.rowCountMismatch,0);
});
