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

test('ecosystem release contract covers product families and independent release tracks', async () => {
  const c = await json('config/ecosystem-release-contract.json');
  const policy = await json('config/ecosystem-platform-policy.json');
  const registry = await read('hub/src/HubUpdateTargetRegistry.php');
  const reposStart=registry.indexOf('public static function repositories');
  const tracksStart=registry.indexOf('public static function releaseTracks');
  assert.ok(reposStart>=0&&tracksStart>reposStart);
  const repositoryBlock=registry.slice(reposStart,tracksStart);
  const registryKeys=[...repositoryBlock.matchAll(/^\s*'([^']+)'=>\[/gm)].map((match)=>match[1]);
  assert.deepEqual(Object.keys(c.products).sort(), registryKeys.sort());
  for (const [key, row] of Object.entries(c.products as Record<string,{project:string}>)) {
    assert.equal(repositoryBlock.includes("'" + key + "'"), true);
    assert.ok(row.project.length > 0);
  }

  const expectedTracks=['awh','awh-agent','awh-line-gateway','bay-assessment','bay-computer-lab','bay-cooperative','bay-excuse-x','bay-hub','bay-learnlab','bay-pp','line-oa','school-website','vps-platform'];
  assert.deepEqual(Object.keys(c.releaseTracks).sort(), expectedTracks);
  assert.deepEqual([...policy.releaseTracks.tracks].sort(), expectedTracks);
  for(const key of expectedTracks){
    const track=c.releaseTracks[key];
    assert.equal(track.independentVersion,true);
    assert.equal(track.independentHistory,true);
    assert.equal(track.independentRollback,true);
    assert.equal(track.ownerApprovalRequired,true);
    assert.ok(typeof track.deploymentAdapter==='string'&&track.deploymentAdapter.length>0);
    assert.ok(typeof track.dataOwner==='string'&&track.dataOwner.length>0);
    assert.ok(typeof track.permissionScope==='string'&&track.permissionScope.length>0);
    assert.ok(typeof track.observabilityScope==='string'&&track.observabilityScope.length>0);
    assert.ok(['PRIMARY','ADVANCED'].includes(track.visibility));
  }
  assert.equal(c.releaseTracks['bay-hub'].visibility,'ADVANCED');
  for(const key of expectedTracks.filter((key)=>key!=='bay-hub')) assert.equal(c.releaseTracks[key].visibility,'PRIMARY');
  assert.notEqual(c.releaseTracks['vps-platform'].productionRef,c.releaseTracks.awh.productionRef);
  assert.equal(c.releaseTracks['awh-line-gateway'].sourceAuthority,'AWH_VAULT');
  assert.equal(c.releaseTracks['awh-line-gateway'].repository,null);
  assert.equal(c.releaseTracks['awh-line-gateway'].domain,'line.kruart.online');
  assert.equal(c.releaseTracks['awh-line-gateway'].healthPath,'/healthz');
  assert.equal(c.releaseTracks['awh-line-gateway'].webhookPath,'/webhook');
  assert.equal(c.releaseTracks['awh-line-gateway'].deploymentAdapter,'MANAGED_HOSTING');
  assert.equal(c.releaseTracks['line-oa'].repository,'bay-excuse-x');
  assert.equal(c.releaseTracks['line-oa'].packageTrack,'line-oa');
  assert.equal(c.releaseTracks['line-oa'].deploymentAdapter,'BAY_UPDATE_CENTER');
  assert.notEqual(c.releaseTracks['awh-line-gateway'].dataOwner,c.releaseTracks['line-oa'].dataOwner);
  assert.notEqual(c.releaseTracks['awh-line-gateway'].permissionScope,c.releaseTracks['line-oa'].permissionScope);
  assert.notEqual(c.releaseTracks['awh-line-gateway'].observabilityScope,c.releaseTracks['line-oa'].observabilityScope);
  assert.notEqual(c.releaseTracks['awh-line-gateway'].secretScope,c.releaseTracks['line-oa'].secretScope);
  assert.equal(c.releaseTracks['bay-cooperative'].packageTrack,'cooperative-center');
  assert.equal(c.releaseTracks['bay-pp'].packageTrack,'pp-center');
  assert.equal(c.releaseTracks['vps-platform'].visibility,'PRIMARY');
  assert.equal(c.releaseTracks['bay-cooperative'].visibility,'PRIMARY');
  assert.equal(c.releaseTracks['bay-pp'].visibility,'PRIMARY');
  assert.equal(c.rules.crossProjectWriteForbidden,true);
  assert.equal(c.rules.dependencyByContractOnly,true);
  assert.equal(c.rules.registryDrivenUpdateCenter,true);
  assert.equal(c.rules.updateCenterLayoutMutationForNewTrackForbidden,true);
  assert.deepEqual(c.requiredArtifactIdentity, ['product','version','sourceSha','artifactSha256','schemaVersion','builtAt']);
  assert.equal(c.rules.productionRebuildForbidden, true);
  assert.equal(c.rules.rollbackArtifactRequired, true);
  assert.equal(c.rules.releaseTrackIdentityRequired, true);
  assert.equal(c.rules.groupOrchestrationPreservesIndependentTargets,true);
  assert.equal(c.rules.implicitCrossTrackReleaseForbidden,true);
  assert.deepEqual(c.releaseGroups['line-oa'].targets,[
    {itemKey:'awh-line-gateway',releaseTrack:'awh-line-gateway'},
    {itemKey:'bay-excuse-line-oa',releaseTrack:'line-oa'},
  ]);
  assert.equal(c.releaseGroups['line-oa'].approvalMode,'SIGNED_IN_OWNER');
  assert.equal(c.releaseGroups['line-oa'].orchestration,'SEQUENTIAL_VERIFY_EACH');
  assert.equal(c.releaseGroups['line-oa'].historyScope,'PER_TARGET');
  assert.equal(c.releaseGroups['line-oa'].rollbackScope,'PER_TARGET');
  assert.deepEqual(c.releaseGroups['line-oa'].forbiddenImplicitTargets,['awh','vps-platform','bay-excuse-x']);
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
  const deployOrchestrator = await read('deploy/awh-control-plane/deploy-control-plane.sh');
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
  assert.match(deployOrchestrator, /EXTENSION_MODE_COUNT=\$\(\(AWH_CORE \+ ASSISTANT_WORKSTREAM/);
  assert.match(deployOrchestrator, /if test "\$EXTENSION_MODE_COUNT" -eq 0; then OWNER_LOGIN_PROOF_REQUIRED=1; fi/);
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

test('AWH Core M24 deploy migrates once and keeps schema 24 deployable', async () => {
  const deploy = await read('deploy/awh-control-plane/deploy-control-plane.sh');
  const remote = await read('deploy/awh-control-plane/remote-deploy-control-plane.sh');
  const validator = await read('deploy/awh-control-plane/validate-remote-output.sh');
  assert.match(deploy, /HubConversationDelegateMigration\.php/);
  assert.match(deploy, /AWH_CORE_DRY_RUN=PASS/);
  assert.match(deploy, /migrate-023-if-needed/);
  assert.match(remote, /23\|24/);
  assert.match(remote, /AWH_CORE_MIGRATION_FIRST/);
  assert.match(remote, /AWH_CORE_MIGRATION_IDEMPOTENT/);
  assert.match(remote, /m24-conversation-delegates/);
  assert.match(remote, /PLATFORM_START_VERSION.*22\|23\|24/);
  assert.match(remote, /PLATFORM_EXPECTED_VERSION=24/);
  assert.match(validator, /AWH_CORE_MIGRATION_VERIFIED/);
});
