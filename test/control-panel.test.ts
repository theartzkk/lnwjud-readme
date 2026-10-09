import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test, { after } from 'node:test';

const runFile=promisify(execFile);
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const OUTPUT=await mkdtemp(join(tmpdir(),'awh-control-panel-'));
after(async()=>{await rm(OUTPUT,{recursive:true,force:true});});

test('Owner Control Panel composes existing authorities without a parallel backend',async()=>{
  const [html,js,css,live,workflow,liveCss,pkg,qa]=await Promise.all([
    readFile(join(ROOT,'web/panel.html'),'utf8'),
    readFile(join(ROOT,'web/panel.js'),'utf8'),
    readFile(join(ROOT,'web/panel.css'),'utf8'),
    readFile(join(ROOT,'web/panel-live-island/index.tsx'),'utf8'),
    readFile(join(ROOT,'web/panel-live-island/workflow.ts'),'utf8'),
    readFile(join(ROOT,'web/panel-live-island/styles.css'),'utf8'),
    readFile(join(ROOT,'package.json'),'utf8'),
    readFile(join(ROOT,'scripts/qa/awh-local-qa.mjs'),'utf8'),
  ]);
  for(const label of ['เว็บไซต์','Domains & SSL','ไฟล์และพื้นที่','ฐานข้อมูล','สำรองและกู้คืน','ความปลอดภัย','เซิร์ฟเวอร์และบริการ','ผู้ใช้และสิทธิ์','AI','Source และรุ่นระบบ']) assert.match(html,new RegExp(label.replace(/[&]/g,'\\&')));
  assert.match(html,/AWH Control Panel/);
  assert.match(html,/COMMAND CENTER/);
  assert.match(html,/ควบคุม AWH จากที่เดียว/);
  assert.match(html,/class="cp-command-grid"/);
  assert.match(html,/id="cp-command-attention-count"/);
  assert.match(html,/id="cp-command-running"/);
  assert.match(html,/id="cp-command-devices"/);
  assert.match(html,/id="cp-command-sites"/);
  assert.match(js,/renderCommandCenter/);
  assert.match(html,/id="cp-live-react-root"/);
  assert.match(html,/panel-live-ui\.css\?release=__AWH_WEB_RELEASE_ID__/);
  assert.match(html,/panel-live-ui\.js\?release=__AWH_WEB_RELEASE_ID__/);
  assert.match(html,/id="live-controls"/);
  assert.match(live,/@tanstack\/react-query/);
  assert.match(live,/@xstate\/react/);
  assert.match(live,/from "cmdk"/);
  assert.doesNotMatch(live,/from "sonner"|from "motion\/react"/);
  assert.match(live,/role=\{notice.tone==="error"\?"alert":"status"\}/);
  assert.match(live,/setNotice\(\{tone:"info",title:"กำลังตรวจคำสั่ง…"/);
  assert.match(live,/loadControlData/);
  assert.match(live,/loadCoreReleaseStatus/);
  assert.match(live,/managedSiteAction/);
  assert.match(live,/requestCoreRelease/);
  assert.match(workflow,/queued/);
  assert.match(workflow,/deploying/);
  assert.match(workflow,/verifying/);
  assert.match(workflow,/rollback/);
  assert.match(liveCss,/\.panel-live-ready #live-controls\{display:none\}/);
  for(const dep of ['@tanstack/react-query','@xstate/react','cmdk','xstate']) assert.match(pkg,new RegExp(dep.replace('/','\\/')));
  assert.match(qa,/panel:typecheck/);
  assert.match(html,/ควบคุมระบบจริง/);
  for(const id of ['cp-live-tasks','cp-live-approvals','cp-live-sites','cp-live-devices','cp-core-release-button']) assert.match(html,new RegExp('id="'+id+'"'));
  for(const fn of ['loadControlData','cancelTask','decideApproval','revokeDevice','managedSiteAction','loadCoreReleaseStatus','requestCoreRelease','updatePersonAccess']) assert.match(js,new RegExp('\\b'+fn+'\\b'));
  assert.match(js,/task\.canCancel===true/);
  assert.match(js,/status==='PENDING'/);
  assert.match(js,/rollbackReleaseId/);
  assert.match(js,/worker\.state!=='WORKING'/);
  assert.match(js,/requestCoreRelease\(sha,false\)/);
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
  assert.match(html,/สุขภาพระบบ/);
  assert.match(js,/renderHealthMatrix/);
  assert.match(js,/healthItem\('runtime','AWH Runtime'/);
  assert.match(js,/healthItem\('database','Database'/);
  assert.match(js,/healthItem\('backup','Backup & Recovery'/);
  assert.match(css,/\.cp-health-matrix/);
  assert.match(html,/id="operations" class="cp-control-surface"/);
  assert.match(html,/OPERATIONS/);
  assert.match(html,/Update Center/);
  assert.match(html,/id="cp-technical-details" class="cp-diagnostics"/);
  assert.match(css,/\.cp-command-hero/);
  assert.match(css,/\.cp-command-card/);
  assert.match(css,/\.cp-control-surface/);
  assert.match(css,/\.cp-diagnostics/);
  assert.match(js,/revealHashTarget/);
  assert.match(js,/requireOwnerSession/);
  assert.match(js,/loadInfrastructureSummary/);
  assert.match(js,/loadInfrastructureCompat/);
  assert.match(js,/try\{return await loadInfrastructureSummary\(\);\}\s*catch\{return loadInfrastructure\(\);\}/);
  assert.match(js,/loadUpdateCenter/);
  assert.match(js,/renderUpdateSummary/);
  assert.doesNotMatch(js,/loadBayRemoteUpdateStatus|createBayRemoteInstallRelay|relayBayRemoteCommand/);
  assert.doesNotMatch(js,/Promise\.allSettled\(\[.*loadInfrastructureSummary/);
  assert.match(js,/loadControlData\(\)/);
  assert.match(js,/listManagedSites/);
  assert.match(js,/loadProviderStatus/);
  assert.match(html,/responsive-layout\.css\?release=__AWH_WEB_RELEASE_ID__/);
  assert.match(html,/id="cp-search-results"/);
  for(const id of ['cp-ai-used','cp-ai-limit','cp-ai-remaining']) assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(js,/withOwnerStepUp as runWithOwnerStepUp/);
  assert.match(js,/renderOwnerSearchResults/);
  assert.match(js,/ownerActionIndex/);
  assert.match(js,/startOwnerFreshness/);
  assert.match(js,/visibilitychange/);
  assert.match(js,/setInterval\(\(\)=>void refreshOwnerSignals\(\),20000\)/);
  assert.match(css,/\.cp-mini-action\{[^}]*min-height:44px/);
  assert.match(css,/\.cp-role-select\{min-height:44px/);
  assert.match(css,/\.cp-provider-form input\{[^}]*min-height:48px/);
  assert.doesNotMatch(js,/KEY REQUIRED|Free\/Included|qualification/);
  assert.match(js,/loadHatchetStatus/);
  assert.match(js,/renderHatchetOwnerStatus/);
  assert.match(js,/\.\/\?awh-settings=hatchet/);
  assert.match(html,/id="cp-hatchet-status"/);
  assert.match(js,/if\(!session\)\{location\.assign/);
  const loadBody=js.slice(js.indexOf('async function load(){'));
  assert.ok(loadBody.indexOf('requireOwnerSession()')<loadBody.indexOf('loadInfrastructureCompat()'));
  assert.doesNotMatch(js,/localStorage|sessionStorage|indexedDB|Authorization|Bearer/i);
  assert.doesNotMatch(html,/password|api[_ -]?key|secret/i);
  assert.match(css,/\.cp-sidebar/);
  assert.match(css,/@media\(max-width:840px\)/);
  assert.match(css,/\.cp-command-primary,.cp-command-secondary,.cp-section-action\{min-height:48px;font-size:13px\}/);
});

test('AI Provider auto-refresh retains unsent credentials and busy actions',async()=>{
  const js=await readFile(join(ROOT,'web/panel.js'),'utf8');
  const matched=js.match(/function providerDraftInProgress\(\)\{[\s\S]*?\n\}/);
  assert.ok(matched,'draft guard must be declared');
  const run=({value='',focused=false,busy=false}={})=>{
    const input={value};
    const form={
      dataset:busy?{submitting:'true'}:{},
      contains:node=>node===input,
      querySelectorAll:()=>[input]
    };
    const host={querySelectorAll:()=>[form]};
    const document={activeElement:focused?input:null};
    return runInNewContext(matched[0]+'\nproviderDraftInProgress()',{$:()=>host,document});
  };
  assert.equal(run(),false,'idle provider may refresh');
  assert.equal(run({value:'unsent-key'}),true,'typed credentials must survive refresh');
  assert.equal(run({focused:true}),true,'focused input must survive refresh');
  assert.equal(run({busy:true}),true,'provider mutation must not be redrawn');
  assert.match(js,/if\(results\[1\]\.status==='fulfilled'&&!providerDraftInProgress\(\)\)renderProviderHub/);
  assert.match(js,/if\(secondary\[5\]\.status==='fulfilled'\)\{if\(!providerDraftInProgress\(\)\)renderProviderHub/);
  assert.match(js,/else if\(!providerDraftInProgress\(\)&&\$\('cp-provider-list'\)\)empty/);
  assert.equal((js.match(/form\.dataset\.submitting='true'/g)||[]).length,3);
});

test('Owner device labels disambiguate same-name Macs and destructive device actions',async()=>{
  const js=await readFile(join(ROOT,'web/panel.js'),'utf8');
  const helper=js.match(/const shortDeviceId=.*?\nfunction deviceFriendlyName\(worker\)\{[\s\S]*?\n\}/);
  assert.ok(helper,'device identity helper must be present');
  const get=(worker:Record<string,unknown>)=>({
    label:String(runInNewContext(helper[0]+'\ndeviceFriendlyName(worker)',{worker})),
    id:String(runInNewContext(helper[0]+'\nshortDeviceId(worker)',{worker}))
  });
  const intel=get({displayName:'Art’s Mac',platform:'darwin',arch:'x64',deviceId:'aaaaaaaa-bbbb-cccc-dddd-111122223333'});
  const silicon=get({displayName:'Art’s Mac',platform:'darwin',arch:'arm64',deviceId:'aaaaaaaa-bbbb-cccc-dddd-555566667777'});
  assert.notEqual(intel.label,silicon.label,'same-name Macs must have distinct platform labels');
  assert.match(intel.label,/Mac Intel/);
  assert.match(silicon.label,/Mac Apple Silicon/);
  assert.equal(intel.id,'22223333');
  assert.equal(silicon.id,'66667777');
  assert.match(js,/รหัสเครื่อง/,'the owner must see an immutable device reference');
  assert.match(js,/worker\.state!=='WORKING'&&worker\.deviceId/,'disconnect must need an actual device ID');
});

test('Owner status and next-action CTA never report readiness from an empty inbox alone',async()=>{
  const js=await readFile(join(ROOT,'web/panel.js'),'utf8');
  const matched=js.match(/function syncCommandAttention\(\)\{[\s\S]*?\n\}/);
  assert.ok(matched,'owner command summary function exists');
  class FakeAnchor { href=''; textContent=''; }
  const run=({count=0,health=''}={})=>{
    const nodes=new Map<string,any>();
    for(const id of ['cp-command-attention-count','cp-command-attention-note','cp-command-summary'])nodes.set(id,{textContent:''});
    const anchor=new FakeAnchor();nodes.set('cp-command-primary',anchor);
    if(health)nodes.set('cp-overall',{classList:{contains:(name:string)=>name===health}});
    runInNewContext(matched[0]+'\nsyncCommandAttention()',{
      $:(id:string)=>nodes.get(id),
      document:{querySelectorAll:()=>Array.from({length:count},()=>({}))},
      HTMLAnchorElement:FakeAnchor
    });
    return {summary:nodes.get('cp-command-summary').textContent,href:anchor.href,action:anchor.textContent};
  };
  assert.deepEqual(run(),{summary:'กำลังตรวจความพร้อม',href:'#operations',action:'ดูงานและอัปเดต'});
  assert.deepEqual(run({health:'good'}),{summary:'ระบบหลักพร้อมใช้งาน',href:'#operations',action:'ดูงานและอัปเดต'});
  assert.deepEqual(run({health:'warn'}),{summary:'มีสถานะระบบที่ควรตรวจ',href:'#system-health',action:'ดูสถานะระบบ'});
  assert.deepEqual(run({count:2,health:'bad'}),{summary:'2 เรื่องควรจัดการ',href:'#cp-attention-wrap',action:'ดูสิ่งที่ต้องทำ'});
  assert.match(js,/if\(overall&&\(badCount\|\|warnCount\)/);
  assert.match(js,/syncCommandAttention\(\);/);
});

test('Mobile owner navigation has keyboard focus, real dismissal surface and compact touch layout',async()=>{
  const [html,js,css]=await Promise.all(['web/panel.html','web/panel.js','web/panel.css'].map(p=>readFile(join(ROOT,p),'utf8')));
  assert.match(html,/id="cp-menu-scrim"[^>]+hidden/);
  assert.match(html,/id="cp-menu"[^>]+aria-expanded="false" aria-controls="cp-sidebar"/);
  assert.match(js,/function setMobileMenu\(open/);
  assert.match(js,/sidebar\.inert=window\.innerWidth<=840&&!shouldOpen/);
  assert.match(js,/scrim\?\.addEventListener\('click'/);
  assert.match(js,/event\.key==='Escape'/);
  assert.match(js,/event\.key==='Tab'/);
  assert.match(js,/setMobileMenu\(false\);/);
  assert.match(css,/\.cp-menu-scrim:not\(\[hidden\]\)/);
  assert.match(css,/max-width:560px[\s\S]*?cp-command-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:360px\)[\s\S]*?\.cp-command-grid\{grid-template-columns:1fr/);
  assert.match(css,/:focus-visible/);
  assert.match(css,/\.cp-health-action,\.cp-row-action,\.cp-sidebar-foot a,\.cp-nav-advanced>summary\{min-height:44px/);
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
  const [html,js,ownerStepUp,sw,liveJs,liveCss]=await Promise.all([
    readFile(join(OUTPUT,'panel.html'),'utf8'),
    readFile(join(OUTPUT,'panel.js'),'utf8'),
    readFile(join(OUTPUT,'owner-stepup.js'),'utf8'),
    readFile(join(OUTPUT,'sw.js'),'utf8'),
    readFile(join(OUTPUT,'panel-live-ui.js'),'utf8'),
    readFile(join(OUTPUT,'panel-live-ui.css'),'utf8'),
  ]);
  assert.match(html,/panel\.css\?release=control-panel-fixture/);
  assert.match(html,/panel\.js\?release=control-panel-fixture/);
  assert.match(js,/control-plane-adapter\.js\?release=control-panel-fixture/);
  assert.match(js,/owner-stepup\.js\?release=control-panel-fixture/);
  assert.match(ownerStepUp,/export async function withOwnerStepUp/);
  assert.doesNotMatch(ownerStepUp,/\.style\.setProperty\(/,'Owner verification UI must not create inline styles under strict CSP');
  assert.match(ownerStepUp,/event\.key === 'Escape'/);
  assert.match(sw,/owner-stepup\.js\?release=control-panel-fixture/);
  assert.match(sw,/\.\/panel\.html/);
  assert.match(sw,/panel-live-ui\.js/);
  assert.match(sw,/panel-live-ui\.css/);
  assert.ok(liveJs.length>5000);
  assert.match(liveCss,/awh-live-toolbar/);
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


test('Owner Control Panel mutates only through existing AWH authorities while BAY authorities remain separate',async()=>{
  const [html,js,css,adapter,service,control,router,trust]=await Promise.all([
    'web/panel.html','web/panel.js','web/panel.css','web/control-plane-adapter.js',
    'hub/src/HubBayRemoteUpdateService.php','hub/src/HubControlPlaneService.php',
    'hub/src/HubControlPlaneRouter.php','hub/src/HubTrustPolicy.php'
  ].map(name=>readFile(join(ROOT,name),'utf8')));
  assert.match(html,/id="operations"/);
  assert.match(html,/href="\.\/updates\.html"/);
  assert.match(html,/งานและอัปเดต/);
  assert.match(html,/id="cp-core-release-button"/);
  assert.match(js,/requestCoreRelease/);
  assert.match(js,/managedSiteAction/);
  assert.match(js,/cancelTask/);
  assert.match(js,/decideApproval/);
  assert.match(js,/revokeDevice/);
  assert.doesNotMatch(html,/อัปเดต BAY จากที่ไหนก็ได้|cp-bay-update-button|cp-bay-checks/);
  assert.match(html,/connect-src 'self';/);
  assert.doesNotMatch(html,/connect-src 'self' https:\/\/excuse\.kruart\.online/);
  assert.match(css,/\.cp-control-surface/);
  assert.match(css,/\.cp-operation-counts/);
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
