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
  assert.match(js,/loadAuthSession/);
  assert.match(js,/loadInfrastructure/);
  assert.match(js,/Promise\.allSettled\(\[loadAuthSession\(\),loadInfrastructure\(\)\]\)/);
  assert.doesNotMatch(js,/loadControlData\(\)/);
  assert.match(js,/listManagedSites/);
  assert.match(js,/loadProviderStatus/);
  assert.match(js,/primary\[0\]\.value\?\.role!=='OWNER'/);
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
