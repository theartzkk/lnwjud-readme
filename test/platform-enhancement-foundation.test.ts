import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadExternalCapabilityRegistry } from '../src/external-capability-registry.js';

const readJson=async(path:string)=>JSON.parse(await readFile(path,'utf8'));

test('enhancement candidates stay opt-in and non-authoritative',async()=>{
 const registry=await loadExternalCapabilityRegistry('config/external-capabilities.json');
 const candidates=registry.entries.filter((entry)=>entry.integrationMode==='EVALUATION_CANDIDATE');
 assert.deepEqual(candidates.map((entry)=>entry.id).sort(),['cloudflare-forge','nvidia-openshell','opendecider']);
 for(const entry of candidates){
  assert.equal(entry.enabledByDefault,false);
  assert.equal(entry.hostedServiceAllowed,false);
  assert.equal(entry.authorityBoundary,'AWH_EXISTING_CONTROL_PLANE');
  assert.equal(entry.command,null);
  assert.equal(entry.workerTool,null);
 }
});

test('evaluation policy preserves existing AWH baselines and rollback',async()=>{
 const policy=await readJson('config/platform-enhancement-evaluation.json');
 assert.equal(policy.authority,'AWH_EXISTING_CONTROL_PLANE');
 assert.ok(policy.promotionGates.includes('baseline-comparison'));
 assert.ok(policy.promotionGates.includes('deterministic-native-fallback'));
 assert.ok(policy.promotionGates.includes('owner-approval-before-production'));
 for(const candidate of policy.candidates) assert.equal(candidate.productionEnabled,false);
 assert.equal(policy.candidates.find((item:any)=>item.id==='opendecider').baseline,'Jev advisory');
});

test('design convergence requires interaction and exact-revision evidence',async()=>{
 const rubric=await readJson('design/qa/convergence-rubric.json');
 assert.equal(rubric.releaseRule.sourceInspectionAloneCanPass,false);
 assert.equal(rubric.releaseRule.exactRevisionBrowserEvidenceRequired,true);
 assert.ok(rubric.dimensions.find((item:any)=>item.id==='interaction').evidence.includes('busy-visible'));
 assert.ok(rubric.dimensions.find((item:any)=>item.id==='mobile').evidence.includes('keyboard-safe'));
});
