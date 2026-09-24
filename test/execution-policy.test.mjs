import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadExecutionPolicy, privilegeLane, qaScriptForBudget, releaseNodeCandidates } from '../scripts/ops/execution-policy.mjs';

test('execution metadata is context-only rather than an AI behavior policy',async()=>{
  const context=await loadExecutionPolicy();
  assert.equal(context.schemaVersion,2);
  assert.equal(context.mode,'CONTEXT_ONLY');
  assert.equal(context.prescriptivePolicy,false);
  assert.equal(context.integrity.singleWriterPerMutationScope,true);
  assert.equal(context.integrity.readOnlyConcurrencyAllowed,true);
  assert.equal(context.integrity.mutationAuthority,'control_execution_envelopes');
  assert.equal(context.integrity.secondWriterBehavior,'WAIT_OR_JOIN');
  assert.equal(context.integrity.parallelLockAuthorityAllowed,false);
  assert.equal(context.integrity.localMissionAuthorityClass,'DEVICE_TRANSPORT_LEASE');
  assert.ok(context.integrity.globalMutationResources.includes('CANONICAL:DEPLOY'));
  assert.ok(context.integrity.sameProjectInterlocks.includes('CANONICAL:SOURCE<->CANONICAL:DEPLOY'));
  assert.ok(context.integrity.sameProjectInterlocks.includes('RESOURCE:RELEASE_STAGE<->CANONICAL:DEPLOY'));
  assert.equal(context.runtimeDefaults.deviceLeaseMinutes,45);
  for(const removed of ['remoteMission','executionModel','gateTiers','sourceAuthority']) assert.equal(Object.hasOwn(context,removed),false);
});

test('QA mapping remains a technical runtime capability',async()=>{
  const context=await loadExecutionPolicy();
  assert.equal(qaScriptForBudget(context,'FAST'),'qa:fast');
  assert.equal(qaScriptForBudget(context,'STANDARD'),'qa:fast');
  assert.equal(qaScriptForBudget(context,'DEEP'),'qa:local');
});

test('human entry context is non-binding and capability-aware',async()=>{
  const [intent,agents]=await Promise.all(['ART_AI_WORKING_PROTOCOL.md','AGENTS.md'].map(f=>readFile(new URL('../'+f,import.meta.url),'utf8')));
  for(const source of [intent,agents]){
    assert.match(source,/context/i);
    assert.match(source,/professional|capabilit/i);
    assert.doesNotMatch(source,/Execution First — mandatory|OWNER OPERATING MODEL.*MANDATORY/i);
  }
  assert.match(intent,/Mode: context-only/i);
});

test('central privilege routing fails fast on restricted sessions and never falls back to user console',async()=>{
  const context=await loadExecutionPolicy();
  assert.equal(context.privilegeRouting.preflightRequired,true);
  assert.equal(context.privilegeRouting.defaultPrivilegedLane,'TYPED_OPERATOR');
  assert.equal(context.privilegeRouting.directSudoFromRestrictedSessionAllowed,false);
  assert.equal(context.privilegeRouting.userConsoleFallbackAllowed,false);
  assert.deepEqual(privilegeLane(context,{uid:1000,identity:'awh-remote',noNewPrivileges:true,explicitLane:''}),{lane:'RESTRICTED_SESSION',allowed:false,reason:'NO_NEW_PRIVILEGES'});
  assert.equal(privilegeLane(context,{uid:0,identity:'root',noNewPrivileges:true,explicitLane:'TYPED_OPERATOR'}).allowed,true);
});

test('central toolchain routing preserves bounded Node and exact dependency hydration',async()=>{
  const context=await loadExecutionPolicy();
  assert.equal(context.toolchainRouting.preserveVerifiedRuntimeAcrossPrivilegeBoundary,true);
  assert.equal(context.toolchainRouting.dependencyHydration.strategy,'NPM_CI_PREFER_OFFLINE');
  assert.ok(releaseNodeCandidates(context).includes('/opt/awh-toolchain/node/bin/node'));
});

test('managed-product deploy provisions namespace roots before operator enable',async()=>{
  const script=await readFile(new URL('../deploy/awh-control-plane/remote-deploy-control-plane.sh',import.meta.url),'utf8');
  assert.match(script,/install -d -o root -g root -m 0750 \/var\/backups\/learnlab-releases \/var\/backups\/bay-assessment/);
  assert.match(script,/HOSTING_NAMESPACE_PATHS=\$\(sed -n 's\/\^ReadWritePaths=\/\/p'/);
  assert.match(script,/HOSTING_NAMESPACE_PATH_MISSING=\$path/);
  assert.match(script,/case "\$path" in -\*\) continue/);
  const unit=await readFile(new URL('../deploy/systemd/awh-hosting-operator.service',import.meta.url),'utf8');
  assert.match(unit,/ReadWritePaths=.*-\/var\/backups\/learnlab-releases/);
  assert.match(unit,/ReadWritePaths=.*\/etc\/subuid .*\/etc\/subgid/);
  assert.match(unit,/ReadOnlyPaths=-\/var\/lib\/awh-remote\/handoff/);
  const provision=script.indexOf('PRODUCT_RELEASE_STORAGE_READY');
  const preflight=script.indexOf('HOSTING_NAMESPACE_PATHS_READY');
  const enable=script.indexOf('systemctl enable --now awh-hosting-operator.timer',preflight);
  assert.ok(provision>0&&preflight>provision&&enable>preflight);
});

test('document governance has one entry point and no parallel rules authority',async()=>{
  const root=(name)=>new URL('../'+name,import.meta.url);
  const [agents,state,handoff,authority,sustainability,operations,release]=await Promise.all([
    'AGENTS.md','CURRENT_STATE.md','HANDOFF.md','docs/AWH-AUTHORITY-MAP.md',
    'docs/AWH_SUSTAINABILITY_CONTRACT.md','docs/OPERATIONS.md','docs/RELEASE.md'
  ].map((name)=>readFile(root(name),'utf8')));
  await assert.rejects(()=>readFile(root('RULES.md'),'utf8'));
  assert.match(agents,/single human-readable entry point/i);
  assert.match(agents,/no parallel `RULES\.md` authority/i);
  assert.match(agents,/JOIN\/WAIT/i);
  assert.match(state,/not live authority/i);
  assert.match(handoff,/continuity context, not runtime authority/i);
  assert.match(authority,/Normative architecture contract/i);
  assert.match(authority,/CANONICAL:DEPLOY.*VPS-global/s);
  assert.match(authority,/CANONICAL:SOURCE.*CANONICAL:DEPLOY/s);
  assert.match(authority,/remote-mission-state.*transport\/device leases only/s);
  assert.match(sustainability,/second chat\/worker resumes, joins or waits/i);
  assert.match(operations,/shared Production deploys serialize across managed projects/i);
  assert.match(release,/QA or candidate readiness is not Production completion/i);
});
