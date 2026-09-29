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
  assert.match(service,/platformReleases->status/);
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
  for(const adapterName of ['PLATFORM_RELEASE','CORE_RELEASE','BAY_UPDATE_CENTER','MANAGED_HOSTING','LEARNLAB_RELEASE','LEGACY_DEPLOY','SOURCE_ONLY','AGENT_MANAGED']) assert.match(service,new RegExp(adapterName));
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
  assert.match(script,/requestPlatformRelease/);
  assert.match(router,/\/api\/v1\/control\/system\/platform\/releases/);
  assert.match(service,/hostGlobalReleaseTrack.*vps-platform/s);
  assert.match(service,/mutationDecisionAuthority.*AWH_EXECUTION_GATE/s);
  assert.match(script,/technicalDetails/);
  assert.match(script,/runtimeState/);
  assert.match(script,/renderProgress/);
  assert.doesNotMatch(page,/id="updates-step-up-dialog"/);
  assert.doesNotMatch(page,/id="updates-step-up-password"/);
  assert.doesNotMatch(script,/function requestOwnerStepUp\(\)/);
  assert.doesNotMatch(script,/async function runWithStepUp\(handler\)/);
  assert.doesNotMatch(script,/await stepUp\(password\.value\)/);
  assert.doesNotMatch(script,/await runWithStepUp\(handler\)/);
  assert.match(script,/function actionFeedback\(button,text,tone='info',targetKey=null/);
  assert.match(script,/function actionErrorText\(error,button\)/);
  assert.match(script,/CORE_RELEASE_NOT_READY/);
  assert.match(script,/localOperation=null;const text=actionErrorText/);
  assert.doesNotMatch(script,/askConfirm|askStepUp/);
  const lineBundleStart=script.indexOf('async function updateLineOaBundle');
  const lineBundleEnd=script.indexOf('async function refreshAgent');
  const scriptOutsideLineBundle=lineBundleStart>=0&&lineBundleEnd>lineBundleStart
    ?script.slice(0,lineBundleStart)+script.slice(lineBundleEnd)
    :script;
  assert.doesNotMatch(scriptOutsideLineBundle,/\bconfirm\(/);
  assert.doesNotMatch(script,/อัปเดต AWH เป็น Source/);
  assert.doesNotMatch(script,/decideApproval/);
  assert.match(script,/requestLearnLabRelease/);
  assert.match(script,/managedSiteAction/);
  assert.match(script,/createBayRemoteInstallRelay/);
  assert.match(script,/relayBayRemoteCommand/);
  assert.match(script,/BAY_INSTALL_OUTCOME_UNKNOWN/);
  assert.doesNotMatch(script,/autoUpdater|setFeedURL|shell_exec|proc_open|exec\(/);
  assert.doesNotMatch(page,/ตรวจสถานะทั้งหมด/);
  assert.match(page,/สถานะอัปเดตอัตโนมัติ/);
  assert.match(page,/ติดตั้งแยกตามระบบ/);
  assert.match(script,/function updateGroup\(/);
  assert.match(script,/core-control/);
  assert.match(script,/school-systems/);
  assert.match(script,/channels-public/);
  assert.doesNotMatch(script,/function refreshAll\(/);
  assert.match(page,/id="updates-refresh"/);
  assert.doesNotMatch(script,/function updateAll\(/);
  assert.doesNotMatch(script,/อัปเดตทั้งหมดอย่างปลอดภัย/);
  assert.match(page,/Source Authority เดียว/);
  assert.match(page,/Candidate เดียว/);
  assert.match(page,/Runtime Coherence/);
  assert.match(page,/Technical details/);
  assert.match(script,/รายละเอียดทางเทคนิค/);
  assert.match(page,/Fail closed/);
  assert.match(page,/Rollback พร้อม/);
  assert.doesNotMatch(service,/\$key === 'bay-hub'/);
  assert.match(service,/HubUpdateTargetRegistry::releaseVisibility\(\$track\)/);
  assert.match(service,/\$item\['visibility'\]=\$track===null\?'ADVANCED':HubUpdateTargetRegistry::releaseVisibility\(\$track\)/);
  assert.match(script,/function itemVisibility\(item\)/);
  assert.match(script,/filterMode==='ADVANCED'/);
  assert.match(script,/visibility==='ADVANCED'/);
  assert.match(script,/item\?\.visibility==='ADVANCED'\?'ADVANCED':'PRIMARY'/);
  assert.doesNotMatch(script,/item\?\.visibility==='PRIMARY'\?'PRIMARY':'ADVANCED'/);
  assert.match(page,/data-filter="ADVANCED"/);
  assert.match(script,/\['vps-platform','awh-core','awh-agent'\]/);
});

test('Update Center module graph imports only symbols exported by the same adapter bundle', async()=>{
  const [script,adapter]=await Promise.all([
    readFile(join(ROOT,'web/updates.js'),'utf8'),
    readFile(join(ROOT,'web/control-plane-adapter.js'),'utf8'),
  ]);
  const imported=script.match(/import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/control-plane-adapter\.js\?release=__AWH_WEB_RELEASE_ID__['"]/);
  assert.ok(imported,'Update Center adapter import must remain explicit and release-bound');
  const names=(imported?.[1]||'').split(',').map((value)=>value.trim()).filter(Boolean).map((value)=>value.split(/\s+as\s+/)[0]);
  const exported=new Set([
    ...Array.from(adapter.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g),(match)=>match[1]),
    ...Array.from(adapter.matchAll(/export\s+const\s+([A-Za-z0-9_]+)/g),(match)=>match[1]),
  ]);
  for(const name of names)assert.ok(exported.has(name),`Update Center imports missing adapter export: ${name}`);
  assert.ok(exported.has('stepUp'));
  assert.doesNotMatch(script,/\bstepUp\b/);
  assert.doesNotMatch(script,/askStepUp/);
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
  assert.match(registry,/'bay-hub'[\s\S]*'visibility'=>'ADVANCED'/);
  assert.match(registry,/'awh-agent'[\s\S]*'visibility'=>'PRIMARY'/);
  assert.match(registry,/function releaseVisibility/);
  assert.match(service,/\$item\['visibility'\]=\$track===null\?'ADVANCED':HubUpdateTargetRegistry::releaseVisibility\(\$track\)/);
});

test('BAY monorepo surfaces independent BAY Core, LINE OA, Cooperative and PP release tracks', async()=>{
  const [registry,service,script]=await Promise.all([
    readFile(join(ROOT,'hub/src/HubUpdateTargetRegistry.php'),'utf8'),
    readFile(join(ROOT,'hub/src/HubControlPlaneService.php'),'utf8'),
    readFile(join(ROOT,'web/updates.js'),'utf8'),
  ]);
  assert.match(registry,/'line-oa'.*'packageTrack'=>'line-oa'/s);
  assert.match(registry,/'bay-cooperative'.*'packageTrack'=>'cooperative-center'/s);
  assert.match(registry,/'bay-pp'.*'packageTrack'=>'pp-center'/s);
  assert.match(registry,/'vps-platform'.*'visibility'=>'PRIMARY'/s);
  assert.match(registry,/bayReleaseTrackForPaths/);
  assert.match(registry,/return 'bay-cooperative'/);
  assert.match(registry,/return 'bay-pp'/);
  assert.match(registry,/return 'line-oa'/);
  assert.match(service,/'releaseTrack'=>'bay-excuse-core'/);
  assert.match(service,/'releaseTrack'=>'line-oa'/);
  assert.match(service,/'releaseTrack'=>'cooperative-center'/);
  assert.match(service,/'releaseTrack'=>'pp-center'/);
  assert.match(script,/filter\(\(row\)=>row\.adapter==='BAY_UPDATE_CENTER'\)/);
  assert.match(script,/String\(row\.releaseTrack\|\|'bay-excuse-core'\)===track/);
  assert.match(script,/tracks\[track\]/);
  assert.match(script,/อัปเดต '\+item\.name/);
});

test('Update Center is a required release asset and survives the PWA build boundary', async()=>{
  const [build,releaseFiles,worker,index,panel]=await Promise.all([
    readFile(join(ROOT,'scripts/build-web-preview.ts'),'utf8'),
    readFile(join(ROOT,'scripts/web-release-files.json'),'utf8'),
    readFile(join(ROOT,'web/sw.js'),'utf8'),
    readFile(join(ROOT,'web/index.html'),'utf8'),
    readFile(join(ROOT,'web/panel.html'),'utf8'),
  ]);
  for(const file of ['updates.html','updates.css','updates.js']){
    assert.match(build,new RegExp(file.replace('.','\\.')));
    assert.match(releaseFiles,new RegExp(file.replace('.','\\.')));
    assert.match(worker,new RegExp(file.replace('.','\\.')));
  }
  assert.doesNotMatch(index,/data-owner-destination="updates"/);
  assert.match(index,/data-owner-destination="control"[^>]*href="\.\/panel\.html"/);
  assert.match(panel,/href="\.\/updates\.html"/);
  assert.match(panel,/ศูนย์อัปเดต/);
});

test('Update Center registry is packaged into every control-plane release', async()=>{
  const [local,remote]=await Promise.all([
    readFile(join(ROOT,'deploy/awh-control-plane/deploy-control-plane.sh'),'utf8'),
    readFile(join(ROOT,'deploy/awh-control-plane/remote-deploy-control-plane.sh'),'utf8'),
  ]);
  assert.match(local,/hub\/src\/HubUpdateTargetRegistry\.php/);
  assert.match(remote,/RELEASE\/hub\/src\/HubUpdateTargetRegistry\.php/);
});

test('Update Center keeps compatibility/internal targets out of the owner summary by default', async()=>{
  const [html,script,service]=await Promise.all([
    readFile(join(ROOT,'web/updates.html'),'utf8'),
    readFile(join(ROOT,'web/updates.js'),'utf8'),
    readFile(join(ROOT,'hub/src/HubControlPlaneService.php'),'utf8'),
  ]);
  assert.match(html,/data-filter="ADVANCED"[^>]*>ขั้นสูง</);
  assert.match(script,/function itemVisibility\(item\)/);
  assert.match(script,/filterMode==='ADVANCED'/);
  assert.match(script,/for\(const item of primaryItems\(\)\)/);
  assert.match(script,/primaryItems\(\)\.some\(\(item\)=>\['UPDATING','WAITING_FOR_APPROVAL'\]/);
  assert.match(service,/\(\$item\['visibility'\] \?\? 'ADVANCED'\) !== 'PRIMARY'/);
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
  assert.match(learnLab,/PUBLICATION_ARTIFACT_VERIFIED/);
  assert.match(learnLab,/product_artifact_sha256/);
  assert.match(learnLab,/AWH_PROJECT_VAULT_ROOT/);
  assert.match(learnLab,/AWH_LEARNLAB_RUNTIME_ROOT/);
  assert.match(script,/requestLearnLabRelease/);
  assert.doesNotMatch(script,/approveLearnLab|approveAwh|approvePlatform|approveAssessment/);
  assert.match(script,/ข้อมูลเก่า/);
  assert.match(css,/\.update-action-feedback/);
  assert.match(css,/button\[data-busy="true"\]::before/);
});


test('release targets recover legacy pending approvals with one repeated Owner Update action', async()=>{
  const [core,learnLab,assessment,service,script,trust]=await Promise.all([
    readFile(join(ROOT,'hub/src/HubCoreReleaseService.php'),'utf8'),
    readFile(join(ROOT,'hub/src/HubLearnLabReleaseService.php'),'utf8'),
    readFile(join(ROOT,'hub/src/HubAssessmentReleaseService.php'),'utf8'),
    readFile(join(ROOT,'hub/src/HubControlPlaneService.php'),'utf8'),
    readFile(join(ROOT,'web/updates.js'),'utf8'),
    readFile(join(ROOT,'hub/src/HubTrustPolicy.php'),'utf8'),
  ]);
  for(const release of [core,learnLab,assessment]){
    assert.match(release,/resumeLegacyPendingRelease/);
    assert.match(release,/status='APPROVED',decided_at=:at/);
    assert.match(release,/state='WAITING_FOR_WORKER'/);
    assert.match(release,/ไม่สร้าง release ซ้ำ/);
  }
  assert.match(core,/t\.user_id,a\.approval_id,a\.status AS approval_status,a\.expires_at/);
  assert.match(learnLab,/t\.user_id,a\.approval_id,a\.status AS approval_status,a\.expires_at/);
  assert.match(assessment,/t\.user_id,a\.approval_id,a\.status AS approval_status,a\.expires_at/);
  assert.match(learnLab,/reconcileExpiredLegacyPendingRelease/);
  assert.match(learnLab,/LEARNLAB_RELEASE_APPROVAL_EXPIRED/);
  assert.match(assessment,/reconcileExpiredLegacyPendingRelease/);
  assert.match(assessment,/ASSESSMENT_RELEASE_APPROVAL_EXPIRED/);
  assert.match(service,/candidateReleaseSha/);
  assert.match(service,/candidateVersion/);
  assert.match(script,/ทำต่อ AWH/);
  assert.match(script,/ทำต่อ VPS Platform/);
  assert.match(script,/ทำต่อ LearnLab/);
  assert.match(script,/ทำต่อ Assessment/);
  assert.match(script,/requestLearnLabRelease\(item\.candidateReleaseSha,item\.candidateVersion\)/);
  assert.doesNotMatch(script,/decideApproval/);
  assert.match(trust,/'system\.core\.release', 'system\.platform\.release', 'system\.learnlab\.release', 'system\.assessment\.release' => self::policy\(self::CRITICAL, false, false\)/);
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


test('Update Center keeps release details per project while roadmap remains backend metadata only', async()=>{
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
  assert.match(core,/deploymentReleaseNotes/);
  assert.match(core,/SOURCE_PROMOTION_CHAIN_EXACT_GIT_DIFF/);
  assert.match(core,/canonicalProductionSha/);
  assert.match(core,/Source topology can legitimately cross another release track/);
  assert.match(core,/if\(!hash_equals\(\(string\)\(\$segment\['track'\]\?\?''\),\$this->releaseTrack\)\)continue/);
  assert.match(core,/Historical source-promotion metadata predates explicit release tracks/);
  assert.match(core,/\$track='awh'/);
  assert.match(core,/releaseTrack==='vps-platform'[\s\S]*canonicalRefSha\('platform\/production'\)[\s\S]*canonicalRefSha\('runtime\/production'\)/);
  assert.match(core,/canonicalRefSha\('production'\) \?\? \$this->canonicalRefSha\('runtime\/production'\)/);
  assert.match(core,/releaseNotesSha256/);
  assert.match(core,/history/);
  assert.match(service,/'releaseNotes'/);
  assert.match(service,/'roadmap'/);
  assert.match(service,/'history'/);
  assert.doesNotMatch(page,/id="coming-next"/);
  assert.match(page,/<details id="release-history"/);
  assert.match(page,/ประวัติการอัปเดต/);
  assert.match(page,/update-search/);
  assert.match(page,/data-filter="UPDATE"/);
  assert.match(script,/renderReleaseNotes/);
  assert.doesNotMatch(script,/function renderRoadmap/);
  assert.match(script,/renderHistory/);
  assert.match(script,/ผลกระทบก่อนอัปเดต/);
  assert.match(script,/SEGMENT_TOUCHES/);
  assert.match(script,/รายการเปลี่ยนไฟล์/);
  assert.match(script,/สิ่งที่ควรรู้/);
  assert.match(script,/itemVisible/);
  assert.match(css,/release-notes/);
  assert.doesNotMatch(css,/roadmap-card/);
  assert.match(css,/updates-secondary-panel/);
  assert.match(css,/history-row/);
  const parsed=JSON.parse(roadmap);
  assert.equal(parsed.schemaVersion,1);
  assert.ok(Array.isArray(parsed.comingNext)&&parsed.comingNext.length>=1);
  assert.match(deploy,/config\/update-roadmap\.json/);
});


test('every canonical patch requires bounded release details before Update Center can expose it', async()=>{
  const [registry,operator,core,learnlab,assessment,service,script]=await Promise.all([
    readFile(join(ROOT,'hub/src/HubUpdateTargetRegistry.php'),'utf8'),
    readFile(join(ROOT,'hub/src/HubOperatorBridgeService.php'),'utf8'),
    readFile(join(ROOT,'hub/src/HubCoreReleaseService.php'),'utf8'),
    readFile(join(ROOT,'hub/src/HubLearnLabReleaseService.php'),'utf8'),
    readFile(join(ROOT,'hub/src/HubAssessmentReleaseService.php'),'utf8'),
    readFile(join(ROOT,'hub/src/HubControlPlaneService.php'),'utf8'),
    readFile(join(ROOT,'web/updates.js'),'utf8'),
  ]);
  assert.match(registry,/releaseDetailsReady/);
  assert.match(registry,/metadataState/);
  assert.match(registry,/compatibility/);
  assert.match(registry,/rollback/);
  assert.match(operator,/OPERATOR_RELEASE_DETAILS_REQUIRED/);
  assert.match(operator,/BAY release details are required before install/);
  assert.match(operator,/releaseDetailsForSourceSha/);
  assert.match(operator,/generatedFrom.*EXACT_GIT_DIFF/s);
  assert.match(operator,/persistSourcePromotionReleaseNotes/);
  assert.match(core,/CORE_RELEASE_DETAILS_REQUIRED/);
  assert.match(learnlab,/LEARNLAB_RELEASE_DETAILS_REQUIRED/);
  assert.match(assessment,/ASSESSMENT_RELEASE_DETAILS_REQUIRED/);
  assert.match(service,/releaseDetailsRequired/);
  assert.match(service,/releaseDetailsReady/);
  assert.match(service,/รุ่นนี้ยังรอรายละเอียดการเปลี่ยนแปลงก่อนเปิดให้อัปเดต/);
  assert.match(service,/releaseDetailsRequired'=>true/);
  assert.doesNotMatch(script,/\['internal','ระบบภายใน','🛡️'\]/);
  assert.match(script,/รายละเอียดงานภายใน/);
  assert.match(script,/ไม่มีการเปลี่ยนแปลงที่ผู้ใช้เห็น/);
});



test('M21 through M23 release lanes cannot bypass exact enrollment lineage sync', async()=>{
  const remote=await readFile(join(ROOT,'deploy/awh-control-plane/remote-deploy-control-plane.sh'),'utf8');
  const start=remote.indexOf('sync_enrollment_from_release() {');
  const end=remote.indexOf('reconcile_provider_credential_storage() {');
  assert.ok(start>=0&&end>start);
  const gate=remote.slice(start,end);
  for(const mode of ['PROJECT_SOURCE_AUTHORITY','IDENTITY_CONVERGENCE','PLATFORM_HARDENING']){
    assert.ok(gate.includes(mode),mode+' must participate in enrollment lineage sync');
  }
  assert.ok(!gate.includes('test "$PROJECT_SOURCE_AUTHORITY" = 1 || return 0'));
  assert.match(gate,/ENROLLMENT_RELEASE_SYNC/);
  assert.match(gate,/ENROLLMENT_POINTER_SWITCH/);
});


test('M23 platform hardening assembles the immutable source snapshot required by remote verification', async()=>{
  const deploy=await readFile(join(ROOT,'deploy/awh-control-plane/deploy-control-plane.sh'),'utf8');
  const start=deploy.indexOf('EXTRA_FILES=');
  const end=deploy.indexOf('SOURCE_FILES=',start);
  assert.ok(start>=0&&end>start);
  const assembly=deploy.slice(start,end);
  assert.ok(assembly.includes('PLATFORM_HARDENING'));
  assert.ok(assembly.includes('.awh-build/awh-source.zip'));
  assert.ok(assembly.includes('.awh-build/release-commit.txt'));
});

test('control release package contains every file required by atomic enrollment lineage sync', async()=>{
  const [deploy,remote]=await Promise.all([
    readFile(join(ROOT,'deploy/awh-control-plane/deploy-control-plane.sh'),'utf8'),
    readFile(join(ROOT,'deploy/awh-control-plane/remote-deploy-control-plane.sh'),'utf8'),
  ]);
  const required=[
    'hub/public/enrollment.php',
    'hub/src/HubEnrollmentService.php',
    'hub/src/HubEnrollmentRouter.php',
    'hub/src/HubEnrollmentApiMigration.php',
    'hub/migrations/002_m3e2_enrollment_api.sql',
    'hub/bin/migrate-m3e2.php',
    'deploy/nginx/awh-enrollment.conf',
    'deploy/php-fpm/awh-enrollment.pool.conf',
    'deploy/awh-enrollment/pointer-state.sh',
    'deploy/awh-enrollment/insert-nginx-include.php',
    'deploy/awh-enrollment/remote-deploy.sh',
  ];
  assert.match(remote,/sync_enrollment_from_release/);
  for(const file of required){
    assert.ok(remote.includes(file),file+' must be required by enrollment sync');
    assert.ok(deploy.includes(file),file+' must be packaged');
  }
});


test('Update Center owner surface has a durable clutter budget', async()=>{
  const [page,script]=await Promise.all([
    readFile(join(ROOT,'web/updates.html'),'utf8'),
    readFile(join(ROOT,'web/updates.js'),'utf8'),
  ]);
  assert.doesNotMatch(page,/id="coming-next"/);
  assert.doesNotMatch(page,/class="release-roadmap"/);
  assert.match(page,/<details id="release-history" class="updates-secondary-panel">/);
  assert.match(page,/<details id="advanced-diagnostics" class="updates-policy updates-secondary-panel">/);
  assert.doesNotMatch(page,/<details id="release-history"[^>]*\sopen(?:\s|>)/);
  assert.doesNotMatch(page,/<details id="advanced-diagnostics"[^>]*\sopen(?:\s|>)/);
  assert.ok(script.includes('renderReleaseNotes(item,main)'));
  assert.doesNotMatch(script,/function renderRoadmap/);
  assert.ok(script.includes('allRows.slice(0,6)'));
  assert.ok(script.includes("ล่าสุด '+Math.min(allRows.length,6)+' รายการ"));
});



test('Update Center owner actions keep target-scoped feedback and expose only safe pre-deploy cancellation', async()=>{
  const [service,hosting,adapter,page,script,css,nginx]=await Promise.all([
    readFile(join(ROOT,'hub/src/HubControlPlaneService.php'),'utf8'),
    readFile(join(ROOT,'hub/src/HubManagedHostingService.php'),'utf8'),
    readFile(join(ROOT,'web/control-plane-adapter.js'),'utf8'),
    readFile(join(ROOT,'web/updates.html'),'utf8'),
    readFile(join(ROOT,'web/updates.js'),'utf8'),
    readFile(join(ROOT,'web/updates.css'),'utf8'),
    readFile(join(ROOT,'deploy/nginx/awh-control-plane.conf'),'utf8'),
  ]);
  assert.match(service,/'taskId'=>is_array\(\$activeCore\)/);
  assert.match(service,/'taskState'=>is_array\(\$activeCore\)/);
  assert.match(service,/'canCancel'=>is_array\(\$activeCore\).*WAITING_FOR_WORKER.*WAITING_FOR_APPROVAL/s);
  assert.match(service,/'canCancel'=>is_array\(\$activePlatform\)/);
  assert.match(service,/'canCancel'=>is_array\(\$activeLearnLab\)/);
  assert.match(service,/'canCancel'=>is_array\(\$activeAssessment\)/);
  assert.match(service,/\$hostingTaskActive=is_string\(\$site\['taskId'\]\?\?null\)/);
  assert.match(service,/'taskId'=>\$site\['taskId'\]\?\?null/);
  assert.match(service,/'canCancel'=>\(\$site\['canCancel'\]\?\?false\)===true/);
  assert.match(hosting,/active_deploy_task_id/);
  assert.match(hosting,/active_deploy_task_state/);
  assert.match(hosting,/hosting\.site\.deploy/);
  assert.match(hosting,/'canCancel'=>is_string\(\$r\['active_deploy_task_state'\]/);
  assert.match(adapter,/export async function cancelTask\(taskId\)/);
  assert.match(script,/const targetFeedback=new Map\(\)/);
  assert.match(script,/function paintTargetFeedback\(targetKey\)/);
  assert.match(script,/targetFeedback\.set\(key,\{text,tone\}\)/);
  assert.match(script,/item\.canCancel===true&&item\.taskId/);
  assert.match(script,/await cancelTask\(item\.taskId\)/);
  assert.match(script,/TASK_NOT_CANCELLABLE/);
  assert.match(script,/item\?\.taskState\|\|event\?\.state/);
  assert.match(script,/item\?\.canCancel===true/);
  assert.match(script,/function reconcileTargetFeedback\(item\)/);
  assert.match(script,/อัปเดตสำเร็จ · เป็นรุ่นล่าสุด/);
  assert.doesNotMatch(page,/id="update-all"/);
  assert.match(css,/position:sticky/);
  assert.match(nginx,/location = \/updates \{/);
  assert.match(nginx,/return 308 \/updates\.html/);
});

test('Update Center streams canonical release progress in real time with bounded fallback', async()=>{
  const [service,entry,adapter,page,script,css,authority,cli,remote]=await Promise.all([
    readFile(join(ROOT,'hub/src/HubControlPlaneService.php'),'utf8'),
    readFile(join(ROOT,'hub/public/control-plane.php'),'utf8'),
    readFile(join(ROOT,'web/control-plane-adapter.js'),'utf8'),
    readFile(join(ROOT,'web/updates.html'),'utf8'),
    readFile(join(ROOT,'web/updates.js'),'utf8'),
    readFile(join(ROOT,'web/updates.css'),'utf8'),
    readFile(join(ROOT,'hub/src/HubDeployExecutionAuthorityService.php'),'utf8'),
    readFile(join(ROOT,'hub/bin/deploy-execution-authority.php'),'utf8'),
    readFile(join(ROOT,'deploy/awh-control-plane/remote-deploy-control-plane.sh'),'utf8'),
  ]);
  assert.match(service,/latestTaskEventMessage/);
  assert.match(service,/control_task_events/);
  assert.match(service,/updateCenterLiveForSession/);
  assert.match(service,/updateCenterLiveCursor/);
  assert.match(service,/ORDER BY rowid DESC LIMIT 1/);
  assert.match(service,/MAX\(ev\.rowid\)/);
  assert.doesNotMatch(service,/ORDER BY e\.occurred_at DESC,e\.event_id DESC LIMIT 1/);
  assert.match(service,/'progressEvent'/);
  assert.match(entry,/\/api\/v1\/control\/updates\/stream/);
  assert.match(entry,/text\/event-stream/);
  assert.match(entry,/X-Accel-Buffering/);
  assert.match(entry,/retry: 1000/);
  assert.match(entry,/usleep\(500000\)/);
  assert.match(adapter,/subscribeUpdateCenterLive/);
  assert.match(adapter,/new EventSource/);
  assert.match(page,/operation-progress-live/);
  assert.match(page,/operation-queue/);
  assert.match(script,/QUEUED_RELEASE_TASK_STATES/);
  assert.match(script,/รับคำสั่งแล้ว · รอคิวอัปเดต/);
  assert.match(script,/syncStickyOffset/);
  assert.match(css,/--updates-header-height/);
  assert.match(css,/\.operation-queue/);
  assert.match(script,/subscribeUpdateCenterLive/);
  assert.match(script,/progressEvent\?\.progress/);
  assert.match(script,/const liveFresh=liveConnected&&\(Date\.now\(\)-liveUpdatedAt\)<15000/);
  assert.match(script,/liveFresh\?60000:15000/);
  assert.match(script,/if\(changed\)render\(\);else renderProgress\(\)/);
  assert.match(script,/relativeLiveTime/);
  assert.match(script,/stopLiveStream/);
  assert.match(css,/update-progress-live/);
  assert.match(css,/prefers-reduced-motion/);
  assert.match(authority,/public function stage/);
  assert.match(authority,/SOURCE_DRIFT_VERIFIED/);
  assert.match(authority,/late older stage|detail\['progress'\]<\$currentProgress/);
  assert.match(cli,/\$action === 'stage'/);
  assert.match(remote,/report_deploy_stage/);
  assert.match(remote,/deploy-execution-authority\.php" stage/);
  assert.match(remote,/report_deploy_stage "\$1"/);
  assert.match(remote,/\|\| true/);
});

test('Update Center keeps AWH LINE Gateway and BAY Excuse LINE OA as two permanent release targets', async()=>{
  const [registry,contract,service,script,css]=await Promise.all([
    readFile(join(ROOT,'hub/src/HubUpdateTargetRegistry.php'),'utf8'),
    readFile(join(ROOT,'config/ecosystem-release-contract.json'),'utf8'),
    readFile(join(ROOT,'hub/src/HubControlPlaneService.php'),'utf8'),
    readFile(join(ROOT,'web/updates.js'),'utf8'),
    readFile(join(ROOT,'web/updates.css'),'utf8'),
  ]);
  const release=JSON.parse(contract);
  const awh=release.releaseTracks['awh-line-gateway'];
  const bay=release.releaseTracks['line-oa'];
  assert.equal(awh.sourceAuthority,'AWH_VAULT');
  assert.equal(awh.repository,null);
  assert.equal(awh.domain,'line.kruart.online');
  assert.equal(awh.deploymentAdapter,'MANAGED_HOSTING');
  assert.equal(bay.repository,'bay-excuse-x');
  assert.equal(bay.packageTrack,'line-oa');
  assert.equal(bay.deploymentAdapter,'BAY_UPDATE_CENTER');
  for(const field of ['dataOwner','permissionScope','observabilityScope','secretScope'])assert.notEqual(awh[field],bay[field]);
  assert.match(registry,/'awh-line-gateway'.*'sourceAuthority'=>'AWH_VAULT'.*'siteId'=>'ed911e13-ccfa-44d9-8214-6425cb252240'.*'domain'=>'line\.kruart\.online'/s);
  assert.match(registry,/'line-oa'.*'repository'=>'bay-excuse-x'.*'packageTrack'=>'line-oa'.*'secretScope'=>'BAY_EXCUSE_LINE_OA'/s);
  assert.match(registry,/public static function releaseGroups/);
  assert.match(registry,/'approvalMode'=>'SIGNED_IN_OWNER'/);
  assert.doesNotMatch(registry,/SINGLE_OWNER_STEP_UP/);
  assert.match(registry,/'orchestration'=>'SEQUENTIAL_VERIFY_EACH'/);
  assert.match(registry,/'historyScope'=>'PER_TARGET'/);
  assert.match(registry,/'rollbackScope'=>'PER_TARGET'/);
  assert.match(service,/'key'=>\$isAwhLineGateway\?'awh-line-gateway'/);
  assert.match(service,/'bay-excuse-line-oa'.*'releaseTrack'=>'line-oa'.*'group'=>'line-oa'/s);
  assert.match(service,/managedSiteReleaseHistory/);
  assert.match(service,/projectVaultPackageVersion/);
  assert.match(script,/'line-oa':\{label:'LINE OA'/);
  assert.match(script,/function renderTargetHistory/);
  assert.match(script,/function normalizeUpdateCenter/);
  assert.match(script,/AWH_LINE_PROJECT_ID='124ae148-3ed1-4e45-8f50-75ff45a39e5c'/);
  assert.match(script,/AWH_LINE_SITE_ID='ed911e13-ccfa-44d9-8214-6425cb252240'/);
  assert.match(script,/item\.key='awh-line-gateway'/);
  assert.match(script,/item\.key='bay-excuse-line-oa'/);
  assert.match(script,/center=normalizeUpdateCenter\(await loadUpdateCenter\(\)\)/);
  assert.match(script,/const normalized=normalizeUpdateCenter\(snapshot\)/);
  assert.match(script,/center=normalized/);
  assert.match(script,/const bayCompatTargets=\[/);
  assert.match(script,/function ensureBayTrackTargets\(tracks\)/);
  assert.match(script,/center\.items\.push\(item\)/);
  assert.match(script,/key:'bay-excuse-line-oa'/);
  assert.match(script,/releaseTrack:'line-oa'/);
  assert.match(script,/key:'bay-cooperative'/);
  assert.match(script,/releaseTrack:'cooperative-center'/);
  assert.match(script,/key:'bay-pp'/);
  assert.match(script,/releaseTrack:'pp-center'/);
  assert.match(script,/BAY runtime รุ่นนี้ยังไม่ประกาศ release track/);
  assert.match(script,/historyAuthority:'BAY_UPDATE_CENTER:'\+definition\.releaseTrack/);
  assert.match(script,/if\(!trackState&&track!=='bay-excuse-core'\)/);
  assert.match(script,/item\.actionable=false;item\.state='BLOCKED'/);
  assert.match(script,/snapshot\.items\.some\(\(item\)=>String\(item\?\.key\|\|''\)==='vps-platform'\)/);
  assert.match(script,/name:'VPS Platform'.*state:'BLOCKED'/s);
  assert.match(script,/ศูนย์งานสหกรณ์โรงเรียน/);
  assert.match(script,/ศูนย์ ปพ\./);
  assert.match(script,/function lineOaTargets/);
  assert.match(script,/async function updateLineOaBundle/);
  assert.match(script,/awh-line-gateway/);
  assert.match(script,/bay-excuse-line-oa/);
  assert.match(script,/await managedSiteAction\(awh\.siteId,'deploy'\)/);
  assert.match(script,/await waitForAwhLineGateway/);
  assert.match(script,/await waitForBayLineOa/);
  assert.match(script,/currentBay\.releaseTrack\)!=='line-oa'/);
  assert.match(script,/อัปเดต LINE OA ทั้งชุด/);
  const bundle=script.slice(script.indexOf('async function updateLineOaBundle'),script.indexOf('async function refreshAgent'));
  assert.equal((bundle.match(/await stepUp\(password\)/g)||[]).length,0);
  assert.doesNotMatch(bundle,/askStepUp|step-up-password|SINGLE_OWNER_STEP_UP/);
  assert.equal((bundle.match(/window\.confirm\(/g)||[]).length,1);
  assert.match(bundle,/โดยไม่แตะ AWH Core, VPS Platform หรือ BAY Excuse Core/);
  assert.doesNotMatch(bundle,/requestCoreRelease|requestPlatformRelease|bay-excuse-core|vps-platform/);
  assert.match(css,/update-group\[data-group="line-oa"\]/);
});

test('Update Center self-recovers from stale PWA module caches instead of showing an empty project list', async()=>{
  const [page,boot,script,worker,releaseFiles]=await Promise.all([
    readFile(join(ROOT,'web/updates.html'),'utf8'),
    readFile(join(ROOT,'web/update-center-boot.js'),'utf8'),
    readFile(join(ROOT,'web/updates.js'),'utf8'),
    readFile(join(ROOT,'web/sw.js'),'utf8'),
    readFile(join(ROOT,'scripts/web-release-files.json'),'utf8'),
  ]);
  assert.match(page,/update-center-boot\.js\?release=__AWH_WEB_RELEASE_ID__/);
  assert.doesNotMatch(page,/<script>\s*\(\(\) =>/);
  assert.match(boot,/window\.__AWH_UPDATE_CENTER_BOOT_OK__=false/);
  assert.match(boot,/awh-update-center-boot-/);
  assert.match(boot,/registration\.update\(\)/);
  assert.match(boot,/url\.searchParams\.set\('boot',RELEASE\)/);
  assert.match(boot,/event\.persisted/);
  assert.match(script,/window\.__AWH_UPDATE_CENTER_BOOT_OK__=true/);
  assert.match(script,/sessionStorage\.removeItem\('awh-update-center-boot-__AWH_WEB_RELEASE_ID__'\)/);
  assert.match(worker,/const UPDATE_CENTER_PATHS = new Set\(\['\/updates\.html','\/updates\.js','\/updates\.css','\/update-center-boot\.js','\/control-plane-adapter\.js'\]\)/);
  assert.match(worker,/\.\/update-center-boot\.js\?release=__AWH_WEB_RELEASE_ID__/);
  assert.match(worker,/UPDATE_CENTER_PATHS\.has\(url\.pathname\)/);
  assert.match(worker,/fetch\(request,\{cache:'no-store'\}\)/);
  assert.doesNotMatch(worker,/self\.clients\.matchAll\(\{type:'window',includeUncontrolled:true\}\)/);
  assert.doesNotMatch(worker,/url\.searchParams\.set\('sw-release',RELEASE_ID\)/);
  assert.doesNotMatch(worker,/client\.navigate\(url\.toString\(\)\)/);
  assert.ok(JSON.parse(releaseFiles).required.includes('update-center-boot.js'));
});
