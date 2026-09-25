import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { capabilityPlanInstruction } from '../src/control-plane-worker-runtime.js';
import type { WorkerCapabilityPlan } from '../src/control-plane-worker-client.js';

const ROOT = process.cwd();

test('AWH auto capability router selects bounded advisory capabilities and Hallmark review gate', () => {
  const php = String.raw`
require 'hub/src/HubControlPlaneService.php';
$route=new ReflectionMethod(HubControlPlaneService::class,'externalCapabilityPlan'); $route->setAccessible(true);
$qa=new ReflectionMethod(HubControlPlaneService::class,'centralCandidateQa'); $qa->setAccessible(true);
echo json_encode([
 'large'=>$route->invoke(null,'วิเคราะห์ log ทั้งระบบและปิดงาน final deploy',false),
 'design'=>$route->invoke(null,'ปรับ UI mobile ให้สวยและ responsive',false),
 'plain'=>$route->invoke(null,'อธิบายแนวคิดนี้',false),
 'attachment'=>$route->invoke(null,'ดูไฟล์นี้',true),
 'visualQa'=>$qa->invoke(null,['added'=>[],'changed'=>['web/app.js'],'deleted'=>[]]),
 'serverQa'=>$qa->invoke(null,['added'=>[],'changed'=>['src/server.ts'],'deleted'=>[]]),
 'dataQa'=>$qa->invoke(null,['added'=>[],'changed'=>['config/data.json'],'deleted'=>[]])
], JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE);
`;
  const result=JSON.parse(execFileSync('php',['-r',php],{cwd:ROOT,encoding:'utf8'}));
  assert.deepEqual(result.large.selected.map((item:any)=>item.id),['context.optimize','team.harness']);
  assert.deepEqual(result.design.selected.map((item:any)=>item.id),['design.hallmark','design.reference']);
  assert.deepEqual(result.plain.selected,[]);
  assert.deepEqual(result.attachment.selected.map((item:any)=>item.id),['context.optimize']);
  assert.equal(result.visualQa.status,'REVIEW_REQUIRED');
  assert.equal(result.visualQa.visualReview.policy,'KRUART_GOLDEN_UI_HALLMARK');
  assert.equal(result.serverQa.status,'PASS');
  assert.equal(result.dataQa.status,'PASS');
});

test('worker advisory prompt never turns an external capability into execution authority', () => {
  const plan:WorkerCapabilityPlan={schemaVersion:1,router:'awh.external-capabilities.v1',selected:[
    {id:'context.optimize',label:'Context Optimizer',mode:'OPTIONAL_LOCAL_ADAPTER',reason:'large output',requiredTool:'tool.context-mode'},
    {id:'team.harness',label:'Team Review',mode:'OPTIONAL_LOCAL_ADAPTER',reason:'multi-perspective review',requiredTool:'tool.teamai'}
  ]};
  const text=capabilityPlanInstruction(plan,['tool.context-mode']);
  assert.match(text,/Context Optimizer.*LOCAL_RUNTIME_DETECTED/s);
  assert.match(text,/Team Review.*NATIVE_FALLBACK/s);
  assert.match(text,/ADVISORY, NOT AUTHORITY/);
  assert.match(text,/Do not create another queue, login, memory, database, approval system or control plane/);
});

test('Work and Night Shift expose capability routing without a parallel control surface', async () => {
  const [app,dashboard,styles,service]=await Promise.all(['web/app.js','web/dashboard.js','web/styles.css','hub/src/HubControlPlaneService.php'].map((f)=>readFile(join(ROOT,f),'utf8')));
  assert.match(app,/AWH กำลังใช้ .*เครื่องมือ/);
  assert.match(app,/capability-plan/);
  assert.match(styles,/\.capability-chip/);
  assert.match(dashboard,/routedCapabilities/);
  assert.match(dashboard,/Auto capability routing พร้อม/);
  assert.match(service,/evidenceSchemaVersion' => 3/);
  assert.match(service,/KRUART_GOLDEN_UI_HALLMARK/);
  assert.doesNotMatch(service,/INSERT INTO .*external_capabil/i);
});

test('external capability registry remains the extension point instead of hard-coded worker adapters', async () => {
  const [discovery, registry] = await Promise.all([
    readFile(join(ROOT,'src/worker-capability-discovery.ts'),'utf8'),
    readFile(join(ROOT,'src/external-capability-registry.ts'),'utf8'),
  ]);
  assert.match(discovery,/externalRegistry/);
  assert.match(discovery,/OPTIONAL_LOCAL_ADAPTER/);
  assert.doesNotMatch(discovery,/addCommand\('teamai'|addCommand\('context-mode'/);
  assert.match(registry,/entries\.length>64/);
  assert.match(registry,/loadBundledExternalCapabilityRegistry/);
});
