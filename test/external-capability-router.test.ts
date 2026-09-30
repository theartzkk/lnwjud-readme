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
 'semantic'=>$route->invoke(null,'refactor symbol นี้และหา references ให้ครบ',false),
 'docs'=>$route->invoke(null,'เช็ค current API documentation ของ library รุ่นล่าสุด',false),
 'repo'=>$route->invoke(null,'ดู GitHub PR issues และ Actions ของ repo นี้',false),
 'crawl'=>$route->invoke(null,'crawl เว็บไซต์หลายหน้าแล้ว extract ข้อมูล',false),
 'deepDoc'=>$route->invoke(null,'วิเคราะห์ PDF ซับซ้อนที่มี table และ formula',true),
 'ocr'=>$route->invoke(null,'อ่านข้อความจากเอกสารสแกนภาษาไทยด้วย OCR',true),
 'security'=>$route->invoke(null,'security scan หา vulnerability ก่อน deploy',false),
 'data'=>$route->invoke(null,'query ไฟล์ parquet แล้ว aggregate ข้อมูล',true),
 'mcp'=>$route->invoke(null,'ทดสอบ MCP server protocol และ tools list',false),
 'localAi'=>$route->invoke(null,'ใช้ local AI offline เป็น fallback',false),
 'session'=>$route->invoke(null,'ใช้ browser session ที่ logged-in อยู่',false),
 'media'=>$route->invoke(null,'ถอดเสียง video ด้วย whisper และตรวจ ffprobe',false),
 'visualQa'=>$qa->invoke(null,['added'=>[],'changed'=>['web/app.js'],'deleted'=>[]]),
 'serverQa'=>$qa->invoke(null,['added'=>[],'changed'=>['src/server.ts'],'deleted'=>[]]),
 'dataQa'=>$qa->invoke(null,['added'=>[],'changed'=>['config/data.json'],'deleted'=>[]])
], JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE);
`;
  const result=JSON.parse(execFileSync('php',['-r',php],{cwd:ROOT,encoding:'utf8'}));
  assert.deepEqual(result.large.selected.map((item:any)=>item.id),['context.optimize','team.harness']);
  assert.deepEqual(result.design.selected.map((item:any)=>item.id),['design.antislop','design.hallmark','design.reference']);
  assert.deepEqual(result.plain.selected,[]);
  assert.deepEqual(result.attachment.selected.map((item:any)=>item.id),['context.optimize']);
  assert.ok(result.semantic.selected.some((item:any)=>item.id==='code.semantic'));
  assert.ok(result.docs.selected.some((item:any)=>item.id==='docs.current'));
  assert.ok(result.repo.selected.some((item:any)=>item.id==='code.repo'));
  assert.ok(result.crawl.selected.some((item:any)=>item.id==='web.extract'));
  assert.ok(result.deepDoc.selected.some((item:any)=>item.id==='document.deep'));
  assert.ok(result.ocr.selected.some((item:any)=>item.id==='vision.ocr.th'));
  assert.ok(result.security.selected.some((item:any)=>item.id==='security.scan'));
  assert.ok(result.data.selected.some((item:any)=>item.id==='data.query'));
  assert.ok(result.mcp.selected.some((item:any)=>item.id==='mcp.qa'));
  assert.ok(result.localAi.selected.some((item:any)=>item.id==='local.ai.fallback'));
  assert.ok(result.session.selected.some((item:any)=>item.id==='browser.session'));
  assert.ok(result.media.selected.some((item:any)=>item.id==='media.inspect'));
  assert.equal(result.visualQa.status,'REVIEW_REQUIRED');
  assert.equal(result.visualQa.visualReview.policy,'KRUART_GOLDEN_UI_HALLMARK');
  assert.equal(result.serverQa.status,'PASS');
  assert.equal(result.dataQa.status,'PASS');
});

test('worker advisory prompt never turns an external capability into execution authority', () => {
  const plan:WorkerCapabilityPlan={schemaVersion:1,router:'awh.external-capabilities.v1',selected:[
    {id:'design.antislop',label:'Anti Slop Guard',mode:'APPROVED_SKILL_PACK',reason:'filter generic UI',requiredTool:null},
    {id:'context.optimize',label:'Context Optimizer',mode:'OPTIONAL_LOCAL_ADAPTER',reason:'large output',requiredTool:'tool.context-mode'},
    {id:'team.harness',label:'Team Review',mode:'OPTIONAL_LOCAL_ADAPTER',reason:'multi-perspective review',requiredTool:'tool.teamai'}
  ]};
  const text=capabilityPlanInstruction(plan,['tool.context-mode'],['antislop','antislop-ui']);
  assert.match(text,/Anti Slop Guard.*APPROVED_SKILL_LOADED/s);
  assert.match(text,/filter, not a style authority/i);
  assert.match(text,/Context Optimizer.*INVENTORY_ONLY_NOT_EXECUTION_AUTHORITY/s);
  assert.match(text,/Team Review.*NOT_PROVISIONED/s);
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


test('provider-neutral external capabilities distinguish managed Stable authority from command inventory', () => {
  const plan:WorkerCapabilityPlan={schemaVersion:1,router:'awh.external-capabilities.v1',selected:[
    {id:'code.semantic',label:'Semantic Code',mode:'SEPARATE_LAZY_ADAPTER_ONLY',reason:'symbol refactor',requiredTool:'tool.serena'},
    {id:'security.scan',label:'Security Scan',mode:'OPTIONAL_LOCAL_ADAPTER',reason:'pre-release scan',requiredTool:'tool.trivy'},
  ]};
  const inventoryOnly=capabilityPlanInstruction(plan,['tool.serena','tool.trivy']);
  assert.match(inventoryOnly,/Semantic Code.*INVENTORY_ONLY_NOT_EXECUTION_AUTHORITY/s);
  assert.match(inventoryOnly,/Security Scan.*INVENTORY_ONLY_NOT_EXECUTION_AUTHORITY/s);
  assert.match(inventoryOnly,/inventory alone is never execution authority/i);
  const stable=capabilityPlanInstruction(plan,['code.semantic','tool.serena','tool.trivy']);
  assert.match(stable,/Semantic Code.*MANAGED_STABLE/s);
});
