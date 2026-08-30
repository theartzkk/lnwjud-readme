import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const run=promisify(execFile); const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');

test('Infrastructure is an Owner-only sanitized projection and canonical web surface',async()=>{
 const output=await mkdtemp(join(tmpdir(),'awh-infra-web-'));
 try{
  await run(process.execPath,['--import','tsx','scripts/build-web-preview.ts','--control'],{cwd:ROOT,shell:false,env:{...process.env,AWH_WEB_RELEASE_ID:'infra-fixture',AWH_WEB_OUTPUT_DIR:output,AWH_PREVIEW_GENERATED_AT:'2026-08-28T00:00:00.000Z'}});
  await run(process.execPath,['scripts/create-web-release-manifest.mjs',output],{cwd:ROOT,shell:false,env:{...process.env,AWH_RELEASE_ID:'infra-fixture',AWH_PREVIEW_GENERATED_AT:'2026-08-28T00:00:00.000Z'}});
  const [html,css,js,router,service,collector,deploy,executor,manifest,sw,webVerifier]=await Promise.all(['infrastructure.html','infrastructure.css','infrastructure.js'].map(f=>readFile(join(output,f),'utf8')).concat([
   readFile(join(ROOT,'hub/src/HubControlPlaneRouter.php'),'utf8'),readFile(join(ROOT,'hub/src/HubControlPlaneService.php'),'utf8'),readFile(join(ROOT,'hub/bin/system-telemetry.php'),'utf8'),readFile(join(ROOT,'deploy/awh-control-plane/deploy-control-plane.sh'),'utf8'),readFile(join(ROOT,'hub/bin/awh-native-executor.php'),'utf8'),readFile(join(ROOT,'scripts/create-web-release-manifest.mjs'),'utf8'),readFile(join(ROOT,'web/sw.js'),'utf8'),readFile(join(ROOT,'deploy/awh-control-plane/verify-web-release.php'),'utf8')
  ]) as Promise<string[]>);
  const automation=await readFile(join(ROOT,'web/automation-surface.js'),'utf8');
  await run(process.execPath,['--check',join(output,'dashboard.js')],{cwd:ROOT,shell:false});
  assert.match(automation,/^\(\(\) => \{/m); assert.match(automation,/\}\)\(\);\s*$/);
  assert.match(html,/ศูนย์ควบคุมระบบ/); assert.match(html,/DOMAINS & SSL/); assert.match(html,/Production Complete/); assert.match(html,/AUTONOMOUS AI 24\/7/); assert.match(html,/Models · Health · Fallback/); assert.match(html,/STAFF CONTROL LOOP/); assert.match(html,/MORNING BRIEF/); assert.match(html,/STORAGE & GARBAGE CENTER/); assert.match(css,/--accent:#ff7a1a/); assert.match(css,/checklist-grid/); assert.match(js,/\/api\/v1\/control\/infrastructure/);
  for(const projection of ['productionComplete','aiModels','autonomousWork','incidents','stagedCandidates','staff','governor','selfHealing','executionTriage','CURRENT_DEFECT','BLOCKED_CAPABILITY','morningBrief','storageGovernance','managedSites','hostingCenter','UNKNOWN']) assert.match(js,new RegExp(projection));
  assert.match(js,/stateLabel/); assert.match(js,/progressLabel/); assert.doesNotMatch(js,/Number\(event\.progress\|\|0\)/);
  assert.match(router,/\/api\/v1\/control\/infrastructure/); assert.match(service,/assertOwner\(\$userId\)/); assert.match(service,/HubInfrastructureService::fromEnvironment/); assert.match(service,/HubInfrastructureService::releaseState/);
  for(const authority of ['control_ai_route_decisions','control_task_executions','control_task_events']) assert.match(service,new RegExp(authority));
  assert.match(service,/'productionComplete'/); assert.match(service,/HubStaffOperationsService/); assert.doesNotMatch(service,/CREATE TABLE|ALTER TABLE/);
  assert.doesNotMatch(`${html}\n${js}`,/localStorage|sessionStorage|Authorization|Bearer\s|shell_exec|<textarea[^>]*(?:terminal|command)|innerHTML/i);
  assert.doesNotMatch(collector,/shell_exec\s*\(|\bexec\s*\(|\bsystem\s*\(/);
  const release=JSON.parse(await readFile(join(output,'release.json'),'utf8')) as {files:Array<{path:string}>};
  for(const entry of release.files) assert.ok(deploy.includes(`dist-web/${entry.path}`),`deployment missing manifest web asset ${entry.path}`);
  for(const asset of ['dist-web/awh-design-system.css','dist-web/responsive-layout.css','dist-web/infrastructure.html','dist-web/infrastructure.css','dist-web/infrastructure.js','hub/bin/system-telemetry.php','hub/src/HubInfrastructureService.php','hub/src/HubExecutionTriageService.php','hub/src/HubStaffGovernorService.php','hub/src/HubStaffOperationsService.php','hub/src/HubStorageGovernanceService.php','deploy/awh-control-plane/verify-web-release.php']) assert.ok(deploy.includes(asset),`deployment missing ${asset}`);
  assert.match(executor,/telemetryRefreshIfStale\(null, 60\)/); assert.match(executor,/'telemetry' => \$telemetry/); assert.match(executor,/HubStaffGovernorService/); assert.match(executor,/materializeStaffMaintenanceSubmission/); assert.match(executor,/HubStaffOperationsService/); assert.match(executor,/persistMorningBrief/); assert.match(executor,/'recovered'/);
  assert.doesNotMatch(deploy,/awh-system-telemetry\.(?:service|timer)/);
  const remote=await readFile(join(ROOT,'deploy/awh-control-plane/remote-deploy-control-plane.sh'),'utf8');
  assert.match(remote,/test -r "\$WEB_RELEASE\/awh-design-system\.css"/);
  assert.match(remote,/test -r "\$WEB_RELEASE\/responsive-layout\.css"/);
  assert.match(remote,/Shared responsive-width contract/);
  assert.match(remote,/--awh-font-sans/);
  assert.match(remote,/design_system_code=.*awh-design-system\.css/);
  assert.match(remote,/test "\$design_system_code" = 200/);
  assert.match(remote,/verify-web-release\.php" "\$WEB_RELEASE"/);
  assert.doesNotMatch(webVerifier,/shell_exec|\bexec\s*\(|\bsystem\s*\(|passthru|proc_open/i);
  const verified=await run('php',[join(ROOT,'deploy/awh-control-plane/verify-web-release.php'),output],{cwd:ROOT,shell:false}); assert.match(verified.stdout,/WEB_RELEASE_MANIFEST=PASS/);
  await writeFile(join(output,'awh-design-system.css'),'tampered');
  await assert.rejects(run('php',[join(ROOT,'deploy/awh-control-plane/verify-web-release.php'),output],{cwd:ROOT,shell:false}));
  assert.match(remote,/HubInfrastructureService\.php/); assert.match(remote,/system-telemetry\.php/);
  assert.match(remote,/infrastructure_html_code=.*infrastructure\.html/);
  assert.match(remote,/infrastructure_code=.*\/api\/v1\/control\/infrastructure/);
  assert.doesNotMatch(remote,/awh-system-telemetry\.(?:service|timer)/);
  for(const asset of ['infrastructure.html','infrastructure.css','infrastructure.js']) assert.ok(manifest.includes(`'${asset}'`),`release manifest missing ${asset}`);
  assert.match(sw,/\.\/infrastructure\.html/); assert.match(sw,/\.\/database\.html/);
 }finally{await rm(output,{recursive:true,force:true});}
});

test('Infrastructure telemetry service accepts a bounded snapshot without exposing its path',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'awh-infra-snapshot-')); const snapshot=join(dir,'snapshot.json');
 try{
  const fixture={schemaVersion:1,generatedAt:'2026-08-28T15:00:00Z',host:{name:'awh-hub-01',os:'Ubuntu 24.04.4 LTS',uptimeSeconds:3600},cpu:{usedPercent:3.2,load1:0.01,load5:0.02,load15:0.03},memory:{totalBytes:2000000000,availableBytes:1500000000,usedBytes:500000000,usedPercent:25},swap:{totalBytes:2000000000,usedBytes:0,usedPercent:0},storage:{totalBytes:30000000000,freeBytes:14000000000,usedBytes:16000000000,usedPercent:53.3},services:[{key:'nginx',label:'Web Server',state:'ACTIVE',startup:'ENABLED'},{key:'backup',label:'Automatic Backup',state:'INACTIVE',startup:'DISABLED'}],domains:[{name:'157-85-108-142.sslip.io',tls:true,certificateExpiresAt:'2026-11-01T00:00:00Z',certificateDaysRemaining:64}],security:{fail2ban:'ACTIVE',automaticUpdates:'ACTIVE'}};
  await writeFile(snapshot,JSON.stringify(fixture));
  const code=`require ${JSON.stringify(join(ROOT,'hub/src/HubInfrastructureService.php'))}; $s=new HubInfrastructureService(${JSON.stringify(snapshot)}); echo json_encode($s->status('2026-08-28T15:00:30Z'));`;
  const {stdout}=await run('php',['-r',code],{cwd:ROOT,shell:false}); const value=JSON.parse(stdout);
  assert.equal(value.state,'READY'); assert.equal(value.server.host.name,'awh-hub-01'); assert.equal(value.server.domains[0].tls,true); assert.equal(value.server.services[1].startup,'DISABLED');
  assert.doesNotMatch(stdout,/snapshot\.json|\/tmp\/|secret|password/i);
 }finally{await rm(dir,{recursive:true,force:true});}
});
