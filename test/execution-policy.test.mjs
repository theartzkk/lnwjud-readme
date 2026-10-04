import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadExecutionPolicy, privilegeLane, qaScriptForBudget, releaseNodeCandidates } from '../scripts/ops/execution-policy.mjs';

test('durable scheduler skips blocked queue heads and health recovery wakes the same execution', (t) => {
  const probe=spawnSync('php',['--version'],{encoding:'utf8'});
  if(probe.error?.code==='ENOENT'){t.skip('PHP runtime unavailable');return;}
  assert.equal(probe.status,0,probe.stderr||'PHP runtime probe failed');
  const fixture=fileURLToPath(new URL('../hub/tests/m13-anywhere-execution.php',import.meta.url));
  const result=spawnSync('php',[fixture],{encoding:'utf8',timeout:60_000});
  assert.equal(result.status,0,[result.stdout,result.stderr].filter(Boolean).join('\n'));
  assert.match(result.stdout,/AWH M13 Anywhere Execution: PASS/);
});

test('operator diagnostics distinguish source authority from disk storage failures', async () => {
  const bridge=await readFile(new URL('../hub/src/HubOperatorBridgeService.php',import.meta.url),'utf8');
  assert.doesNotMatch(bridge,/OPERATOR_SOURCE_STORAGE_UNAVAILABLE/);
  assert.match(bridge,/OPERATOR_SOURCE_AUTHORITY_UNAVAILABLE/);
  assert.match(bridge,/OPERATOR_SOURCE_STAGING_UNAVAILABLE/);
  assert.match(bridge,/OPERATOR_SOURCE_RUNTIME_UNAVAILABLE/);
});

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
  assert.deepEqual(context.integrity.globalMutationResources,['CANONICAL:DEPLOY:VPS_PLATFORM']);
  assert.equal(context.integrity.releaseTrackAuthority,'HubUpdateTargetRegistry::releaseTracks');
  assert.equal(context.integrity.writerIdentity,'EXECUTION_ID+MUTATION_RESOURCE');
  assert.equal(context.integrity.projectScopedMutationIsolation,true);
  assert.equal(context.integrity.crossProjectMutationDefault,'DENY');
  assert.equal(context.integrity.crossProjectReadOnlyAllowed,true);
  assert.equal(context.integrity.sourcePromotionRequiresTargetProjectMission,true);
  assert.equal(context.integrity.projectScopeAuthority,'PROJECT_REGISTRY+MISSION_EXECUTION_PROJECT');
  assert.equal(context.integrity.completionAuthority,'HubCompletionAuthorityService');
  assert.equal(context.integrity.completionNotificationRequiresVerifiedTerminal,true);
  assert.equal(context.integrity.resumeAuthority,'EXECUTION_CHECKPOINT+HEARTBEAT');
  assert.equal(context.integrity.terminalStateEvidence,'TASK+EXECUTION+ENVELOPE+APPROVAL+CONTINUATION');
  assert.equal(context.integrity.hostGlobalTrack,'vps-platform');
  assert.equal(context.diagnosticAuthority.sandboxedConnectorFilesystemViewIsHostAuthority,false);
  assert.equal(context.diagnosticAuthority.hostFilesystemIncidentRequiresAuthorityCrossCheck,true);
  assert.equal(context.diagnosticAuthority.destructiveHostRepairFromConnectorOnlyEvidenceAllowed,false);
  assert.equal(context.diagnosticAuthority.classifyConnectorOnlyFilesystemObservationAs,'SANDBOX_VIEW');
  assert.ok(context.diagnosticAuthority.authoritativeHostSignals.includes('AWH_STORAGE_GUARD'));
  assert.ok(!context.integrity.sameProjectInterlocks.includes('CANONICAL:SOURCE<->CANONICAL:DEPLOY:*'));
  assert.ok(context.integrity.sameProjectInterlocks.includes('RESOURCE:RELEASE_STAGE<->CANONICAL:DEPLOY:*'));
  assert.equal(context.integrity.exactShaSourcePromotionDuringDeploy,true);
  assert.equal(context.runtimeDefaults.deviceLeaseMinutes,45);
  assert.equal(context.blockerHandling.mode,'OWNER_ASSIST_FAST_LANE');
  assert.equal(context.blockerHandling.maxSameFailureRetries,2);
  assert.equal(context.blockerHandling.silentWaitAllowed,false);
  assert.equal(context.blockerHandling.permanentFixRequiredForRecurringBlocker,true);
  assert.deepEqual(context.blockerHandling.closureEvidence,['rootCause','prevention','regression','recovery','observability']);
  assert.equal(context.workspaceRouting.durableCandidateRoot,'/var/lib/awh-remote/worktrees');
  assert.equal(context.workspaceRouting.unpromotedCandidateInEphemeralRootAllowed,false);
  assert.equal(context.storageSafety.targetFreeBytes,17179869184);
  assert.equal(context.storageSafety.selfHealBeforeBlock,true);
  assert.equal(context.storageSafety.projectAwareJanitor,true);
  assert.equal(context.storageSafety.pressureKeepNewestPerRepo,2);
  assert.equal(context.storageSafety.pressureMinAgeMinutes,60);
  for(const removed of ['remoteMission','executionModel','gateTiers','sourceAuthority']) assert.equal(Object.hasOwn(context,removed),false);
});

test('VPS direct connector exposes durable candidates but keeps canonical source read-only',async()=>{
  const context=await loadExecutionPolicy();
  const durable=context.workspaceRouting.durableCandidateRoot;
  const [install,verify,platformDeploy]=await Promise.all([
    readFile(new URL('../deploy/remote-worker/linux/install-vps-direct-connector.sh',import.meta.url),'utf8'),
    readFile(new URL('../deploy/remote-worker/linux/verify-vps-direct-connector.sh',import.meta.url),'utf8'),
    readFile(new URL('../deploy/awh-control-plane/remote-deploy-control-plane.sh',import.meta.url),'utf8'),
  ]);
  assert.equal(durable,'/var/lib/awh-remote/worktrees');
  assert.match(install,/allowedDirectories.*\/srv\/awh-git.*\/var\/lib\/awh-remote\/worktrees.*\/tmp/s);
  assert.match(install,/CANDIDATE_ROOT=\$AGENT_HOME\/worktrees/);
  assert.match(verify,/AWH_VPS_DIRECT_CANDIDATE_ROOT_NOT_WRITABLE/);
  assert.match(verify,/AWH_VPS_DIRECT_CANONICAL_SOURCE_WRITABLE/);
  assert.ok(install.includes(durable));
  assert.ok(verify.includes(durable));
  assert.match(platformDeploy,/stage VPS_DIRECT_CONNECTOR_PREPARE[\s\S]*AWH_VPS_DIRECT_REUSE_ONLY=1[\s\S]*install-vps-direct-connector\.sh" --activate[\s\S]*verify-vps-direct-connector\.sh"[\s\S]*stage VPS_DIRECT_CONNECTOR_READY/);
  const emptyArtifactGuard=platformDeploy.indexOf('Release contains empty systemd artifact');
  const releaseStaged=platformDeploy.indexOf('stage RELEASE_STAGED');
  assert.ok(emptyArtifactGuard>=0&&releaseStaged>emptyArtifactGuard,'empty systemd artifacts must fail before release staging');
  assert.ok(platformDeploy.includes('find "$RELEASE/deploy/systemd" -maxdepth 1 -type f -size 0 -print -quit'));
  assert.match(platformDeploy,/VPS_CONNECTOR_MUTATION_STARTED=1/);
  assert.match(platformDeploy,/VPS_CONNECTOR_UNIT_BACKUP/);
  assert.match(platformDeploy,/VPS_CONNECTOR_CONFIG_BACKUP/);
  assert.match(platformDeploy,/systemctl restart desktop-commander-vps\.service/);
  assert.match(platformDeploy,/CONNECTOR_VERIFY_ATTEMPTS=0/);
  assert.match(platformDeploy,/while test "\$CONNECTOR_VERIFY_ATTEMPTS" -lt 30/);
  assert.match(install,/CONNECTOR_SERVICE_ATTEMPTS=0/);
  assert.match(install,/while test "\$CONNECTOR_SERVICE_ATTEMPTS" -lt 30/);
  assert.match(platformDeploy,/vps-platform-release\.last/);
  assert.match(platformDeploy,/CONNECTOR_INSTALL_FAILED/);
  assert.match(platformDeploy,/CONNECTOR_VERIFY_FAILED/);
  assert.match(platformDeploy,/CONNECTOR_VERIFY_PASS/);
  assert.match(platformDeploy,/verify-vps-direct-connector\.sh" >"\$CONNECTOR_VERIFY_LOG" 2>&1/);
  assert.match(platformDeploy,/if test "\$CONNECTOR_VERIFY_READY" -ne 1/);
  assert.match(platformDeploy,/VPS_CONNECTOR_UNIT_BACKUP.*VPS_CONNECTOR_CONFIG_BACKUP/s);
  assert.match(install,/CONNECTOR_TMP=\$AGENT_HOME\/tmp/);
  assert.match(install,/install -d -m 2770 -o "\$AGENT_USER" -g awh-operator "\$CONNECTOR_TMP"/);
  assert.match(install,/setfacl -m u:awh-hub:--x,g:awh-operator:--x,m::--x "\$AGENT_HOME"/);
  assert.match(verify,/AWH_VPS_DIRECT_OPERATOR_STAGE_PARENT_TRAVERSE_MISSING/);
  assert.doesNotMatch(install,/install -d -m 0700[^\n]*"\$CONNECTOR_TMP"/);
  assert.match(install,/AWH_VPS_DIRECT_PACKAGE=REUSED/);
  assert.match(install,/AWH_VPS_DIRECT_PACKAGE_REUSE_REQUIRED/);
  assert.match(verify,/AWH_VPS_DIRECT_RUNTIME_TMPDIR_MISMATCH/);
  assert.match(verify,/\$AGENT_USER:awh-operator:2770/);
  assert.match(verify,/AWH_VPS_DIRECT_VERIFY_EVIDENCE/);
  assert.match(verify,/vps-direct-connector-verify\.last/);
  assert.match(verify,/record_verify AWH_VPS_DIRECT_VERIFY_PASS/);
  assert.match(verify,/AWH_VPS_DIRECT_CONFIG_POLICY_MISMATCH/);
});

test('durable deploy retry evidence is isolated per release execution',async()=>{
  const deploy=await readFile(new URL('../deploy/awh-control-plane/deploy-control-plane.sh',import.meta.url),'utf8');
  assert.match(deploy,/RELEASE_EXECUTION_ID=\$\{AWH_RELEASE_EXECUTION_ID:-\}/);
  assert.match(deploy,/RUN_ID="\$RELEASE_ID-exec\$RUN_SUFFIX"/);
  assert.match(deploy,/REMOTE_RESULT=\/tmp\/awh-control-plane-\$RUN_ID\.result/);
  assert.match(deploy,/REMOTE_LOG=\/tmp\/awh-control-plane-\$RUN_ID\.log/);
  assert.match(deploy,/REMOTE_STAGE=\/tmp\/awh-control-plane-\$RELEASE_ID\.tar\.gz/);
  assert.match(deploy,/config\/device-runtime-release\.json/);
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
  assert.match(script,/case "\$path" in -\*\) continue ;; esac/);
  assert.doesNotMatch(script,/\/etc\/passwd\+\|\/etc\/shadow\+\|\/etc\/group\+\|\/etc\/gshadow\+\|\/etc\/subuid\+\|\/etc\/subgid\+\) continue/);
  const unit=await readFile(new URL('../deploy/systemd/awh-hosting-operator.service',import.meta.url),'utf8');
  const identityUnit=await readFile(new URL('../deploy/systemd/awh-hosting-identity@.service',import.meta.url),'utf8');
  assert.match(unit,/ReadWritePaths=.*-\/var\/backups\/learnlab-releases/);
  assert.doesNotMatch(unit,/\/etc\/(?:\.pwd\.lock|passwd|shadow|group|gshadow|subuid|subgid)(?:[+\-])?/);
  assert.match(unit,/ReadOnlyPaths=-\/var\/lib\/awh-remote\/handoff/);
  assert.match(identityUnit,/ProtectSystem=full/);
  assert.match(identityUnit,/ExecStart=\+\/usr\/bin\/php .*awh-hosting-identity\.php %i/);
  assert.doesNotMatch(identityUnit,/BindPaths=\/etc:\/etc/);
  assert.doesNotMatch(identityUnit,/ReadWritePaths=\/etc/);
  assert.match(identityUnit,/PrivateNetwork=true/);
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
  assert.match(authority,/VPS Platform.*host-global|host-global.*VPS Platform/s);
  assert.match(authority,/CANONICAL:SOURCE.*CANONICAL:DEPLOY/s);
  assert.match(authority,/remote-mission-state.*transport\/device leases only/s);
  assert.match(sustainability,/second chat\/worker resumes, joins or waits/i);
  assert.match(operations,/Project Mission is coordination only and never blocks by itself/i);
  assert.match(operations,/VPS Platform.*host-global|host-global.*VPS Platform/i);
  assert.match(release,/QA or candidate readiness is not Production completion/i);
});


test('LearnLab FILE_ONLY release keeps QA metadata source-only without widening runtime deploy scope',async()=>{
  const source=await readFile(new URL('../deploy/learnlab/awh-learnlab-release-engine.py',import.meta.url),'utf8');
  assert.match(source,/DEPLOY_ALLOWED=\("learnlab\/prototype\/","learnlab\/shared\/","learnlab\/teacher\/","learnlab\/server\/"\)/);
  assert.match(source,/SOURCE_ONLY_PREFIXES=\("learnlab\/tests\/",\)/);
  for(const path of [
    '.github/workflows/learnlab-ci.yml',
    '.github/workflows/learnlab-product-ci.yml',
    'learnlab/VERSION',
    'ops/learnlab-runtime/experience-pilot.example.json',
  ]) assert.ok(source.includes(JSON.stringify(path)),'source-only allowlist must include '+path);
  assert.match(source,/if path in DENIED: fail\("LEARNLAB_RELEASE_DIFF_OUT_OF_SCOPE",path\)/);
  assert.match(source,/if path\.startswith\(DEPLOY_ALLOWED\):\s+deploy_rows\.append\(\(status,path\)\)/s);
  assert.match(source,/elif path\.startswith\(SOURCE_ONLY_PREFIXES\) or path in SOURCE_ONLY_FILES:\s+source_only_rows\.append\(\(status,path\)\)/s);
  assert.match(source,/else:\s+fail\("LEARNLAB_RELEASE_DIFF_OUT_OF_SCOPE",path\)/s);
  assert.match(source,/if not deploy_rows: fail\("LEARNLAB_RELEASE_EMPTY","no deployable changes"\)/);
  assert.match(source,/"sourceOnlyDiff":\[\{"status":s,"path":p\} for s,p in source_only_rows\]/);
  assert.doesNotMatch(source,/not path\.startswith\(ALLOWED\)/);
  assert.match(source,/def wait_student_entrypoint\(url,attempts=12,delay=\.5\):/);
  assert.match(source,/for attempt in range\(attempts\):/);
  assert.match(source,/if status==200 and final==url: return/);
  assert.match(source,/if attempt\+1<attempts: time\.sleep\(delay\)/);
  assert.match(source,/wait_student_entrypoint\(url\)/);
});
