import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = async (path: string) => readFile(new URL('../' + path, import.meta.url), 'utf8');
const json = async (path: string) => JSON.parse(await read(path));

test('M23 platform policy locks long-term ecosystem authorities', async () => {
  const p = await json('config/ecosystem-platform-policy.json');
  assert.equal(p.schemaVersion, 1);
  assert.equal(p.identity.platformAuthority, 'KRUART');
  assert.equal(p.identity.schoolAuthority, 'BAY_EXCUSE_X');
  assert.equal(p.identity.academicContextAuthority, 'BAY_EXCUSE_X');
  assert.equal(p.releaseContract.artifactFirst, true);
  assert.equal(p.releaseContract.buildOnceDeployExactArtifact, true);
  assert.equal(p.queueLifecycle.indefiniteQueuedStateForbidden, true);
  assert.equal(p.queueLifecycle.deadLetterRequired, true);
  assert.equal(p.backup.offServerMirrorRequired, true);
  assert.equal(p.eventBus.authority, 'AWH_DURABLE_OUTBOX');
  assert.equal(p.eventBus.directCrossProductDatabaseWritesForbidden, true);
  assert.equal(p.operationsCenter.defaultView, 'SUMMARY_FIRST_WITH_ATTENTION_FILTER');
});

test('ecosystem release contract covers every Update Center product family', async () => {
  const c = await json('config/ecosystem-release-contract.json');
  const registry = await read('hub/src/HubUpdateTargetRegistry.php');
  const registryKeys=[...registry.matchAll(/^\s*'([^']+)'=>\[/gm)].map((match)=>match[1]);
  assert.deepEqual(Object.keys(c.products).sort(), registryKeys.sort());
  for (const [key, row] of Object.entries(c.products as Record<string,{project:string}>)) {
    assert.equal(registry.includes("'" + key + "'"), true);
    assert.ok(row.project.length > 0);
  }
  assert.deepEqual(c.requiredArtifactIdentity, ['product','version','sourceSha','artifactSha256','schemaVersion','builtAt']);
  assert.equal(c.rules.productionRebuildForbidden, true);
  assert.equal(c.rules.rollbackArtifactRequired, true);
});

test('navigation contract forbids dead-end product surfaces', async () => {
  const c = await json('config/ecosystem-navigation-contract.json');
  const nav = await read('web/navigation.js');
  assert.equal(c.rules.deadEndsForbidden, true);
  assert.deepEqual(c.rules.requiredEscapeActions, ['HOME','BACK_OR_PARENT']);
  assert.match(nav, /installAwhBackNavigation/);
  assert.match(nav, /window\.history\.back/);
  assert.deepEqual(Object.keys(c.personas).sort(), ['ADMIN','STUDENT','TEACHER']);
});

test('platform hardening is wired to runtime rather than documentation only', async () => {
  const executor = await read('hub/bin/awh-native-executor.php');
  const bridge = await read('hub/src/HubOperatorBridgeService.php');
  const router = await read('hub/src/HubControlPlaneRouter.php');
  const bounded = await read('scripts/ops/bounded-deploy-mission.mjs');
  const deploy = await read('deploy/awh-control-plane/remote-deploy-control-plane.sh');
  const health = await read('hub/src/HubEcosystemHealthService.php');
  const control = await read('hub/src/HubControlPlaneService.php');
  assert.match(executor, /HubExecutionLifecycleService/);
  assert.match(executor, /->reconcile\(/);
  assert.match(bridge, /HubExecutionLifecycleService/);
  assert.match(router, /identity\/academic-context/);
  assert.match(bounded, /--platform-hardening/);
  assert.match(bounded, /run-release-qa-isolated\.sh/);
  const qaRunner = await readFile('scripts/ops/run-release-qa-isolated.sh', 'utf8');
  assert.match(qaRunner, /\/usr\/bin\/nice -n 10 npm run/);
  assert.doesNotMatch(qaRunner, /--property=Nice=/);
  assert.match(deploy, /PLATFORM_HARDENING_MIGRATION_VERIFIED/);
  assert.match(deploy, /PLATFORM_RUNTIME_READY/);
  assert.match(health, /'slo'/);
});

test('off-server backup reuses verified backup authority and verifies transport integrity', async () => {
  const exporter=await read('hub/bin/backup-export.php');
  const wrapper=await read('deploy/awh-backup/awh-backup-export');
  const pull=await read('deploy/offsite-backup/macos/awh-backup-pull.sh');
  const install=await read('deploy/offsite-backup/macos/install.sh');
  assert.match(exporter,/HubBackupService::latestMetadata/);
  assert.match(exporter,/HubBackupService::verify/);
  assert.match(exporter,/Requested backup is not the current verified snapshot/);
  assert.match(wrapper,/control-plane-current\/hub\/bin\/backup-export\.php/);
  assert.match(pull,/StrictHostKeyChecking=yes/);
  assert.match(pull,/shasum -a 256/);
  assert.match(pull,/AWH_OFFSITE_KEEP/);
  assert.match(pull,/\.pull\.lock/);
  assert.match(pull,/reason=already-running/);
  assert.match(pull,/shasum -a 256 "\$DEST\/\$file"/);
  assert.match(install,/com\.awh\.offsite-backup/);
  assert.match(install,/StartCalendarInterval/);
  assert.doesNotMatch(exporter+'\n'+pull,/password=|token=|private[_-]?key/i);
});
