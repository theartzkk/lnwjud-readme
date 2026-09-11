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
  for(const label of ['Websites','Domains & SSL','Files & Storage','Databases','Backups','Security','Server & Services','Users & Access','AI & Costs','Source Authority'])assert.match(html,new RegExp(label.replace(/[&]/g,'\\&')));
  assert.match(js,/requireOwnerSession/);
  assert.match(js,/loadInfrastructure/);
  assert.doesNotMatch(js,/Promise\.allSettled\(\[.*loadInfrastructure/);
  assert.doesNotMatch(js,/loadControlData\(\)/);
  assert.match(js,/listManagedSites/);
  assert.match(js,/loadProviderStatus/);
  assert.match(js,/if\(!session\)\{location\.assign/); assert.ok(js.indexOf('requireOwnerSession()')<js.indexOf('loadInfrastructure()'));
  assert.doesNotMatch(js,/localStorage|sessionStorage|indexedDB|Authorization|Bearer/i);
  assert.doesNotMatch(html,/password|api[_ -]?key|secret/i);
  assert.match(css,/\.cp-sidebar/);
  assert.match(css,/@media\(max-width:840px\)/);
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
  assert.match(owner,/เปิด Control Panel/);
  assert.match(owner,/window\.location\.assign\('\.\/panel\.html'\)/);
  for(const page of [hosting,database,infrastructure,trust,review])assert.match(page,/panel\.html/);
  assert.match(app,/awh-settings/);
  assert.match(app,/requestedOwnerSettings/);
});


test('BAY Remote Update stays inside AWH Owner + BAY Update Inbox + PackageManager authorities',async()=>{
  const [html,js,css,adapter,service,control,router,trust]=await Promise.all([
    'web/panel.html','web/panel.js','web/panel.css','web/control-plane-adapter.js',
    'hub/src/HubBayRemoteUpdateService.php','hub/src/HubControlPlaneService.php',
    'hub/src/HubControlPlaneRouter.php','hub/src/HubTrustPolicy.php'
  ].map(name=>readFile(join(ROOT,name),'utf8')));
  assert.match(html,/BAY REMOTE UPDATE CONTROL/);
  assert.match(html,/system-control-panel\.webp/);
  assert.match(html,/connect-src 'self' https:\/\/kruart\.great-site\.net/);
  const serverCsp=await readFile(join(ROOT,'deploy/nginx/transform-owner-auth.php'),'utf8');
  assert.match(serverCsp,/connect-src 'self' https:\/\/kruart\.great-site\.net/);
  assert.match(css,/\.cp-bay-update/);
  assert.match(css,/@media\(max-width:560px\)/);
  assert.match(js,/loadBayRemoteUpdateStatus/);
  assert.match(js,/createBayRemoteInstallRelay/);
  assert.match(js,/relayBayRemoteCommand/);
  assert.match(js,/Backup → Install → Verify/);
  assert.match(js,/Auto-stage|auto-stage|Update Inbox/);
  assert.doesNotMatch(js+adapter,/prepareBayRemoteUpdate|\/bay\/update\/prepare/);
  assert.match(adapter,/endpoint !== 'https:\/\/kruart\.great-site\.net\/remote-update\.php'/);
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
