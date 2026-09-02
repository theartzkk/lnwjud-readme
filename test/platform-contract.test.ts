import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { validateActionGraph, validateArtifactEdge, validateConnectorManifest, validateEvalResult, validateSkillManifest, validateTrustEvent } from '../src/platform-contract.js';
const a='11111111-1111-4111-8111-111111111111'; const b='22222222-2222-4222-8222-222222222222'; const p='33333333-3333-4333-8333-333333333333';

test('world-class platform contracts share one bounded Action Graph authority',()=>{
 const graph={schemaVersion:1 as const,graphId:a,projectId:p,goal:'สร้างรายงานและตรวจผล',nodes:[
  {nodeId:'plan',kind:'PLAN' as const,state:'READY' as const,capability:'reasoning',title:'วางแผน',costClass:'LOCAL_FREE' as const,undoPolicy:'NONE' as const,approvalRequired:false},
  {nodeId:'output',kind:'OUTPUT' as const,state:'PLANNED' as const,capability:'document:pdf',title:'สร้าง PDF',costClass:'DETERMINISTIC' as const,undoPolicy:'REVERSIBLE' as const,approvalRequired:false}],edges:[{from:'plan',to:'output'}]};
 assert.equal(validateActionGraph(graph),graph);
 assert.throws(()=>validateActionGraph({...graph,goal:'api_key=secret'}),/goal is invalid/);
 assert.throws(()=>validateActionGraph({...graph,edges:[{from:'output',to:'missing'}]}),/edge is invalid/);
 assert.throws(()=>validateActionGraph({...graph,edges:[{from:'plan',to:'output'},{from:'output',to:'plan'}]}),/acyclic/);
});

test('skills and connectors declare cost, approval and mutation boundaries',()=>{
 const skill={schemaVersion:1 as const,skillId:'document.pdf',displayName:'สร้าง PDF',capability:'document:pdf',costClass:'DETERMINISTIC' as const,approvalRequired:false,undoPolicy:'REVERSIBLE' as const,inputKinds:['document'],outputKinds:['pdf']};
 assert.equal(validateSkillManifest(skill),skill);
 const connector={schemaVersion:1 as const,connectorId:'bay.excuse',displayName:'BAY EXCUSE X',authority:'BOUNDED_WRITE' as const,operations:['READ','SEARCH','ACTION'] as const,approvalForActions:true};
 assert.deepEqual(validateConnectorManifest({...connector,operations:[...connector.operations]}),connector);
 assert.throws(()=>validateConnectorManifest({...connector,authority:'READ_ONLY',operations:['ACTION']}),/cannot mutate/);
});

test('artifact, trust and eval contracts make provenance, undo and release quality explicit',()=>{
 assert.equal(validateArtifactEdge({fromArtifactId:a,toArtifactId:b,relation:'DERIVED_FROM'}).relation,'DERIVED_FROM');
 assert.throws(()=>validateArtifactEdge({fromArtifactId:a,toArtifactId:a,relation:'USES'}),/relation is invalid/);
 assert.equal(validateTrustEvent({schemaVersion:1,eventId:a,projectId:p,action:'deploy',provider:null,mutation:true,approved:true}).approved,true);
 assert.throws(()=>validateTrustEvent({schemaVersion:1,eventId:a,projectId:p,action:'deploy',provider:null,mutation:true,approved:null}),/approval decision/);
 assert.equal(validateEvalResult({schemaVersion:1,evalId:'official.doc',capability:'document:official',score:98,releaseBlocking:true,evidenceRef:'fixture-2026'}).score,98);
 assert.throws(()=>validateEvalResult({schemaVersion:1,evalId:'official.doc',capability:'document:official',score:101,releaseBlocking:true,evidenceRef:null}),/score is invalid/);
});


test('current-state authority prevents historical checkpoints from masquerading as live truth',async()=>{
 const root=process.cwd();
 const current=await readFile(join(root,'CURRENT_STATE.md'),'utf8');
 assert.match(current,/current-state authority/i);
 assert.match(current,/fresh observed runtime\/source evidence outranks this snapshot/i);
 const agents=await readFile(join(root,'AGENTS.md'),'utf8');
 assert.ok(agents.indexOf('`CURRENT_STATE.md`')>=0 && agents.indexOf('`CURRENT_STATE.md`')<agents.indexOf('`PROJECT.md`'));
 for(const name of ['PROJECT.md','HANDOFF.md','TASKS.md','DECISIONS.md']){
  const memory=await readFile(join(root,name),'utf8');
  assert.match(memory.slice(0,500),/Current-state authority.*CURRENT_STATE\.md/s);
 }
});
