import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const run=promisify(execFile);const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');

test('Trust Center is an Owner-only read projection over existing authorities',async()=>{
 const [service,router,owner]=await Promise.all(['hub/src/HubControlPlaneService.php','hub/src/HubControlPlaneRouter.php','web/owner-center.js'].map(f=>readFile(join(ROOT,f),'utf8')));
 assert.match(service,/public function trustCenter/);assert.match(service,/assertOwner\(\$userId\)/);assert.match(router,/\/api\/v1\/control\/trust/);assert.match(owner,/Trust Center/);assert.match(owner,/\.\/trust\.html/);
 const trust=service.slice(service.indexOf('public function trustCenter'),service.indexOf('/** Owner-only VPS/Control Plane projection'));
 for(const table of ['auth_audit_events','control_task_events','control_approvals','control_task_executions','control_workspace_events','control_artifacts'])assert.match(trust,new RegExp(table));
 assert.doesNotMatch(trust,/SELECT[^;]*(?:metadata_hash|scope_json|relative_ref|checkpoint_json|message)/i);
 assert.match(service,/secretsExposed' => false/);assert.match(service,/rawPathsExposed' => false/);assert.match(service,/metadataHashesExposed' => false/);
});
test('Trust Center ships as a canonical mobile-safe release surface without browser authority',async()=>{
 const output=await mkdtemp(join(tmpdir(),'awh-trust-'));
 try{
  await run(process.execPath,['--import','tsx','scripts/build-web-preview.ts','--control'],{cwd:ROOT,shell:false,env:{...process.env,AWH_WEB_RELEASE_ID:'trust-fixture',AWH_WEB_OUTPUT_DIR:output,AWH_PREVIEW_GENERATED_AT:'2026-08-28T00:00:00.000Z'}});
  const [html,css,js,manifest,deploy]=await Promise.all(['trust.html','trust.css','trust.js'].map(f=>readFile(join(output,f),'utf8')).concat([readFile(join(ROOT,'scripts/create-web-release-manifest.mjs'),'utf8'),readFile(join(ROOT,'deploy/awh-control-plane/deploy-control-plane.sh'),'utf8')]) as Promise<string[]>);
  assert.match(html,/Trust Center/);assert.match(html,/TRUST & CONTROL/);assert.match(css,/@media\(max-width:760px\)/);assert.match(css,/--accent:#ff7a1a/);assert.match(js,/\/api\/v1\/control\/trust/);
  assert.doesNotMatch(`${html}\n${js}`,/localStorage|sessionStorage|Authorization|Bearer\s|XMLHttpRequest|new WebSocket|innerHTML|document\.cookie/i);
  assert.doesNotMatch(js,/metadata_hash|scope_json|relative_ref|checkpoint_json|password_hash|sessionToken|csrfToken|api[_-]?key/i);
  for(const file of ['trust.html','trust.css','trust.js']){assert.match(manifest,new RegExp(file.replace('.','\\.')));assert.match(deploy,new RegExp(`dist-web/${file.replace('.','\\.')}`));}
 }finally{await rm(output,{recursive:true,force:true});}
});
