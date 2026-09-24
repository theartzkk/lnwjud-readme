import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const ROOT=process.cwd();

test('Update Center reuses canonical release authorities instead of creating a parallel deploy engine', async()=>{
  const [service,router,hosting,adapter,page,script]=await Promise.all([
    readFile(join(ROOT,'hub/src/HubControlPlaneService.php'),'utf8'),
    readFile(join(ROOT,'hub/src/HubControlPlaneRouter.php'),'utf8'),
    readFile(join(ROOT,'hub/src/HubManagedHostingService.php'),'utf8'),
    readFile(join(ROOT,'web/control-plane-adapter.js'),'utf8'),
    readFile(join(ROOT,'web/updates.html'),'utf8'),
    readFile(join(ROOT,'web/updates.js'),'utf8'),
  ]);
  assert.match(router,/\/api\/v1\/control\/updates/);
  assert.match(service,/updateCenterForSession/);
  assert.match(service,/coreReleases->status/);
  assert.match(service,/hosting->sites/);
  assert.match(service,/workersForUser/);
  assert.match(service,/HubInfrastructureService::releaseState/);
  assert.match(service,/learnLabReleases->status/);
  assert.match(service,/ownerSelfServiceStatus/);
  assert.match(service,/coreStorageBlocked/);
  assert.match(service,/3221225472/);
  assert.match(service,/coreUsedPercent.*>= 90\.0/s);
  assert.match(service,/Core Release headroom/);
  assert.match(service,/releaseBlocked.*coreStorageBlocked/s);
  assert.match(service,/BASELINE_REQUIRED/);
  assert.match(service,/MIGRATION_REQUIRED/);
  for(const adapterName of ['CORE_RELEASE','BAY_UPDATE_CENTER','MANAGED_HOSTING','LEARNLAB_RELEASE','LEGACY_DEPLOY','SOURCE_ONLY','AGENT_MANAGED']) assert.match(service,new RegExp(adapterName));
  assert.match(hosting,/current_release_revision_id/);
  assert.match(hosting,/currentSourceRevisionId/);
  assert.match(adapter,/loadUpdateCenter/);
  assert.match(script,/requestCoreRelease/);
  assert.match(script,/releaseMeta/);
  assert.match(script,/รุ่นล่าสุดที่ AWH เลือกแล้ว/);
  assert.doesNotMatch(script,/อัปเดต AWH เป็น Source/);
  assert.match(script,/decideApproval/);
  assert.match(script,/managedSiteAction/);
  assert.match(script,/createBayRemoteInstallRelay/);
  assert.match(script,/relayBayRemoteCommand/);
  assert.match(script,/BAY_INSTALL_OUTCOME_UNKNOWN/);
  assert.doesNotMatch(script,/autoUpdater|setFeedURL|shell_exec|proc_open|exec\(/);
  assert.match(page,/อัปเดตทั้งหมดที่พร้อม/);
  assert.match(page,/Source เดียว/);
  assert.match(page,/Candidate เดียว/);
  assert.match(page,/รุ่นเก่าถูก supersede อัตโนมัติ/);
  assert.match(page,/Fail closed/);
  assert.match(page,/Rollback พร้อม/);
});

test('Agent visibility is version-aware but public macOS updater remains fail-closed', async()=>{
  const [service,policy,script]=await Promise.all([
    readFile(join(ROOT,'hub/src/HubControlPlaneService.php'),'utf8'),
    readFile(join(ROOT,'src/desktop-update-policy.ts'),'utf8'),
    readFile(join(ROOT,'web/updates.js'),'utf8'),
  ]);
  assert.match(service,/d\.app_version/);
  assert.match(service,/'appVersion'/);
  assert.match(service,/INTERNAL_MANAGED/);
  assert.match(script,/desktopReleases/);
  assert.match(script,/macOS native.*Internal/);
  assert.match(policy,/FOUNDATION_LOCKED_NOT_ACTIVATED/);
  assert.doesNotMatch(policy,/autoUpdater|setFeedURL/);
});

test('canonical update target registry prevents portfolio systems from disappearing silently', async()=>{
  const [registry,operator,service]=await Promise.all([
    readFile(join(ROOT,'hub/src/HubUpdateTargetRegistry.php'),'utf8'),
    readFile(join(ROOT,'hub/src/HubOperatorBridgeService.php'),'utf8'),
    readFile(join(ROOT,'hub/src/HubControlPlaneService.php'),'utf8'),
  ]);
  for(const key of ['awh','bay-excuse-x','bay-hub','bay-learnlab','school-website','bay-computer-lab']) assert.match(registry,new RegExp(key));
  assert.match(operator,/HubUpdateTargetRegistry::repositories/);
  assert.match(service,/adapter'=>'UNREGISTERED'/);
  assert.match(service,/canonical repository.*Project\/Vault/);
});

test('Update Center is a required release asset and survives the PWA build boundary', async()=>{
  const [build,releaseFiles,worker,index]=await Promise.all([
    readFile(join(ROOT,'scripts/build-web-preview.ts'),'utf8'),
    readFile(join(ROOT,'scripts/web-release-files.json'),'utf8'),
    readFile(join(ROOT,'web/sw.js'),'utf8'),
    readFile(join(ROOT,'web/index.html'),'utf8'),
  ]);
  for(const file of ['updates.html','updates.css','updates.js']){
    assert.match(build,new RegExp(file.replace('.','\\.')));
    assert.match(releaseFiles,new RegExp(file.replace('.','\\.')));
    assert.match(worker,new RegExp(file.replace('.','\\.')));
  }
  assert.match(index,/href="\.\/updates\.html"/);
  assert.match(index,/ศูนย์อัปเดต/);
  assert.match(index,/อัปเดตระบบ/);
});

test('Update Center registry is packaged into every control-plane release', async()=>{
  const [local,remote]=await Promise.all([
    readFile(join(ROOT,'deploy/awh-control-plane/deploy-control-plane.sh'),'utf8'),
    readFile(join(ROOT,'deploy/awh-control-plane/remote-deploy-control-plane.sh'),'utf8'),
  ]);
  assert.match(local,/hub\/src\/HubUpdateTargetRegistry\.php/);
  assert.match(remote,/RELEASE\/hub\/src\/HubUpdateTargetRegistry\.php/);
});

test('Update Center mobile surface stays light and legacy baselines remain fail-closed', async()=>{
  const [css,service,learnLab,script]=await Promise.all([
    readFile(join(ROOT,'web/updates.css'),'utf8'),
    readFile(join(ROOT,'hub/src/HubControlPlaneService.php'),'utf8'),
    readFile(join(ROOT,'hub/src/HubLearnLabReleaseService.php'),'utf8'),
    readFile(join(ROOT,'web/updates.js'),'utf8'),
  ]);
  assert.match(css,/html,body\{min-height:100%;background:#f3f8ff!important\}/);
  assert.match(service,/state = 'BASELINE_REQUIRED'/);
  assert.match(service,/actionable'=>\$state==='UPDATE_AVAILABLE'/);
  assert.match(service,/adapter'=>'LEARNLAB_RELEASE'/);
  assert.match(service,/state'=>'MIGRATION_REQUIRED'/);
  assert.match(learnLab,/publishedAt/);
  assert.match(script,/approveLearnLab/);
  assert.match(script,/ออฟไลน์\/ข้อมูลเก่า/);
});


test('central update authority exposes one latest candidate and supersedes stale pending releases safely', async()=>{
  const [service,core,learnLab,assessment,router,script]=await Promise.all([
    readFile(join(ROOT,'hub/src/HubControlPlaneService.php'),'utf8'),
    readFile(join(ROOT,'hub/src/HubCoreReleaseService.php'),'utf8'),
    readFile(join(ROOT,'hub/src/HubLearnLabReleaseService.php'),'utf8'),
    readFile(join(ROOT,'hub/src/HubAssessmentReleaseService.php'),'utf8'),
    readFile(join(ROOT,'hub/src/HubControlPlaneRouter.php'),'utf8'),
    readFile(join(ROOT,'web/updates.js'),'utf8'),
  ]);
  assert.match(service,/singleLatestCandidate'=>true/);
  assert.match(service,/AUTO_SUPERSEDE_BEFORE_LEASE/);
  assert.match(service,/humanShaRequired'=>false/);
  assert.match(service,/latestLearnLabSha/);
  assert.match(service,/candidateSha!==null.*releaseSha/s);
  for(const release of [core,learnLab,assessment]){
    assert.match(release,/supersedeQueuedReleaseIfTargetMoved/);
    assert.match(release,/state='CANCELLED'/);
    assert.match(release,/lease_owner IS NULL/);
    assert.match(release,/status='EXPIRED'/);
  }
  assert.match(core,/CORE_RELEASE_TARGET_MOVED/);
  assert.match(core,/CANONICAL_GIT_MAIN/);
  assert.match(core,/canonicalMainSha/);
  assert.match(learnLab,/LEARNLAB_RELEASE_TARGET_MOVED/);
  assert.match(learnLab,/CANONICAL_GIT_MAIN/);
  assert.match(learnLab,/canonicalMainSha/);
  assert.match(router,/CORE_RELEASE_TARGET_MOVED/);
  assert.match(router,/LEARNLAB_RELEASE_TARGET_MOVED/);
  assert.match(router,/ASSESSMENT_RELEASE_TARGET_MOVED/);
  assert.match(script,/CORE_RELEASE_TARGET_MOVED/);
  assert.match(script,/LEARNLAB_RELEASE_TARGET_MOVED/);
});
