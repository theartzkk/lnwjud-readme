import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

const runFile=promisify(execFile);
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const OUTPUT=await mkdtemp(join(tmpdir(),'awh-control-panel-'));
after(async()=>{await rm(OUTPUT,{recursive:true,force:true});});

test('Owner Control Panel composes existing authorities without a parallel backend',async()=>{
  const [html,js,css]=await Promise.all([
    readFile(join(ROOT,'web/panel.html'),'utf8'),
    readFile(join(ROOT,'web/panel.js'),'utf8'),
    readFile(join(ROOT,'web/panel.css'),'utf8'),
  ]);
  for(const label of ['เว็บไซต์','Domains & SSL','ไฟล์และพื้นที่','ฐานข้อมูล','สำรองและกู้คืน','ความปลอดภัย','เซิร์ฟเวอร์และบริการ','AWH Agent','ผู้ใช้และสิทธิ์','AI และการใช้งาน','Source และรุ่นระบบ']) assert.match(html,new RegExp(label.replace(/[&]/g,'\\&')));
  assert.match(html,/href="#awh-agent"/);
  assert.match(html,/id="awh-agent"/);
  assert.match(html,/id="cp-agent-tools"/);
  assert.match(html,/id="cp-agent-device-list"/);
  assert.match(html,/id="cp-agent-capability-list"/);
  assert.doesNotMatch(html,/infrastructure\.html#capability-fabric/);
  assert.match(js,/renderAgentControl/);
  assert.match(html,/class="cp-nav-advanced"/);
  assert.match(html,/id="system-health"/);
  assert.match(html,/id="cp-health-matrix"/);
  assert.match(html,/ภาพรวมสุขภาพระบบ/);
  assert.match(js,/renderHealthMatrix/);
  assert.match(js,/healthItem\('runtime','AWH Runtime'/);
  assert.match(js,/healthItem\('database','Database'/);
  assert.match(js,/healthItem\('backup','Backup & Recovery'/);
  assert.match(css,/\.cp-health-matrix/);
  assert.match(html,/class="cp-section cp-update-overview"/);
  assert.match(html,/id="system-updates"/);
  assert.match(html,/เปิดศูนย์อัปเดต/);
  assert.match(html,/id="cp-technical-details" class="cp-technical-details"/);
  assert.match(js,/revealHashTarget/);
  assert.match(js,/requireOwnerSession/);
  assert.match(js,/loadInfrastructureSummary/);
  assert.match(js,/loadInfrastructureCompat/);
  assert.match(js,/try\{return await loadInfrastructureSummary\(\);\}\s*catch\{return loadInfrastructure\(\);\}/);
  assert.match(js,/loadUpdateCenter/);
  assert.match(js,/renderUpdateSummary/);
  assert.doesNotMatch(js,/loadBayRemoteUpdateStatus|createBayRemoteInstallRelay|relayBayRemoteCommand/);
  assert.doesNotMatch(js,/Promise\.allSettled\(\[.*loadInfrastructureSummary/);
  assert.doesNotMatch(js,/loadControlData\(\)/);
  assert.match(js,/listManagedSites/);
  assert.match(js,/loadProviderStatus/);
  assert.match(js,/if\(!session\)\{location\.assign/);
  const loadBody=js.slice(js.indexOf('async function load(){'));
  assert.ok(loadBody.indexOf('requireOwnerSession()')<loadBody.indexOf('loadInfrastructureCompat()'));
  assert.doesNotMatch(js,/localStorage|sessionStorage|indexedDB|Authorization|Bearer/i);
  assert.doesNotMatch(html,/password|api[_ -]?key|secret/i);
  assert.match(css,/\.cp-sidebar/);
  assert.match(css,/@media\(max-width:840px\)/);
});

test('Control Panel uses a bounded infrastructure summary route',async()=>{
  const [adapter,router,service,panel,dashboard]=await Promise.all([
    'web/control-plane-adapter.js','hub/src/HubControlPlaneRouter.php','hub/src/HubControlPlaneService.php','web/panel.js','web/dashboard.js'
  ].map(name=>readFile(join(ROOT,name),'utf8')));
  assert.match(adapter,/loadInfrastructureSummary\(\).*infrastructure\/summary/s);
  assert.match(router,/\/api\/v1\/control\/infrastructure\/summary.*infrastructureSummary/s);
  assert.match(service,/function infrastructureSummary\(/);
  assert.match(service,/'projection'=>'OWNER_SUMMARY'/);
  assert.match(panel,/loadInfrastructureSummary\(\)/);
  assert.match(panel,/async function loadInfrastructureCompat\(\)/);
  assert.match(panel,/catch\{return loadInfrastructure\(\);\}/);
  assert.match(dashboard,/loadInfrastructureSummary\(\)/);
  assert.doesNotMatch(dashboard,/\bloadInfrastructure\(\)/);
  assert.ok(panel.indexOf('void loadUpdateSummary();')<panel.indexOf('const data=await loadInfrastructureCompat();'));
});

test('Control Panel is emitted into the canonical web release and PWA shell',async()=>{
  await runFile(process.execPath,['--import','tsx','scripts/build-web-preview.ts','--control'],{
    cwd:ROOT,shell:false,env:{...process.env,AWH_PREVIEW_GENERATED_AT:'2026-09-07T12:00:00.000Z',AWH_WEB_RELEASE_ID:'control-panel-fixture',AWH_WEB_OUTPUT_DIR:OUTPUT},
  });
  const [html,js,sw]=await Promise.all([
    readFile(join(OUTPUT,'panel.html'),'utf8'),
    readFile(join(OUTPUT,'panel.js'),'utf8'),
    readFile(join(OUTPUT,'sw.js'),'utf8'),
  ]);
  assert.match(html,/panel\.css\?release=control-panel-fixture/);
  assert.match(html,/panel\.js\?release=control-panel-fixture/);
  assert.match(js,/control-plane-adapter\.js\?release=control-panel-fixture/);
  assert.match(sw,/\.\/panel\.html/);
  assert.doesNotMatch(html+js,/__AWH_WEB_RELEASE_ID__/);
});

test('Owner entry and standalone admin pages converge on Control Panel',async()=>{
  const [owner,hosting,database,infrastructure,trust,review,app]=await Promise.all([
    'owner-center.js','hosting.html','database.html','infrastructure.html','trust.html','review.html','app.js'
  ].map(name=>readFile(join(ROOT,'web',name),'utf8')));
  assert.match(owner,/เปิดศูนย์ดูแลระบบ/);
  assert.match(owner,/window\.location\.assign\('\.\/panel\.html'\)/);
  for(const page of [hosting,database,infrastructure,trust,review])assert.match(page,/panel\.html/);
  assert.match(app,/awh-settings/);
  assert.match(app,/requestedOwnerSettings/);
  assert.match(infrastructure,/panel\.html#awh-agent/);
  assert.doesNotMatch(infrastructure,/id="capability-fabric"/);
  assert.doesNotMatch(infrastructure,/id="device-role-list"/);
  assert.doesNotMatch(infrastructure,/lnwjud|Remote Desktop/i);
  const panelHtml=await readFile(join(ROOT,'web','panel.html'),'utf8');
  assert.doesNotMatch(panelHtml,/lnwjud|Remote Desktop/i);
  const infrastructureJs=await readFile(join(ROOT,'web','infrastructure.js'),'utf8');
  const controlService=await readFile(join(ROOT,'hub','src','HubControlPlaneService.php'),'utf8');
  assert.match(infrastructureJs,/renderCapabilityFabric/);
  assert.match(controlService,/capabilityFabric/);
});


test('Owner Home delegates update mutations to Update Center while BAY authorities remain available there',async()=>{
  const [html,js,css,adapter,service,control,router,trust]=await Promise.all([
    'web/panel.html','web/panel.js','web/panel.css','web/control-plane-adapter.js',
    'hub/src/HubBayRemoteUpdateService.php','hub/src/HubControlPlaneService.php',
    'hub/src/HubControlPlaneRouter.php','hub/src/HubTrustPolicy.php'
  ].map(name=>readFile(join(ROOT,name),'utf8')));
  assert.match(html,/id="system-updates"/);
  assert.match(html,/href="\.\/updates\.html"/);
  assert.match(html,/อ่านสถานะจาก Update Center แห่งเดียว/);
  assert.doesNotMatch(html,/อัปเดต BAY จากที่ไหนก็ได้|cp-bay-update-button|cp-bay-checks/);
  assert.match(html,/connect-src 'self';/);
  assert.doesNotMatch(html,/connect-src 'self' https:\/\/excuse\.kruart\.online/);
  assert.match(css,/\.cp-update-overview/);
  assert.match(css,/\.cp-update-counts/);
  assert.match(js,/loadUpdateCenter/);
  assert.match(js,/renderUpdateSummary/);
  assert.match(js,/slice\(0,3\)/);
  assert.doesNotMatch(js,/loadBayRemoteUpdateStatus|createBayRemoteInstallRelay|relayBayRemoteCommand|updateBayProduction|loadBayControl/);
  assert.match(adapter,/loadBayRemoteUpdateStatus/);
  assert.match(adapter,/endpoint !== 'https:\/\/excuse\.kruart\.online\/remote-update\.php'/);
  assert.match(adapter,/credentials: 'omit'/);
  assert.match(adapter,/redirect: 'error'/);
  assert.doesNotMatch(html+js+adapter,/PRIVATE KEY|SODIUM_CRYPTO_SIGN_SECRETKEYBYTES|bay-remote-update-signing\.key/);
  assert.match(service,/HubProviderCredentialStore::fromEnvironment\(self::SIGNING_PROVIDER\)/);
  assert.match(service,/packageAuthority'=>'BAY Update Inbox'/);
  assert.match(service,/installAuthority'=>'BAY PackageManager'/);
  assert.doesNotMatch(service,/HubCloudWorkflowService|dispatchRepositoryWorkflow|canonicalRepositoryRevision|GitHub/);
  assert.match(control,/assertOwner/);
  assert.match(control,/authorizeSession/);
  assert.match(router,/\/api\/v1\/control\/bay\/update/);
  assert.match(router,/\/api\/v1\/control\/bay\/update\/install-relay/);
  assert.match(trust,/bay\.remote_update\.install/);
});
