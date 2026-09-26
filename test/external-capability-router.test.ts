import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { capabilityPlanInstruction } from '../src/control-plane-worker-runtime.js';
import type { WorkerCapabilityPlan } from '../src/control-plane-worker-client.js';

const ROOT = process.cwd();

test('AWH auto capability router selects approved Anti Slop profiles without replacing existing critics', () => {
  const php = String.raw`
require 'hub/src/HubControlPlaneService.php';
$route=new ReflectionMethod(HubControlPlaneService::class,'externalCapabilityPlan'); $route->setAccessible(true);
$qa=new ReflectionMethod(HubControlPlaneService::class,'centralCandidateQa'); $qa->setAccessible(true);
echo json_encode([
 'large'=>$route->invoke(null,'วิเคราะห์ log ทั้งระบบและปิดงาน final deploy',false),
 'design'=>$route->invoke(null,'ปรับ UI mobile ให้สวยและ responsive',false),
 'copy'=>$route->invoke(null,'ปรับข้อความหน้าเว็บและ microcopy ให้เป็นธรรมชาติ',false),
 'comments'=>$route->invoke(null,'clean up code comments และ jsdoc',false),
 'plain'=>$route->invoke(null,'อธิบายแนวคิดนี้',false),
 'attachment'=>$route->invoke(null,'ดูไฟล์นี้',true),
 'visualQa'=>$qa->invoke(null,['added'=>[],'changed'=>['web/app.js'],'deleted'=>[]]),
 'serverQa'=>$qa->invoke(null,['added'=>[],'changed'=>['src/server.ts'],'deleted'=>[]]),
 'dataQa'=>$qa->invoke(null,['added'=>[],'changed'=>['config/data.json'],'deleted'=>[]])
], JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE);
`;
  const result=JSON.parse(execFileSync('php',['-r',php],{cwd:ROOT,encoding:'utf8'}));
  assert.deepEqual(result.large.selected.map((item:any)=>item.id),['context.optimize','team.harness']);
  assert.deepEqual(result.design.selected.map((item:any)=>item.id),['design.antislop','design.hallmark','design.reference']);
  assert.deepEqual(result.copy.selected.map((item:any)=>item.id),['copy.antislop']);
  assert.deepEqual(result.comments.selected.map((item:any)=>item.id),['code.antislop']);
  assert.deepEqual(result.plain.selected,[]);
  assert.deepEqual(result.attachment.selected.map((item:any)=>item.id),['context.optimize']);
  assert.equal(result.visualQa.status,'REVIEW_REQUIRED');
  assert.deepEqual(result.visualQa.visualReview.filters,['design.antislop','design.hallmark']);
  assert.equal(result.serverQa.status,'PASS');
  assert.equal(result.dataQa.status,'PASS');
});

test('worker advisory prompt treats approved skills as bounded filters and never execution authority', () => {
  const plan:WorkerCapabilityPlan={schemaVersion:1,router:'awh.external-capabilities.v1',selected:[
    {id:'design.antislop',label:'Anti Slop Guard',mode:'APPROVED_SKILL_PACK',reason:'filter generic UI',requiredTool:null},
    {id:'context.optimize',label:'Context Optimizer',mode:'OPTIONAL_LOCAL_ADAPTER',reason:'large output',requiredTool:'tool.context-mode'},
    {id:'team.harness',label:'Team Review',mode:'OPTIONAL_LOCAL_ADAPTER',reason:'multi-perspective review',requiredTool:'tool.teamai'}
  ]};
  const text=capabilityPlanInstruction(plan,['tool.context-mode'],['antislop','antislop-ui']);
  assert.match(text,/Anti Slop Guard.*APPROVED_SKILL_LOADED/s);
  assert.match(text,/filter, not a style authority/i);
  assert.match(text,/Do not run its installer\/wizard/i);
  assert.match(text,/Context Optimizer.*LOCAL_RUNTIME_DETECTED/s);
  assert.match(text,/Team Review.*NATIVE_FALLBACK/s);
  assert.match(text,/ADVISORY, NOT AUTHORITY/);
  assert.match(text,/Do not create another queue, login, memory, database, approval system or control plane/);
});

test('Work and Night Shift expose capability routing without a parallel control surface', async () => {
  const [app,dashboard,styles,service]=await Promise.all(['web/app.js','web/dashboard.js','web/styles.css','hub/src/HubControlPlaneService.php'].map((file)=>readFile(join(ROOT,file),'utf8')));
  assert.match(app,/AWH กำลังใช้ .*เครื่องมือ/);
  assert.match(app,/capability-plan/);
  assert.match(styles,/\.capability-chip/);
  assert.match(dashboard,/routedCapabilities/);
  assert.match(dashboard,/Auto capability routing พร้อม/);
  assert.match(service,/evidenceSchemaVersion' => 2/);
  assert.match(service,/KRUART_GOLDEN_UI_HALLMARK/);
  assert.doesNotMatch(service,/INSERT INTO .*external_capabil/i);
});
