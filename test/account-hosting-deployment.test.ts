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

test('M17 Account + Managed Hosting activation is additive, typed and production-guarded',async()=>{
 const release=(await execFileAsync('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim();
 const result=await execFileAsync('/bin/sh',[deploy,'--dry-run','--owner-auth','--account-hosting'],{cwd:root,env:{...process.env,AWH_SOURCE_ROOT:root,AWH_RELEASE_COMMIT:release,AWH_HUB_HOSTNAME:'awh.example'}});
 assert.match(result.stdout,/^M17_DRY_RUN=PASS$/m); assert.match(result.stdout,new RegExp(`^M17_RELEASE=${release}$`,'m'));
 assert.match(result.stdout,/verify-v16-or-v17-authority/); assert.match(result.stdout,/migrate-016-only-from-v16/);
 assert.match(result.stdout,/typed-hosting-operator/); assert.match(result.stdout,/restore-exact-db-baseline/);
 assert.match(result.stdout,/M17_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL/);
 const [local,remoteText,service,timer,identityUnit,identityHelper,identityReconcile,useraddProxy,build,verifier,operator,hostingHtml,hostingJs,trustPolicy,ownerCenter]=await Promise.all([
  readFile(deploy,'utf8'),readFile(remote,'utf8'),readFile(join(root,'deploy/systemd/awh-hosting-operator.service'),'utf8'),readFile(join(root,'deploy/systemd/awh-hosting-operator.timer'),'utf8'),readFile(join(root,'deploy/systemd/awh-hosting-identity@.service'),'utf8'),readFile(join(root,'deploy/awh-hosting/awh-hosting-identity.php'),'utf8'),readFile(join(root,'deploy/awh-hosting/awh-hosting-identity-reconcile.php'),'utf8'),readFile(join(root,'deploy/awh-hosting/awh-useradd-proxy.php'),'utf8'),readFile(join(root,'scripts/build-web-preview.ts'),'utf8'),readFile(join(root,'deploy/awh-control-plane/verify-web-release.php'),'utf8'),readFile(join(root,'hub/src/HubManagedHostingOperator.php'),'utf8'),readFile(join(root,'web/hosting.html'),'utf8'),readFile(join(root,'web/hosting.js'),'utf8'),readFile(join(root,'hub/src/HubTrustPolicy.php'),'utf8'),readFile(join(root,'web/owner-center.js'),'utf8')]);
 assert.match(local,/--account-hosting/); assert.match(local,/hub\/migrations\/016_account_hosting\.sql/); assert.match(local,/dist-web\/hosting\.html/);
 assert.match(local,/HubActionGraphService\.php/); assert.match(local,/HubConversationReferentService\.php/); assert.match(local,/verify-control-plane-bundle-closure\.mjs/);
 assert.match(remoteText,/ACCOUNT_HOSTING_MIGRATION_FIRST/); assert.match(remoteText,/HOSTING_OPERATOR_UNITS_READY/); assert.match(remoteText,/ACCOUNT_HOSTING_ROUTE/); assert.match(remoteText,/stage HOSTING_RUNTIME_READY/); assert.match(remoteText,/test -x \/usr\/bin\/certbot/); assert.match(remoteText,/systemctl cat certbot\.timer/); assert.match(remoteText,/enable --now certbot\.timer/); assert.match(remoteText,/stage HOSTING_TLS_RENEWAL_READY/); assert.match(remoteText,/install -d -o root -g root -m 0755 \/var\/lib\/awh-acme \/var\/lib\/letsencrypt \/var\/log\/letsencrypt \/etc\/letsencrypt/);
 const refreshStart=remoteText.indexOf('if test "$PLATFORM_HARDENING" = 1 || test "$IDENTITY_CONVERGENCE" = 1 || test "$CONVERSATION_LIFECYCLE" = 1 || test "$PROJECT_SOURCE_AUTHORITY" = 1 || test "$CLOUD_FIRST" = 1; then');
 const refreshEnd=remoteText.indexOf('elif test "$ACCOUNT_HOSTING" = 1; then',refreshStart); const refreshHosting=remoteText.slice(refreshStart,refreshEnd);
 assert.ok(refreshStart>=0&&refreshEnd>refreshStart); assert.match(remoteText,/stage HOSTING_RUNTIME_READY/); assert.match(refreshHosting,/install -o root -g root -m 0644 "\$RELEASE\/deploy\/systemd\/awh-hosting-operator\.timer" "\$HOSTING_TIMER_UNIT"/); assert.match(refreshHosting,/HOSTING_UNITS_INSTALLED=1/); assert.match(refreshHosting,/systemctl daemon-reload/);
 assert.match(remoteText,/restore_previous_control_include\(\)/); assert.match(remoteText,/PREVIEW_AWH_FPM_SOCKET/); assert.match(remoteText,/POINTER_CHANGED[\s\S]*restore_previous_control_include/);
 assert.match(service,/^\[Unit\]/m); assert.doesNotMatch(service,/AWH_PUBLIC_HOST=157\.85\.108\.142/); assert.match(service,/ExecStartPre=\/usr\/bin\/php .*awh-hosting-identity-reconcile\.php/); assert.match(service,/ExecStart=\/usr\/bin\/php .*awh-hosting-operator\.php/); assert.doesNotMatch(service,/sh -c|bash -c/); assert.match(service,/ReadWritePaths=.*\/etc\/letsencrypt/); assert.match(service,/ReadWritePaths=.*\/var\/lib\/awh-acme/); assert.doesNotMatch(service,/\/etc\/(?:\.pwd\.lock|passwd|shadow|group|gshadow|subuid|subgid)(?:[+\-])?/); assert.match(service,/ReadWritePaths=.*-\/var\/backups\/learnlab-releases/); assert.match(service,/ReadWritePaths=.*-\/var\/backups\/bay-assessment/); assert.match(service,/ReadOnlyPaths=-\/var\/lib\/awh-remote\/handoff -\/home\/bayadmin\/\.awh\/source\/git\/bay-assessment\.git/);
 assert.match(identityUnit,/ExecStart=\/usr\/bin\/php .*deploy\/awh-hosting\/awh-hosting-identity\.php %i/); assert.match(identityUnit,/ConditionPathExists=\/usr\/sbin\/useradd/); assert.match(identityUnit,/PrivateNetwork=true/); assert.match(identityUnit,/ProtectSystem=full/); assert.match(identityUnit,/BindPaths=\/etc:\/etc/); assert.doesNotMatch(identityUnit,/ReadWritePaths=\/etc/); assert.doesNotMatch(identityUnit,/ExecStart=.*(?:sh -c|bash -c)/);
 assert.match(identityHelper,/control_managed_sites/); assert.doesNotMatch(identityHelper,/\/usr\/sbin\/groupadd/); assert.match(identityHelper,/\/usr\/sbin\/useradd/); assert.match(identityHelper,/--no-create-home/); assert.match(identityHelper,/--user-group/); assert.match(identityHelper,/--gid/); assert.match(identityHelper,/--no-user-group/); assert.match(identityHelper,/posix_getgrnam/); assert.match(identityHelper,/bypass_shell/);
 assert.match(identityReconcile,/AWH_IDENTITY_RETRY_SECONDS\s*=\s*600/); assert.match(identityReconcile,/AWH_IDENTITY_MAX_PER_TICK\s*=\s*4/); assert.match(identityReconcile,/control_managed_sites/); assert.match(identityReconcile,/awh-hosting-identity@\*\.service/); assert.match(identityReconcile,/reset-failed/); assert.match(identityReconcile,/awh-useradd-proxy\.php/); assert.match(identityReconcile,/hash_equals\(\$proxyHash,\s*\$useraddHash\)/); assert.match(identityReconcile,/array_slice\(\$matches,\s*0,\s*AWH_IDENTITY_MAX_PER_TICK\)/); assert.doesNotMatch(identityReconcile,/(?:^|[^\w>:])(?:shell_exec|exec|passthru|system)\s*\(/m);
 assert.match(service,/BindReadOnlyPaths=.*awh-useradd-proxy\.php:\/usr\/sbin\/useradd/); assert.match(useraddProxy,/awh-hosting-identity@/); assert.match(useraddProxy,/\/bin\/systemctl/); assert.doesNotMatch(useraddProxy,/shell_exec|exec\(|passthru|system\(/);
 assert.match(remoteText,/awh-hosting-identity@\.service/); assert.match(remoteText,/awh-hosting-identity-reconcile\.php/); assert.match(local,/awh-hosting-identity@\.service/); assert.match(local,/awh-hosting-identity-reconcile\.php/); assert.match(remoteText,/if test \"\$PLATFORM_HARDENING\" = 1; then[\s\S]*stage HOSTING_IDENTITY_RECONCILE/);
 assert.doesNotMatch(operator,/reconcileFailedSiteIdentities/); assert.doesNotMatch(operator,/IDENTITY_RECONCILE_FAILED/);
 assert.match(timer,/OnActiveSec=5s/); assert.match(operator,/is_file\(\$release\.'\/package\.json'\)\&\&\$this->nodeEntry\(\$release\)!==null\)return 'NODE'/); assert.doesNotMatch(operator,/if\(is_file\(\$release\.'\/package\.json'\)\)return 'NODE'/); assert.match(operator,/hosting\.site\.bind_domain/); assert.match(operator,/DOMAIN_DNS_NOT_READY/); assert.match(operator,/DOMAIN_ROUTE_CONFLICT/); assert.match(operator,/certbot/); assert.match(operator,/--deploy-hook/); assert.match(operator,/renderDomainHttps/); assert.match(operator,/UPDATE control_managed_sites SET public_mode='DOMAIN'/); assert.match(operator,/awh-domain-/); assert.match(timer,/OnUnitActiveSec=30s/); assert.match(operator,/does match certificate/); assert.match(operator,/letsencrypt\/live/); assert.match(operator,/hosting\.tls\.renewal/); assert.match(operator,/is-enabled[^\n]*certbot\.timer/); assert.match(operator,/is-active[^\n]*certbot\.timer/); assert.match(hostingJs,/HTTPS และการต่ออายุ/); assert.match(hostingJs,/ต่ออายุอัตโนมัติพร้อม/); assert.match(build,/asset\('hosting\.html'\)/); assert.match(verifier,/'hosting\.html'/);
 assert.match(ownerCenter,/URLSearchParams\(window\.location\.search\)/); assert.match(ownerCenter,/window\.location\.hash === '#source'/); assert.match(hostingHtml,/id="site-url-preview"/); assert.doesNotMatch(hostingHtml,/hosting-confirm/); assert.match(hostingHtml,/id="hosting-ecosystem"/); assert.match(hostingHtml,/กรอกเพียง 3 อย่าง/); assert.match(hostingHtml,/รายละเอียดระบบ/); assert.doesNotMatch(hostingHtml,/OWNER · WEB|QUICK CREATE|MY WEBSITES|Hosting Operator|Internal port|Production|Rollback|Deploy/); assert.match(hostingJs,/renderUrlPreview/); assert.match(hostingJs,/site\.source\?\.ready===true/); assert.match(hostingJs,/renderEcosystem/); assert.match(hostingJs,/site\.lastEvent/); assert.match(hostingJs,/sourceInstruction/); assert.match(hostingJs,/owner-center\.html\?project=/); assert.match(hostingJs,/ตั้งค่าแหล่งเว็บไซต์/); assert.doesNotMatch(hostingJs,/เลือกไฟล์เว็บไซต์/); assert.match(ownerCenter,/Source Authority ใช้ได้เฉพาะ Owner/); assert.match(ownerCenter,/canonicalVaultReady/); assert.match(hostingJs,/ไฟล์ต้นทาง: พร้อม/); assert.match(hostingJs,/friendlyError/); assert.match(hostingJs,/กำลังเชื่อมชื่อเว็บ/); assert.match(hostingJs,/bindManagedSiteDomain/); assert.match(hostingJs,/needsLiveRefresh/); assert.match(hostingJs,/refreshHostingData/); assert.match(hostingJs,/visibilitychange/); assert.match(hostingJs,/clearTimeout\(liveRefreshTimer\)/); assert.doesNotMatch(hostingJs,/confirmAction|pendingConfirm|confirmationRequired/); assert.doesNotMatch(hostingJs,/requestStepUp|stepUp\(|hosting-stepup-password/); assert.match(trustPolicy,/hosting\.site\.create/); assert.match(trustPolicy,/hosting\.site\.deploy/); assert.match(trustPolicy,/account\.user\.access/);
});

test('M17 PHP authority and web package are regression-checked',async()=>{
 const php=await execFileAsync('php',['hub/tests/m17-account-hosting.php'],{cwd:root});
 assert.match(php.stdout,/AWH M17 Account Hosting: PASS/);
 const adoption=await execFileAsync('php',['hub/tests/m17-domain-adoption.php'],{cwd:root});
 assert.match(adoption.stdout,/AWH M17 Domain Adoption: PASS/);
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
  await mkdir(join(dir,'hub','bin'),{recursive:true});
  await mkdir(join(dir,'config'));
  await writeFile(join(dir,'hub','bin','D.php'),"<?php\n$path = dirname(__DIR__, 2) . '/config/policy.json';\n",'utf8');
  await writeFile(join(dir,'config','policy.json'),"{\"schemaVersion\":1}\n",'utf8');
  let stderr='';
  try { await execFileAsync(process.execPath,[verifier,dir,'A.php']); }
  catch(error){ stderr=String((error as {stderr?:string}).stderr??''); }
  assert.match(stderr,/CONTROL_BUNDLE_CLOSURE_FAILED A\.php -> unbundled B\.php/);
  let dirnameStderr='';
  try { await execFileAsync(process.execPath,[verifier,dir,'bin/C.php']); }
  catch(error){ dirnameStderr=String((error as {stderr?:string}).stderr??''); }
  assert.match(dirnameStderr,/CONTROL_BUNDLE_CLOSURE_FAILED bin\/C\.php -> unbundled B\.php/);
  let runtimeDataStderr='';
  try { await execFileAsync(process.execPath,[verifier,dir,'hub/bin/D.php']); }
  catch(error){ runtimeDataStderr=String((error as {stderr?:string}).stderr??''); }
  assert.match(runtimeDataStderr,/CONTROL_BUNDLE_CLOSURE_FAILED hub\/bin\/D\.php -> unbundled runtime data config\/policy\.json/);
  const pass=await execFileAsync(process.execPath,[verifier,dir,'A.php','B.php','bin/C.php','hub/bin/D.php','config/policy.json']);
  assert.match(pass.stdout,/CONTROL_BUNDLE_CLOSURE=PASS files=5/);
 } finally { await rm(dir,{recursive:true,force:true}); }
});


test('browser preserves typed legacy step-up errors but current Owner flows do not prompt again',async()=>{
 const fetchImpl=async()=>new Response(JSON.stringify({schemaVersion:1,error:'ERROR',code:'STEP_UP_REQUIRED',requestId:'fixture'}),{status:403,headers:{'Content-Type':'application/json'}});
 await assert.rejects(controlRequest('/api/v1/control/provider/credential',{method:'POST',body:'{}'},fetchImpl),error=>error instanceof Error && error.message==='รายการความเสี่ยงสูงนี้ต้องยืนยันตัวตนผู้ดูแลเพิ่มเติม' && (error as Error & {code?:string}).code==='STEP_UP_REQUIRED' && !error.message.includes('STEP_UP_REQUIRED'));
 const [hosting,app]=await Promise.all([readFile(join(root,'web/hosting.js'),'utf8'),readFile(join(root,'web/app.js'),'utf8')]);
 assert.doesNotMatch(hosting,/requestStepUp|stepUp\(|confirmationRequired|hosting-confirm|confirmAction|pendingConfirm/);
 assert.match(app,/withPrivilegedRetry/);
 assert.match(app,/withPrivilegedRetry\(action\) \{ return action\(\); \}/);
 assert.doesNotMatch(app,/เปิดโหมดผู้ดูแลขั้นสูง|pendingPrivilegedAction|step-up-password/);
});
