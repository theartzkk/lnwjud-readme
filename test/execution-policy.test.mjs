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
  assert.deepEqual(policy.remoteMission.progressHeartbeatMinutes,{min:5,max:7});
  assert.equal(policy.remoteMission.processPollSeconds.min,120);
  assert.equal(policy.remoteMission.processPollSeconds.max,300);
  assert.equal(policy.remoteMission.deviceLeaseMinutes>=policy.remoteMission.targetMinutes,true);
  assert.equal(policy.remoteMission.historyRetentionDays,30);
  assert.equal(policy.remoteMission.maxHistoryFiles,500);
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
    assert.match(source,/5.?7 minutes|5–7 minutes|5-7 minutes/i);
    assert.match(source,/quota.*(?:not|never).*(?:constraint|gate|limit)|quota.*telemetry/i);
  }
});
