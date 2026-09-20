import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadExecutionPolicy, qaScriptForBudget } from '../scripts/ops/execution-policy.mjs';

test('execution metadata is context-only rather than an AI behavior policy',async()=>{
  const context=await loadExecutionPolicy();
  assert.equal(context.schemaVersion,2);
  assert.equal(context.mode,'CONTEXT_ONLY');
  assert.equal(context.prescriptivePolicy,false);
  assert.equal(context.integrity.singleWriterPerMutationScope,true);
  assert.equal(context.integrity.readOnlyConcurrencyAllowed,true);
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
