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
  assert.match(service,/'infrastructure'=>\[/);
  assert.match(service,/releaseRunner.*awh-build-01.*EXECUTOR_ONLY/s);
  assert.match(service,/executionAuthorityStatus/);
  assert.match(script,/center\?\.infrastructure/);
  assert.doesNotMatch(script,/loadInfrastructure/);
  assert.match(page,/INFRASTRUCTURE & RELEASE CAPACITY/);
  assert.match(page,/bay-core-01/);
  assert.match(page,/awh-build-01/);
  assert.match(script,/executionAuthority/);
  assert.match(script,/activeMutationCount/);
  assert.match(script,/used>=90/);
  assert.match(script,/3\*1024\*\*3/);
  assert.match(script,/Production ยังรับ Build\/QA ชั่วคราว/);
  assert.match(page,/ไม่ถือ Production authority/);
  assert.match(script,/requestCoreRelease/);
  assert.match(script,/technicalDetails/);
  assert.match(script,/runtimeState/);
  assert.match(script,/renderProgress/);
  assert.match(script,/askConfirm/);
  assert.doesNotMatch(script,/\bconfirm\(/);
  assert.doesNotMatch(script,/อัปเดต AWH เป็น Source/);
  assert.match(script,/decideApproval/);
  assert.match(script,/managedSiteAction/);
  assert.match(script,/createBayRemoteInstallRelay/);
  assert.match(script,/relayBayRemoteCommand/);
  assert.match(script,/BAY_INSTALL_OUTCOME_UNKNOWN/);
  assert.doesNotMatch(script,/autoUpdater|setFeedURL|shell_exec|proc_open|exec\(/);
  assert.match(page,/อัปเดตทั้งหมดอย่างปลอดภัย/);
  assert.match(page,/Source Authority เดียว/);
  assert.match(page,/Candidate เดียว/);
  assert.match(page,/Runtime Coherence/);
  assert.match(page,/Technical details/);
  assert.match(script,/รายละเอียดทางเทคนิค/);
  assert.match(page,/Fail closed/);
  assert.match(page,/Rollback พร้อม/);
});

test('Release Runner is visible in Update Center but remains executor-only under the canonical control plane', async()=>{
  const [authority,page,script]=await Promise.all([
    readFile(join(ROOT,'docs/AWH-AUTHORITY-MAP.md'),'utf8'),
    readFile(join(ROOT,'web/updates.html'),'utf8'),
    readFile(join(ROOT,'web/updates.js'),'utf8'),
  ]);
  assert.match(authority,/Release Runner \/ Build VPS/);
  assert.match(authority,/Task → Execution \+ Capability Registry/);
  assert.match(authority,/second control plane, independent release queue, source authority, Owner approval or Production truth/);
  assert.match(page,/PRODUCTION \/ CONTROL AUTHORITY/);
  assert.match(page,/BUILD \/ QA \/ RELEASE RUNNER/);
  assert.match(script,/runnerWorker/);
  assert.match(script,/awh-build-01/);
  assert.match(script,/storageBlocked/);
  assert.match(script,/activeMutations===0/);
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
  assert.match(script,/Web\/PWA อัปเดตอัตโนมัติ/);
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
  assert.match(css,/html,body\{min-height:100%;background:var\(--update-bg\)!important\}/);
  assert.match(service,/state = 'BASELINE_REQUIRED'/);
  assert.match(service,/actionable'=>\$state==='UPDATE_AVAILABLE'/);
  assert.match(service,/adapter'=>'LEARNLAB_RELEASE'/);
  assert.match(service,/state'=>'MIGRATION_REQUIRED'/);
  assert.match(learnLab,/publishedAt/);
  assert.match(script,/approveLearnLab/);
  assert.match(script,/ข้อมูลเก่า/);
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


test('Update Center detects split runtime and core release syncs exact enrollment lineage atomically', async()=>{
  const [infra,service,remote,unit,page,script]=await Promise.all([
    readFile(join(ROOT,'hub/src/HubInfrastructureService.php'),'utf8'),
    readFile(join(ROOT,'hub/src/HubControlPlaneService.php'),'utf8'),
    readFile(join(ROOT,'deploy/awh-control-plane/remote-deploy-control-plane.sh'),'utf8'),
    readFile(join(ROOT,'deploy/systemd/awh-operator-bridge@.service'),'utf8'),
    readFile(join(ROOT,'web/updates.html'),'utf8'),
    readFile(join(ROOT,'web/updates.js'),'utf8'),
  ]);
  assert.match(infra,/enrollment-current/);
  assert.match(infra,/componentState/);
  assert.match(infra,/COHERENT/);
  assert.match(infra,/SPLIT/);
  assert.match(infra,/releaseSourceRef/);
  assert.match(service,/runtimeCoherenceRequired/);
  assert.match(service,/needsRuntimeRepair/);
  assert.match(service,/runtimeComponents/);
  assert.match(remote,/sync_enrollment_from_release/);
  assert.match(remote,/ENROLLMENT_RELEASE_SYNC/);
  assert.match(remote,/ENROLLMENT_POINTER_SWITCH/);
  assert.match(remote,/RUNTIME_LINEAGE_READY/);
  assert.match(unit,/CollectMode=inactive-or-failed/);
  assert.match(page,/runtime-health/);
  assert.match(script,/ปรับ Runtime และอัปเดต/);
});


test('Update Center explains the next release, impact, roadmap and history from canonical release metadata', async()=>{
  const [core,operator,service,page,script,css,roadmap,deploy]=await Promise.all([
    readFile(join(ROOT,'hub/src/HubCoreReleaseService.php'),'utf8'),
    readFile(join(ROOT,'hub/src/HubOperatorBridgeService.php'),'utf8'),
    readFile(join(ROOT,'hub/src/HubControlPlaneService.php'),'utf8'),
    readFile(join(ROOT,'web/updates.html'),'utf8'),
    readFile(join(ROOT,'web/updates.js'),'utf8'),
    readFile(join(ROOT,'web/updates.css'),'utf8'),
    readFile(join(ROOT,'config/update-roadmap.json'),'utf8'),
    readFile(join(ROOT,'deploy/awh-control-plane/deploy-control-plane.sh'),'utf8'),
  ]);
  assert.match(operator,/releaseNotesForPromotion/);
  assert.match(operator,/git.*log|\['log'/);
  assert.match(operator,/changedFileCount/);
  assert.match(operator,/databaseMigration/);
  assert.match(operator,/knownIssues/);
  assert.match(operator,/comingNext/);
  assert.match(operator,/releaseNotes.*checkpoint|checkpoint=.*releaseNotes/s);
  assert.match(core,/releaseNotes/);
  assert.match(core,/fallbackRoadmap/);
  assert.match(core,/history/);
  assert.match(service,/'releaseNotes'/);
  assert.match(service,/'roadmap'/);
  assert.match(service,/'history'/);
  assert.match(page,/เวอร์ชันต่อไป/);
  assert.match(page,/ประวัติการอัปเดต/);
  assert.match(page,/update-search/);
  assert.match(page,/data-filter="UPDATE"/);
  assert.match(script,/renderReleaseNotes/);
  assert.match(script,/renderRoadmap/);
  assert.match(script,/renderHistory/);
  assert.match(script,/ผลกระทบก่อนอัปเดต/);
  assert.match(script,/สิ่งที่ควรรู้/);
  assert.match(script,/itemVisible/);
  assert.match(css,/release-notes/);
  assert.match(css,/roadmap-card/);
  assert.match(css,/history-row/);
  const parsed=JSON.parse(roadmap);
  assert.equal(parsed.schemaVersion,1);
  assert.ok(Array.isArray(parsed.comingNext)&&parsed.comingNext.length>=1);
  assert.match(deploy,/config\/update-roadmap\.json/);
});
