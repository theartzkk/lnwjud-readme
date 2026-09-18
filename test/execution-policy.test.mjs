import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadExecutionPolicy, qaScriptForBudget } from '../scripts/ops/execution-policy.mjs';

test('execution policy makes Remote long-running, resume-first and quota-unbounded',async()=>{
  const policy=await loadExecutionPolicy();
  assert.equal(policy.remoteMission.targetMinutes,30);
  assert.equal(policy.remoteMission.allowLonger,true);
  assert.equal(policy.remoteMission.quotaIsTelemetryOnly,true);
  assert.equal(policy.remoteMission.resumeFirst,true);
  assert.deepEqual(policy.remoteMission.progressHeartbeatMinutes,{min:3,max:5});
  assert.equal(policy.remoteMission.processPollSeconds.min,120);
  assert.equal(policy.remoteMission.processPollSeconds.max,300);
  assert.equal(policy.remoteMission.deviceLeaseMinutes>=policy.remoteMission.targetMinutes,true);
  assert.equal(policy.remoteMission.historyRetentionDays,30);
  assert.equal(policy.remoteMission.maxHistoryFiles,500);
  assert.equal(policy.remoteMission.subprocessCompletionEndsMission,false);
  assert.equal(policy.remoteMission.heartbeatRequiresProofOfWork,true);
  assert.equal(policy.remoteMission.autoChainSafeNextStep,true);
  assert.equal(policy.remoteMission.durableProcessThresholdSeconds,120);
  assert.match(policy.remoteMission.finalWhileActiveMission,/FORBIDDEN/);
  assert.equal(policy.remoteMission.heartbeatDetailLevel,'DETAILED');
  assert.equal(policy.remoteMission.heartbeatMustContinueAfterSend,true);
  assert.equal(policy.remoteMission.assistantVisibleHeartbeatRequired,true);
  assert.equal(policy.remoteMission.internalStatusUiCountsAsHeartbeat,false);
  assert.equal(policy.remoteMission.heartbeatMayBeReplacedBySpinner,false);
  assert.equal(policy.remoteMission.fastPath.firstProductiveActionTargetSeconds,60);
  assert.equal(policy.remoteMission.fastPath.maxPreflightProbes,2);
  assert.equal(policy.remoteMission.errorRecovery.sameActionBlindRetryMax,0);
  assert.equal(policy.remoteMission.errorRecovery.maxApplicationRestartAttemptsPerMission,1);
  assert.equal(policy.remoteMission.creativeApplicationSafety.routineForceQuitForbidden,true);
  assert.equal(policy.remoteMission.creativeApplicationSafety.confirmedHangSignalsRequired,2);
  assert.equal(policy.remoteMission.creativeApplicationSafety.confirmedHangMinSeconds,30);
  assert.equal(policy.remoteMission.creativeApplicationSafety.directScriptLaunchWhileGuiInstanceActiveForbidden,true);
  assert.equal(policy.remoteMission.heartbeatDetailLevel,'DETAILED');
  assert.equal(policy.remoteMission.heartbeatMustContinueAfterSend,true);
  assert.equal(policy.remoteMission.heartbeatProgressMode,'STAGE_BASED_NO_FALSE_PERCENT');
  assert.equal(policy.remoteMission.heartbeatProofMaxAgeSeconds,300);
  assert.deepEqual(policy.remoteMission.heartbeatRequiredFields,['elapsed','doneSinceLast','currentOperation','stage','proofOfWork','activePidOrApp','lastSaveOrArtifact','nextSteps','blocker']);
});

test('fast path and creative crash guards are machine-enforced',async()=>{
  const policy=await loadExecutionPolicy();
  assert.equal(policy.remoteMission.fastPath.firstProductiveActionTargetSeconds,60);
  assert.equal(policy.remoteMission.fastPath.maxPreflightProbes,2);
  assert.equal(policy.remoteMission.errorRecovery.sameActionBlindRetryMax,0);
  assert.equal(policy.remoteMission.errorRecovery.transportTimeoutResumeFirst,true);
  assert.equal(policy.remoteMission.creativeApplicationSafety.routineForceQuitForbidden,true);
  assert.equal(policy.remoteMission.creativeApplicationSafety.confirmedHangMinSeconds,30);
  assert.equal(policy.remoteMission.creativeApplicationSafety.confirmedHangSignalsRequired,2);
  assert.equal(policy.remoteMission.creativeApplicationSafety.checkpointBeforeTermination,true);
});

test('gate and QA policy encode the simplified G0-G3 model',async()=>{
  const policy=await loadExecutionPolicy();
  assert.equal(policy.gateTiers.G0.ownerApproval,false);
  assert.equal(policy.gateTiers.G1.ownerApproval,false);
  assert.equal(policy.gateTiers.G2.ownerApproval,'ONE_EXACT_REVISION_SCOPE');
  assert.equal(policy.gateTiers.G3.ownerApproval,'ACTION_SPECIFIC');
  assert.equal(qaScriptForBudget(policy,'FAST'),'qa:fast');
  assert.equal(qaScriptForBudget(policy,'STANDARD'),'qa:fast');
  assert.equal(qaScriptForBudget(policy,'DEEP'),'qa:local');
});

test('human protocols stay aligned with machine-readable Remote policy',async()=>{
  const docs=await Promise.all(['ART_AI_WORKING_PROTOCOL.md','AGENTS.md','docs/BLOCK_FREE_OPERATIONS.md'].map(f=>readFile(new URL('../'+f,import.meta.url),'utf8')));
  for(const source of docs){
    assert.match(source,/30.?minute|30 minutes/i);
    assert.match(source,/3.?5 minutes|3–5 minutes|3-5 minutes/i);
    assert.match(source,/quota.*(?:not|never).*(?:constraint|gate|limit)|quota.*telemetry/i);
  }
});
