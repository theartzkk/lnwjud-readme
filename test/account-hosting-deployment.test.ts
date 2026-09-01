import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { controlRequest } from '../web/control-plane-adapter.js';

const execFileAsync=promisify(execFile); const root=process.cwd();
const deploy=join(root,'deploy/awh-control-plane/deploy-control-plane.sh');
const remote=join(root,'deploy/awh-control-plane/remote-deploy-control-plane.sh');

test('M17 Account + Managed Hosting activation is additive, typed and approval-gated',async()=>{
 const release='1717171717171717171717171717171717171717';
 const result=await execFileAsync('/bin/sh',[deploy,'--dry-run','--owner-auth','--account-hosting'],{cwd:root,env:{...process.env,AWH_SOURCE_ROOT:root,AWH_RELEASE_COMMIT:release,AWH_HUB_HOSTNAME:'awh.example'}});
 assert.match(result.stdout,/^M17_DRY_RUN=PASS$/m); assert.match(result.stdout,new RegExp(`^M17_RELEASE=${release}$`,'m'));
 assert.match(result.stdout,/verify-v16-or-v17-authority/); assert.match(result.stdout,/migrate-016-only-from-v16/);
 assert.match(result.stdout,/typed-hosting-operator/); assert.match(result.stdout,/restore-exact-db-baseline/);
 assert.match(result.stdout,/M17_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL/);
 const [local,remoteText,service,timer,build,verifier,operator,hostingHtml,hostingJs,trustPolicy]=await Promise.all([
  readFile(deploy,'utf8'),readFile(remote,'utf8'),readFile(join(root,'deploy/systemd/awh-hosting-operator.service'),'utf8'),readFile(join(root,'deploy/systemd/awh-hosting-operator.timer'),'utf8'),readFile(join(root,'scripts/build-web-preview.ts'),'utf8'),readFile(join(root,'deploy/awh-control-plane/verify-web-release.php'),'utf8'),readFile(join(root,'hub/src/HubManagedHostingOperator.php'),'utf8'),readFile(join(root,'web/hosting.html'),'utf8'),readFile(join(root,'web/hosting.js'),'utf8'),readFile(join(root,'hub/src/HubTrustPolicy.php'),'utf8')]);
 assert.match(local,/--account-hosting/); assert.match(local,/hub\/migrations\/016_account_hosting\.sql/); assert.match(local,/dist-web\/hosting\.html/);
 assert.match(local,/HubActionGraphService\.php/); assert.match(local,/HubConversationReferentService\.php/); assert.match(local,/verify-control-plane-bundle-closure\.mjs/);
 assert.match(remoteText,/ACCOUNT_HOSTING_MIGRATION_FIRST/); assert.match(remoteText,/HOSTING_OPERATOR_UNITS_READY/); assert.match(remoteText,/ACCOUNT_HOSTING_ROUTE/);
 assert.match(remoteText,/restore_previous_control_include\(\)/); assert.match(remoteText,/PREVIEW_AWH_FPM_SOCKET/); assert.match(remoteText,/POINTER_CHANGED[\s\S]*restore_previous_control_include/);
 assert.match(service,/^\[Unit\]/m); assert.doesNotMatch(service,/AWH_PUBLIC_HOST=157\.85\.108\.142/); assert.match(service,/ExecStart=\/usr\/bin\/php .*awh-hosting-operator\.php/); assert.doesNotMatch(service,/sh -c|bash -c/);
 assert.match(timer,/OnUnitActiveSec=30s/); assert.match(operator,/does match certificate/); assert.match(operator,/letsencrypt\/live/); assert.match(build,/asset\('hosting\.html'\)/); assert.match(verifier,/'hosting\.html'/);
 assert.match(hostingHtml,/id="site-url-preview"/); assert.match(hostingHtml,/id="hosting-confirm-submit"/); assert.match(hostingJs,/renderUrlPreview/); assert.match(hostingJs,/confirmAction/); assert.doesNotMatch(hostingJs,/requestStepUp|stepUp\(|hosting-stepup-password/); assert.match(trustPolicy,/hosting\.site\.create/); assert.match(trustPolicy,/hosting\.site\.deploy/); assert.match(trustPolicy,/account\.user\.access/);
});

test('M17 PHP authority and web package are regression-checked',async()=>{
 const php=await execFileAsync('php',['hub/tests/m17-account-hosting.php'],{cwd:root});
 assert.match(php.stdout,/AWH M17 Account Hosting: PASS/);
 await execFileAsync(process.execPath,['--import','tsx','scripts/build-web-preview.ts','--control'],{cwd:root,env:{...process.env,AWH_WEB_RELEASE_ID:'m17-test'}});
 for(const name of ['hosting.html','hosting.css','hosting.js']) assert.match(await readFile(join(root,'dist-web',name),'utf8'),/AWH|Hosting|hosting/i);
});

test('control bundle closure fails closed on an omitted PHP dependency',async()=>{
 const {mkdir,mkdtemp,rm,writeFile}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const dir=await mkdtemp(join(tmpdir(),'awh-bundle-closure-'));
 const verifier=join(root,'scripts/deploy/verify-control-plane-bundle-closure.mjs');
 try {
  await writeFile(join(dir,'A.php'),"<?php\nrequire_once __DIR__ . '/B.php';\n",'utf8');
  await writeFile(join(dir,'B.php'),"<?php\n",'utf8');
  await mkdir(join(dir,'bin'));
  await writeFile(join(dir,'bin','C.php'),"<?php\nrequire_once dirname(__DIR__) . '/B.php';\n",'utf8');
  let stderr='';
  try { await execFileAsync(process.execPath,[verifier,dir,'A.php']); }
  catch(error){ stderr=String((error as {stderr?:string}).stderr??''); }
  assert.match(stderr,/CONTROL_BUNDLE_CLOSURE_FAILED A\.php -> unbundled B\.php/);
  let dirnameStderr='';
  try { await execFileAsync(process.execPath,[verifier,dir,'bin/C.php']); }
  catch(error){ dirnameStderr=String((error as {stderr?:string}).stderr??''); }
  assert.match(dirnameStderr,/CONTROL_BUNDLE_CLOSURE_FAILED bin\/C\.php -> unbundled B\.php/);
  const pass=await execFileAsync(process.execPath,[verifier,dir,'A.php','B.php','bin/C.php']);
  assert.match(pass.stdout,/CONTROL_BUNDLE_CLOSURE=PASS files=3/);
 } finally { await rm(dir,{recursive:true,force:true}); }
});


test('browser keeps typed high-risk step-up code private while routine Hosting is policy-driven',async()=>{
 const fetchImpl=async()=>new Response(JSON.stringify({schemaVersion:1,error:'ERROR',code:'STEP_UP_REQUIRED',requestId:'fixture'}),{status:403,headers:{'Content-Type':'application/json'}});
 await assert.rejects(controlRequest('/api/v1/control/provider/credential',{method:'POST',body:'{}'},fetchImpl),error=>error instanceof Error && error.message==='กรุณายืนยันรหัสผ่านก่อนบันทึกการตั้งค่าสำคัญ' && (error as Error & {code?:string}).code==='STEP_UP_REQUIRED' && !error.message.includes('STEP_UP_REQUIRED'));
 const hosting=await readFile(join(root,'web/hosting.js'),'utf8');
 assert.doesNotMatch(hosting,/requestStepUp|stepUp\(/);
 assert.match(hosting,/confirmationRequired/);
});
