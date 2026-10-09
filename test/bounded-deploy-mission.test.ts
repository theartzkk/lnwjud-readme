import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalMainFromObserved, deployEvidenceFromResult, desktopImpactForFiles, desktopReleaseRequested, failureEvidenceDocument, localOperatorInvocation, missionModeFromArgs, postDeployIdentityForMode, productionStateForRefs, sanitizeFailureDiagnostic, supersedeFailureEvidence } from '../scripts/ops/bounded-deploy-mission.mjs';
import { hydrateDesktopReleaseArtifacts, verifyDesktopReleaseArtifacts } from '../scripts/release/hydrate-desktop-release-artifacts.mjs';

test('desktop impact detection still identifies native-agent-affecting source changes',()=>{
  assert.equal(desktopImpactForFiles(['hub/src/HubControlPlaneService.php','scripts/ops/example.mjs']),false);
  assert.equal(desktopImpactForFiles(['desktop/index.html']),true);
  assert.equal(desktopImpactForFiles(['src/worker-capability-discovery.ts']),false);
  assert.equal(desktopImpactForFiles(['src/config.ts']),true);
  assert.equal(desktopImpactForFiles(['src/control-plane-worker-runtime.ts']),true);
  assert.equal(desktopImpactForFiles(['package-lock.json']),true);
});

test('durable candidate clones resolve canonical main from exact remote ref when no local main ref exists',()=>{
  const local='a'.repeat(40); const remote='b'.repeat(40);
  assert.equal(canonicalMainFromObserved(local,''),local);
  assert.equal(canonicalMainFromObserved('',`${remote}\trefs/heads/main\n`),remote);
  assert.throws(()=>canonicalMainFromObserved('','refs/heads/main'),/MISSION_CANONICAL_MAIN_UNRESOLVED/);
  assert.throws(()=>canonicalMainFromObserved('',`${remote}\trefs/heads/not-main\n`),/MISSION_CANONICAL_MAIN_UNRESOLVED/);
});

test('bounded deploy mission observes canonical remote main before stale local refs',async()=>{
  const source=await readFile(new URL('../scripts/ops/bounded-deploy-mission.mjs',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('async function canonicalMainSha(){'),source.indexOf('async function operatorRequest'));
  assert.ok(fn.indexOf("ls-remote")<fn.indexOf("rev-parse"));
});

test('bounded deploy mission has one explicit owner approval and a deterministic default deploy mode',()=>{
  assert.equal(missionModeFromArgs([]),'--platform-hardening');
  assert.equal(missionModeFromArgs(['--identity-convergence']),'--identity-convergence');
  assert.equal(missionModeFromArgs(['--cloud-first']),'--cloud-first');
  assert.throws(()=>missionModeFromArgs(['--cloud-first','--project-source-authority']),/MISSION_MODE_AMBIGUOUS/);
});

test('AWH runtime and VPS Platform production are independent release lineages',()=>{
  const head='f'.repeat(40); const old='e'.repeat(40);
  assert.deepEqual(productionStateForRefs('--awh-core',head,{'runtime/production':head,production:old}),{
    baseSha:head,allCurrent:false,trackRef:'production',trackSha:old,runtimeSha:head,
  });
  assert.deepEqual(productionStateForRefs('--awh-core',head,{'runtime/production':old,production:head}),{
    baseSha:old,allCurrent:false,trackRef:'production',trackSha:head,runtimeSha:old,
  });
  assert.deepEqual(productionStateForRefs('--platform-hardening',head,{'runtime/production':old,production:old}),{
    baseSha:old,allCurrent:false,trackRef:'platform/production',trackSha:null,runtimeSha:old,
  });
  assert.deepEqual(productionStateForRefs('--platform-hardening',head,{'runtime/production':old,'platform/production':head,production:old}),{
    baseSha:head,allCurrent:true,trackRef:'platform/production',trackSha:head,runtimeSha:old,
  });
  assert.deepEqual(productionStateForRefs('--platform-hardening',head,{'runtime/production':old,'platform/production':old,production:old}),{
    baseSha:old,allCurrent:false,trackRef:'platform/production',trackSha:old,runtimeSha:old,
  });
});

test('VPS Platform post-deploy identity uses platform/production instead of AWH public release.json',()=>{
  const head='f'.repeat(40); const old='e'.repeat(40);
  const platformState=productionStateForRefs('--platform-hardening',head,{'runtime/production':old,'platform/production':head,production:old});
  const identity=postDeployIdentityForMode('--platform-hardening',head,platformState,{releaseId:'awh-old',sourceSha:old,sourceState:'COMMITTED'});
  assert.equal(identity.pass,true);
  assert.equal(identity.authority,'platform/production');
  assert.equal(identity.sourceSha,head);
  assert.equal(identity.sourceState,'COMMITTED');
  const stalePlatform=productionStateForRefs('--platform-hardening',head,{'runtime/production':old,'platform/production':old,production:old});
  assert.equal(postDeployIdentityForMode('--platform-hardening',head,stalePlatform,{sourceSha:head,sourceState:'COMMITTED'}).pass,false);
});

test('AWH post-deploy identity still requires the public release to match exact source',()=>{
  const head='f'.repeat(40); const old='e'.repeat(40);
  const state=productionStateForRefs('--awh-core',head,{'runtime/production':head,production:head});
  assert.equal(postDeployIdentityForMode('--awh-core',head,state,{releaseId:'awh-head',sourceSha:head,sourceState:'COMMITTED'}).pass,true);
  assert.equal(postDeployIdentityForMode('--awh-core',head,state,{releaseId:'awh-old',sourceSha:old,sourceState:'COMMITTED'}).pass,false);
});

test('core/web release reuses verified desktop lineage unless desktop publication is explicitly requested',()=>{
  assert.equal(desktopReleaseRequested([]),false);
  assert.equal(desktopReleaseRequested(['--platform-hardening']),false);
  assert.equal(desktopReleaseRequested(['--desktop-agent-release']),true);
  assert.equal(desktopReleaseRequested(['--platform-hardening','--desktop-agent-release']),true);
});

test('failed deploy evidence retains exact terminal stage and rollback proof after transient cleanup',()=>{
  const evidence=deployEvidenceFromResult({
    code:1,
    tail:'DEPLOY_STAGE=PLATFORM_SENSOR_READY\nDEPLOY_STAGE=SOURCE_DRIFT_VERIFY\nDEPLOY_DIAGNOSTIC=SOURCE_DRIFT_FINDINGS_2\nDEPLOY_FAILED_AT=SOURCE_DRIFT_VERIFY\nROLLBACK=PASS\n',
    stdoutTail:'DEPLOY_STAGE=SOURCE_DRIFT_VERIFY\nDEPLOY_FAILED_AT=SOURCE_DRIFT_VERIFY\nROLLBACK=PASS\n',
    stderrTail:'DEPLOY_DIAGNOSTIC=SOURCE_DRIFT_FINDINGS_2\n',
  });
  assert.deepEqual(evidence,{
    status:'FAIL',exitCode:1,stage:'SOURCE_DRIFT_VERIFY',failureCode:'SOURCE_DRIFT_FINDINGS_2',
    stdoutTail:'DEPLOY_STAGE=SOURCE_DRIFT_VERIFY\nDEPLOY_FAILED_AT=SOURCE_DRIFT_VERIFY\nROLLBACK=PASS\n',
    stderrTail:'DEPLOY_DIAGNOSTIC=SOURCE_DRIFT_FINDINGS_2\n',rollbackState:'PASS',
  });
});

test('bounded release failure evidence is durable and redacts sensitive diagnostics',()=>{
  const diagnostic=sanitizeFailureDiagnostic('Verified production desktop manifest is unavailable\nAuthorization: Bearer top-secret\nDEPLOY_FAILED_AT=MANIFEST_REUSE');
  assert.match(diagnostic,/Verified production desktop manifest is unavailable/);
  assert.match(diagnostic,/DEPLOY_FAILED_AT=MANIFEST_REUSE/);
  assert.doesNotMatch(diagnostic,/Authorization|top-secret/);
  const doc=failureEvidenceDocument('MISSION_REHEARSAL_FAILED',{
    releaseTrack:'vps-platform',
    releaseSha:'a'.repeat(40),
    executionId:'12345678-1234-4abc-8abc-1234567890ab',
    rehearsal:{exitCode:1,stdoutTail:'M23_TARGET=local',stderrTail:'password=must-not-persist\nMissing reviewed M4 asset: example'},
  },'2026-10-02T00:00:00.000Z');
  assert.equal(doc.failureCode,'MISSION_REHEARSAL_FAILED');
  assert.equal(doc.rehearsal?.exitCode,1);
  assert.match(doc.rehearsal?.stderrTail??'',/Missing reviewed M4 asset/);
  assert.doesNotMatch(doc.rehearsal?.stderrTail??'',/password|must-not-persist/i);
});

test('verified release success supersedes stale failure evidence instead of leaving a misleading last failure',async()=>{
  const root=await mkdtemp(join(tmpdir(),'awh-failure-evidence-'));
  try{
    const name='vps-platform-release-failure.last';
    await writeFile(join(root,name),JSON.stringify({schemaVersion:1,kind:'bounded-release-failure',releaseTrack:'vps-platform',releaseSha:'a'.repeat(40),failureCode:'OLD_FAILURE',observedAt:'2026-10-03T01:00:00.000Z'})+'\n');
    const result=await supersedeFailureEvidence('vps-platform','b'.repeat(40),{root,observedAt:'2026-10-03T03:20:00.000Z'});
    assert.equal(result.state,'SUPERSEDED');
    await assert.rejects(readFile(join(root,name),'utf8'));
    const archived=JSON.parse(await readFile(result.archived,'utf8'));
    assert.equal(archived.failureCode,'OLD_FAILURE');
    assert.equal(result.releaseSha,'b'.repeat(40));
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('root core release demotes typed operator calls to the guarded awh-remote identity',()=>{
  assert.deepEqual(localOperatorInvocation('/usr/local/bin/awh-operator',['verification-regressions'],{uid:0}),{
    command:'/usr/sbin/runuser',
    args:['-u','awh-remote','--','/usr/local/bin/awh-operator','verification-regressions'],
    identity:'awh-remote',
  });
  assert.deepEqual(localOperatorInvocation('/usr/local/bin/awh-operator',['verification-regressions'],{uid:987}),{
    command:'/usr/local/bin/awh-operator',
    args:['verification-regressions'],
    identity:'current',
  });
});

test('mission contract preserves QA, rehearsal, backup, drift and public exact-revision proof',async()=>{
  const source=await readFile(new URL('../scripts/ops/bounded-deploy-mission.mjs',import.meta.url),'utf8');
  assert.match(source,/node:child_process/);
  assert.match(source,/ls-remote/);
  assert.match(source,/platform\/production/);
  assert.match(source,/productionStateForRefs/);
  const operatorSource=await readFile(new URL('../hub/src/HubCoreReleaseOperator.php',import.meta.url),'utf8');
  assert.match(operatorSource,/'rev-parse',\$productionRef/);
  assert.match(operatorSource,/merge-base','--is-ancestor',\$sha,\$runtimeProduction/);
  assert.match(operatorSource,/'update-ref',\$productionRef,\$sha,\$trackProduction/);
  assert.match(operatorSource,/CORE_RELEASE_RUNTIME_DIVERGED/);
  assert.match(operatorSource,/TRACK_RECONCILED/);
  assert.match(source,/branch\.main\.remote/);
  assert.doesNotMatch(source,/refs\/heads\/production','refs\/remotes\/vps\/production/);
  assert.match(source,/new URL\('\/api\/v1\/auth\/login',base\)/);
  assert.doesNotMatch(source,/new URL\('\/api\/v1\/control\/auth\/login',base\)/);
  assert.match(source,/state:'BLOCKED',result:'BLOCK'/);
  assert.match(source,/MISSION_REGRESSION_REPLAY=\$\{durableNeedsDeep\?'DEEP':'BOUNDED'\}/);
  assert.match(source,/deepChecks=new Set\(\['repeat-regression','backup-proof','rollback-proof','source-drift','database-integrity'\]\)/);
  assert.match(source,/MISSION_DURABLE_REGISTRY_UNAVAILABLE/);
  assert.match(source,/loadExecutionPolicy/);
  assert.match(source,/qaScriptForBudget/);
  assert.match(source,/async function ensureRehearsalDependencies\(policy\)/);
  assert.match(source,/MISSION_REHEARSAL_DEPENDENCIES=HYDRATING/);
  assert.match(source,/npm',\['ci','--ignore-scripts','--no-audit','--no-fund','--prefer-offline'\]/);
  assert.match(source,/MISSION_REHEARSAL_DEPENDENCIES=HYDRATED/);
  assert.doesNotMatch(source,/budget==='FAST'\?'qa:fast':'qa:local'/);
  assert.match(source,/AWH_OPERATOR_CLIENT.*\/usr\/local\/bin\/awh-operator/);
  assert.match(source,/awh-remote.*\/usr\/local\/bin\/awh-operator/);
  assert.match(source,/for\(let attempt=1;attempt<=3;attempt\+\+\)/);
  const localStart=source.indexOf("if(existsSync(local)){");
  const sshFallback=source.indexOf("const host=await canonicalOperatorHost()",localStart);
  assert.ok(localStart>=0&&sshFallback>localStart&&source.slice(localStart,sshFallback).includes('return null;'),'VPS-local operator failure must fail closed instead of self-SSH fallback');
  for(const marker of ['MISSION_PRIVILEGE_LANE=','MISSION_DEPENDENCIES=ISOLATED_QA','MISSION_ISOLATED_QA_RUNNER_MISSING','MISSION_CANONICAL_MAIN_STABLE=','verificationPlanForFiles','MISSION_RISK=','MISSION_VERIFICATION_BUDGET=','MISSION_STABILITY=','MISSION_GOLDEN_JOURNEYS=','MISSION_EVIDENCE_CAPSULE=','MISSION_DURABLE_REGISTRY=','MISSION_DURABLE_EVIDENCE=','verification-regressions','verification-store','MISSION_INCIDENT_FINGERPRINT=','--dry-run','--deploy','--approve','DEPLOY_STAGE=BACKUP_VERIFIED','DEPLOY_STAGE=SOURCE_DRIFT_VERIFIED','MISSION_APPROVALS_CONSUMED=1','MISSION_PUBLIC_VERIFY=PASS','AWH_REUSE_REMOTE_DESKTOP_ARTIFACTS','RELEASE_QA_STARTED','RELEASE_REHEARSAL_PASSED','RELEASE_CUTOVER_WAIT','RELEASE_FINALIZE','deploy-execution-authority.php']) assert.match(source,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});


test('KRUART Engineering Eval catalog is durable, unique and cross-project',async()=>{
  const catalog=JSON.parse(await readFile(new URL('../config/kruart-engineering-eval.json',import.meta.url),'utf8'));
  assert.equal(catalog.schemaVersion,1); assert.equal(catalog.name,'KRUART Engineering Eval');
  assert.ok(Array.isArray(catalog.scenarios)&&catalog.scenarios.length>=20);
  const ids=catalog.scenarios.map((row)=>row.id); assert.equal(new Set(ids).size,ids.length);
  for(const project of ['AWH','BAY EXCUSE X','BAY LearnLab','School Website']) assert.ok(catalog.scenarios.some((row)=>row.project===project));
  for(const row of catalog.scenarios){assert.match(row.id,/^[a-z0-9-]+$/);assert.ok(['MEDIUM','HIGH','CRITICAL'].includes(row.risk));assert.ok(Array.isArray(row.triggerPatterns)&&row.triggerPatterns.length>0);assert.ok(typeof row.evidence==='string'&&row.evidence.length>12);}
});


test('desktop artifact hydration accepts only exact-SHA verified staged packages',async()=>{
  const sourceSha='a'.repeat(40);
  const root=await mkdtemp(join(tmpdir(),'awh-artifact-hydration-'));
  const stagingRoot=join(root,'stage');
  const staged=join(stagingRoot,sourceSha);
  const sourceRoot=join(root,'source');
  await mkdir(staged,{recursive:true}); await mkdir(sourceRoot,{recursive:true});
  const targets=[
    ['AWH-macOS-arm64.zip','darwin','arm64'],
    ['AWH-macOS-x64.zip','darwin','x64'],
    ['AWH-Windows-x64.zip','win32','x64'],
  ];
  const sums=[];
  for(const [file,platform,architecture] of targets){
    const bytes=Buffer.from(`verified-${platform}-${architecture}-${sourceSha}`);
    const hash=createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(staged,file),bytes);
    await writeFile(join(staged,file.replace(/\.zip$/,'.release.json')),JSON.stringify({
      schemaVersion:1,kind:'AWH_DESKTOP_RELEASE_EVIDENCE',authority:'CI_PACKAGE_EVIDENCE_ONLY',productId:'awh',platform,architecture,
      productVersion:'1.0.0-rc.1',sourceSha,packageSha256:hash,sizeBytes:bytes.length,downloadKey:file,packageVerification:'VERIFIED',
      publicationState:'NOT_PUBLISHED',updaterStatus:'FOUNDATION_LOCKED_NOT_ACTIVATED',
    }));
    sums.push(`${hash}  ${file}`);
  }
  await writeFile(join(staged,'SHA256SUMS.txt'),`${sums.join('\n')}\n`);
  const stagedProof=await verifyDesktopReleaseArtifacts(staged,sourceSha);
  assert.equal(stagedProof.verified.length,3);
  const hydrated=await hydrateDesktopReleaseArtifacts({sourceRoot,sourceSha,stagingRoot});
  assert.equal(hydrated.verified.length,3);
  assert.equal((await readFile(join(sourceRoot,'dist-web/downloads/SHA256SUMS.txt'),'utf8')).trim(),sums.join('\n'));

  const evidencePath=join(staged,'AWH-macOS-arm64.release.json');
  const evidence=JSON.parse(await readFile(evidencePath,'utf8')); evidence.sourceSha='b'.repeat(40);
  await writeFile(evidencePath,JSON.stringify(evidence));
  await assert.rejects(()=>verifyDesktopReleaseArtifacts(staged,sourceSha),/DESKTOP_ARTIFACT_PROVENANCE_MISMATCH/);
});


test('platform deploy preserves AWH runtime lineage and exposes pre-mutation failures', async () => {
  const [remote,validator,service]=await Promise.all([
    readFile('deploy/awh-control-plane/remote-deploy-control-plane.sh','utf8'),
    readFile('deploy/awh-control-plane/validate-remote-output.sh','utf8'),
    readFile('hub/src/HubCoreReleaseService.php','utf8'),
  ]);
  assert.match(remote,/test "\$runtime_current" = "\$live_sha"/);
  assert.match(remote,/test "\$PLATFORM_HARDENING" = 1; then[\s\S]*stage RUNTIME_REF_PRESERVED/);
  assert.match(remote,/stage RELEASE_TRACK_REF_UPDATED/);
  assert.match(validator,/RUNTIME_REF_PRESERVED/);
  assert.match(validator,/ALLOWED_FAILURE_EXTRAS='PREPARE /);
  assert.match(service,/releaseTrack==='awh'.*!hash_equals\(\$runtime,\$sha\)/s);
});

test('AWH shared-repo release inherits only a verified current platform snapshot', async () => {
  const service=await readFile('hub/src/HubCoreReleaseService.php','utf8');
  assert.match(service,/sharedRepoDeploySnapshot/);
  assert.match(service,/sourcePromotionChainConnects/);
  assert.match(service,/releaseTrack!==\'awh\'/);
  assert.match(service,/hash_equals\(\$main,\$platform\)/);
  assert.match(service,/CANONICAL_SHARED_REPO_MAIN_VERIFIED/);
  assert.match(service,/trackPromotionSha/);
  assert.match(service,/isset\(\$seen\[\$cursor\]\)\|\|!isset\(\$byTarget\[\$cursor\]\)/);
});

test('AWH shared-repo release target is promoted to the current verified platform snapshot', async () => {
  const root=await mkdtemp(join(tmpdir(),'awh-shared-release-'));
  try{
    await mkdir(join(root,'refs/heads/platform'),{recursive:true});
    const a='1'.repeat(40),b='2'.repeat(40),c='3'.repeat(40),d='4'.repeat(40);
    await writeFile(join(root,'refs/heads/main'),`${d}\n`);
    await writeFile(join(root,'refs/heads/platform/production'),`${d}\n`);
    const servicePath=join(process.cwd(),'hub/src/HubCoreReleaseService.php');
    const php=`require ${JSON.stringify(servicePath)};
$pdo=new PDO('sqlite::memory:');
$pdo->exec("CREATE TABLE control_task_executions(project_id TEXT,required_capability TEXT,state TEXT,updated_at TEXT,execution_id TEXT,checkpoint_json TEXT)");
$add=function($target,$base,$track,$at)use($pdo){$cp=['repository'=>'awh','targetSha'=>$target,'expectedMainSha'=>$base,'missionExecutionId'=>'11111111-1111-4111-8111-111111111111','bundleSha256'=>str_repeat('a',64),'releaseNotes'=>['releaseTrack'=>$track]];$q=$pdo->prepare('INSERT INTO control_task_executions VALUES(?,?,?,?,?,?)');$q->execute([HubCoreReleaseService::PROJECT_ID,'source.promote','COMPLETED',$at,uniqid(),json_encode($cp)]);};
$add('${b}','${a}','awh','2026-01-01T00:00:01Z');$add('${c}','${b}','vps-platform','2026-01-01T00:00:02Z');$add('${d}','${c}','vps-platform','2026-01-01T00:00:03Z');
$r=new ReflectionClass(HubCoreReleaseService::class);$o=$r->newInstanceWithoutConstructor();foreach(['pdo'=>$pdo,'releaseTrack'=>'awh'] as $k=>$v){$r->getProperty($k)->setValue($o,$v);}$m=$r->getMethod('latestSourcePromotion');$match=$m->invoke($o);file_put_contents(getenv('AWH_CORE_CANONICAL_GIT').'/refs/heads/platform/production','${c}\\n');$mismatch=$m->invoke($o);echo json_encode(['match'=>$match,'mismatch'=>$mismatch]);`;
    const result=JSON.parse(execFileSync('php',['-r',php],{encoding:'utf8',env:{...process.env,AWH_CORE_CANONICAL_GIT:root}}));
    assert.equal(result.match.sha,d);
    assert.equal(result.match.trackPromotionSha,b);
    assert.equal(result.match.authority,'CANONICAL_SHARED_REPO_MAIN_VERIFIED');
    assert.equal(result.mismatch.sha,b);
    assert.equal(result.mismatch.trackPromotionSha,undefined);
    assert.equal(result.mismatch.authority,'SOURCE_PROMOTION_AUDIT');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('platform connector helper logs stay out of the strict typed deploy stream', async () => {
  const remote = await readFile('deploy/awh-control-plane/remote-deploy-control-plane.sh', 'utf8');
  assert.match(remote, /record_platform_evidence CONNECTOR_INSTALL_PASS/);
  assert.match(remote, /record_platform_evidence CONNECTOR_VERIFY_PASS/);
  assert.doesNotMatch(remote, /cat "\$CONNECTOR_INSTALL_LOG"\n/);
  assert.doesNotMatch(remote, /cat "\$CONNECTOR_VERIFY_LOG"\n/);
  assert.match(remote, /stage VPS_DIRECT_CONNECTOR_READY/);
});

test('Hatchet installer success chatter stays out of the strict typed deploy stream', async () => {
  const remote = await readFile('deploy/awh-control-plane/remote-deploy-control-plane.sh', 'utf8');
  assert.match(remote, /install-readyidc-worker\.sh" --prepare >\/dev\/null/);
  assert.match(remote, /stage HATCHET_WORKER_PREPARED/);
});

test('Hatchet execution is self-hosted, pinned, persistent and resource-scoped', async () => {
  const worker = await readFile('deploy/hatchet/worker/worker.cjs', 'utf8');
  const unit = await readFile('deploy/systemd/awh-hatchet-worker.service', 'utf8');
  const installer = await readFile('deploy/hatchet/install-readyidc-worker.sh', 'utf8');
  assert.match(worker, /HatchetEmbeddedClient/);
  assert.match(worker, /expression:"input\.resource"/);
  assert.match(worker, /existingRunExternalId/);
  assert.match(worker, /hatchet\.runs\.get_status\(existingRunExternalId\)/);
  assert.match(worker, /status==="FAILED"\|\|status==="CANCELLED"/);
  assert.match(worker, /hatchet\.runs\.replay\(\{ids:\[existingRunExternalId\]\}\)/);
  assert.match(worker, /productionMutationAuthority:false/);
  assert.match(worker, /delete process\.env\.HATCHET_CLIENT_TOKEN/);
  assert.match(unit, /AWH_HATCHET_EMBEDDED_VERSION=v0\.110\.5/);
  assert.match(unit, /AWH_HATCHET_EMBEDDED_CHECKSUM=18ddacae0005042bd982328bcb8d370cca6907352a1ab2a3c8406001d31e7dee/);
  assert.match(unit, /AWH_HATCHET_EMBEDDED_DATA_DIR=\/var\/lib\/awh-hub\/hatchet-embedded\/postgres/);
  assert.doesNotMatch(unit, /hatchet\.key/);
  assert.doesNotMatch(installer, /HATCHET_CREDENTIAL_REQUIRED/);
  assert.match(installer, /provider=embedded/);
});

test('control-plane dry-run terminates after cleanup instead of surviving SIGTERM', async () => {
  const source = await readFile('deploy/awh-control-plane/deploy-control-plane.sh', 'utf8');
  assert.match(source, /trap cleanup EXIT/);
  assert.match(source, /trap terminate HUP INT TERM/);
  assert.match(source, /exit 143/);
  assert.match(source, /AWH_RELEASE_BUILD_LOCK_ROOT/);
  assert.match(source, /\.awh-local/);
  assert.match(source, /release build lock root is not writable/);
  assert.match(source, /AWH_WEB_OUTPUT_DIR="\$WEB_OUTPUT"/);
  assert.match(source, /Cache-Control: no-cache/);
  assert.match(source, /https:\/\/\$HOSTNAME\/release\.json/);
  assert.doesNotMatch(source, /sudo -n cat \/var\/www\/awh-web\/current\/release\.json/);
  assert.match(source, /WEB_BUILD_ROOT\/\.awh-build\/awh-source\.zip/);
  assert.match(source, /ASSEMBLY_FILES/);
  assert.match(source, /tar -czf "\$BUNDLE" -C "\$ROOT" \$SOURCE_FILES -C "\$WEB_BUILD_ROOT" \$ASSEMBLY_FILES/);
  for (const required of [
    'deploy/hatchet/worker/package.json',
    'deploy/hatchet/worker/worker.cjs',
    'deploy/systemd/awh-hatchet-worker.service',
    'deploy/hatchet/install-readyidc-worker.sh',
  ]) assert.ok(source.includes(required), `VPS Platform release manifest includes ${required}`);
});
