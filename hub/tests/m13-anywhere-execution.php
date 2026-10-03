<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubSchemaMigration.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentApiMigration.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneMigration.php';
require_once dirname(__DIR__) . '/src/HubOwnerAuthMigration.php';
require_once dirname(__DIR__) . '/src/HubAssistantWorkstreamMigration.php';
require_once dirname(__DIR__) . '/src/HubWorkspaceContinuityMigration.php';
require_once dirname(__DIR__) . '/src/HubUnifiedWorkspaceMigration.php';
require_once dirname(__DIR__) . '/src/HubFinalProductMigration.php';
require_once dirname(__DIR__) . '/src/HubFoundingMemoryMigration.php';
require_once dirname(__DIR__) . '/src/HubSelfServiceMigration.php';
require_once dirname(__DIR__) . '/src/HubCentralProjectAuthorityMigration.php';
require_once dirname(__DIR__) . '/src/HubAnywhereExecutionMigration.php';
require_once dirname(__DIR__) . '/src/HubCapabilityRegistryService.php';
require_once dirname(__DIR__) . '/src/HubDurableExecutionService.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneService.php';

function m13_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function m13_uuid(): string { $bytes = random_bytes(16); $bytes[6] = chr((ord($bytes[6]) & 15) | 64); $bytes[8] = chr((ord($bytes[8]) & 63) | 128); return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4)); }
function m13_clean(string $root): void { if (!is_dir($root)) return; $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST); foreach ($files as $file) { $path = $file->getPathname(); $file->isDir() && !$file->isLink() ? @rmdir($path) : @unlink($path); } @rmdir($root); }

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { fwrite(STDOUT, "AWH M13 Anywhere Execution: SKIP pdo_sqlite unavailable\n"); exit(77); }

$root = sys_get_temp_dir() . '/awh-m13-' . bin2hex(random_bytes(6));
$base = dirname(__DIR__); $now = gmdate('c');
$owner = '223b45c0-23e1-408d-ae0f-ac5eca7f6900';
$project = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
$project2 = '313b45c0-23e1-408d-ae0f-ac5eca7f6900';
$device = '423b45c0-23e1-408d-ae0f-ac5eca7f6900';
$writerDevice = '523b45c0-23e1-408d-ae0f-ac5eca7f6900';
$guiOnDevice = '623b45c0-23e1-408d-ae0f-ac5eca7f6900';
$guiLiveDevice = '723b45c0-23e1-408d-ae0f-ac5eca7f6900';
try {
    mkdir($root, 0700, true); $db = $root . '/awh.sqlite';
    $pdo = new PDO('sqlite:' . $db, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec(file_get_contents($base . '/schema.sql'));
    foreach (['enrollment_rate_limits','device_project_memberships','device_tokens','pairing_projects','pairing_codes','user_project_memberships','device_enrollments','owner_bootstrap','hub_users'] as $table) $pdo->exec('DROP TABLE IF EXISTS ' . $table);
    $pdo->prepare('INSERT INTO projects(project_id,name,type,created_at,source_revision,observed_at,provenance) VALUES(:id,:name,:type,:at,NULL,:at,:provenance)')->execute(['id'=>$project,'name'=>'Anywhere Fixture','type'=>'php','at'=>$now,'provenance'=>'m13-fixture']);
    $pdo->prepare('INSERT INTO projects(project_id,name,type,created_at,source_revision,observed_at,provenance) VALUES(:id,:name,:type,:at,NULL,:at,:provenance)')->execute(['id'=>$project2,'name'=>'Peer Fixture','type'=>'php','at'=>$now,'provenance'=>'m13-fixture']);
    m13_assert(HubSchemaMigration::apply($db, $base . '/migrations/001_m3e_enrollment.sql', $now, false, $base . '/schema.sql') === 'applied', 'M3E');
    m13_assert(HubEnrollmentApiMigration::apply($db, $base . '/migrations/002_m3e2_enrollment_api.sql', $now) === 'applied', 'M3E2');
    $enrollment=HubEnrollmentService::openExisting($db); $enrollment->initializeOwner($owner, 'Art', [$project], $now);
    $writerPair=$enrollment->issuePairingCode($owner,[$project],$now);
    $writerEnrollment=$enrollment->enrollDevice(['schemaVersion'=>1,'pairingCode'=>$writerPair['pairingCode'],'deviceId'=>$writerDevice,'displayName'=>'Writer Windows','platform'=>'win32','arch'=>'x64','appVersion'=>'1.0.0'],$now);
    $guiOnPair=$enrollment->issuePairingCode($owner,[$project],$now);
    $guiOnEnrollment=$enrollment->enrollDevice(['schemaVersion'=>1,'pairingCode'=>$guiOnPair['pairingCode'],'deviceId'=>$guiOnDevice,'displayName'=>'ART-MAC-INTEL','platform'=>'darwin','arch'=>'x64','appVersion'=>'1.0.0'],$now);
    $guiLivePair=$enrollment->issuePairingCode($owner,[$project],$now);
    $guiLiveEnrollment=$enrollment->enrollDevice(['schemaVersion'=>1,'pairingCode'=>$guiLivePair['pairingCode'],'deviceId'=>$guiLiveDevice,'displayName'=>'ART-MAC-M5','platform'=>'darwin','arch'=>'arm64','appVersion'=>'1.0.0'],$now);
    foreach ([[HubControlPlaneMigration::class,'003_m4_control_plane.sql'],[HubOwnerAuthMigration::class,'004_owner_auth.sql'],[HubAssistantWorkstreamMigration::class,'005_assistant_workstream.sql'],[HubWorkspaceContinuityMigration::class,'006_workspace_continuity.sql'],[HubUnifiedWorkspaceMigration::class,'007_unified_workspace.sql']] as [$migration,$sql]) m13_assert($migration::apply($db, $base . '/migrations/' . $sql, $now) === 'applied', $sql);
    m13_assert(HubFinalProductMigration::apply($db, $base . '/migrations/008_final_product.sql', $now) === 'applied', 'M9');
    m13_assert(HubFoundingMemoryMigration::apply($db, $base . '/migrations/009_founding_memory.sql', $now) === 'applied', 'M10');
    m13_assert(HubSelfServiceMigration::apply($db, $base . '/migrations/010_self_service.sql', $now) === 'applied', 'M11');
    m13_assert(HubCentralProjectAuthorityMigration::apply($db, $base . '/migrations/011_central_project_authority.sql', $now) === 'applied', 'M12');
    $legacyTask = m13_uuid(); $legacyExecution = m13_uuid();
    $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,'inspect','QUEUED',NULL,NULL,0,NULL,NULL,:key,NULL,:at,:at,NULL)")->execute(['task'=>$legacyTask,'user'=>$owner,'project'=>$project,'key'=>'m13-legacy-task-0001','at'=>$now]);
    $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,NULL,'VPS','project.read','QUEUED',NULL,NULL,0,NULL,'{}',NULL,:at,:at)")->execute(['execution'=>$legacyExecution,'task'=>$legacyTask,'project'=>$project,'at'=>$now]);

    m13_assert(HubAnywhereExecutionMigration::apply($db, $base . '/migrations/012_anywhere_execution_fabric.sql', $now) === 'applied', 'M13 migration');
    m13_assert(HubAnywhereExecutionMigration::apply($db, $base . '/migrations/012_anywhere_execution_fabric.sql', $now) === 'already-applied', 'M13 idempotence');
    m13_assert((int) $pdo->query('PRAGMA user_version')->fetchColumn() === 13, 'M13 version');
    m13_assert((int) $pdo->query("SELECT COUNT(*) FROM awh_schema_migrations WHERE migration_id='m13-anywhere-execution-fabric'")->fetchColumn() === 1, 'M13 ledger');

    $envelope = $pdo->query("SELECT * FROM control_execution_envelopes WHERE execution_id='$legacyExecution'")->fetch();
    m13_assert(is_array($envelope) && $envelope['mutation_scope'] === 'READ' && $envelope['session_key'] === 'task:' . $legacyTask && $envelope['state'] === 'OPEN', 'legacy M12 execution is backfilled without a new task authority');

    $registry = new HubCapabilityRegistryService($pdo);
    $scopeTask=m13_uuid();$scopeExecution=m13_uuid();
    $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,'scope mismatch fixture','WAITING_FOR_WORKER',NULL,NULL,0,NULL,NULL,:key,NULL,:at,:at,NULL)")->execute(['task'=>$scopeTask,'user'=>$owner,'project'=>$project,'key'=>'m13-scope-mismatch-0001','at'=>$now]);
    $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,NULL,'VPS','project.mutate.assisted','QUEUED',NULL,NULL,0,NULL,'{}',NULL,:at,:at)")->execute(['execution'=>$scopeExecution,'task'=>$scopeTask,'project'=>$project2,'at'=>$now]);
    $scopeRejected=false;try{$registry->ensureExecutionEnvelope($scopeExecution,$now);}catch(HubCapabilityRegistryException $e){$scopeRejected=$e->codeName==='EXECUTION_PROJECT_SCOPE_MISMATCH';}
    m13_assert($scopeRejected,'execution envelope rejects cross-project mutation before authority opens');
    $pdo->prepare('DELETE FROM control_task_executions WHERE execution_id=:id')->execute(['id'=>$scopeExecution]);
    $pdo->prepare('DELETE FROM control_tasks WHERE task_id=:id')->execute(['id'=>$scopeTask]);
    $before = $registry->status(false, $now);
    m13_assert(($before['anywhereFirst'] ?? false) === true && ($before['deviceRequired'] ?? true) === false, 'M13 declares anywhere-first without making a device mandatory');
    m13_assert(($registry->route('project.read', $now) ?? null) === null, 'catalog alone never claims an executor is online');
    $cloudCaps = ['agent.conversation','project.read','project.search','project.mutate.text','project.mutate.assisted','artifact.object'];
    $registry->advertiseVps($cloudCaps, $now, gmdate('c', strtotime($now) + 300));
    $cloudRoute = $registry->route('project.read', $now);
    m13_assert(($cloudRoute['providerId'] ?? null) === 'vps-native' && ($cloudRoute['availabilityMode'] ?? null) === 'ALWAYS_ON', 'Cloud provider is preferred for a core read capability');

    $pdo->prepare('INSERT INTO devices(device_id,display_name,platform,arch,app_version,last_seen_at,revoked_at) VALUES(:id,:name,:platform,:arch,:version,:at,NULL)')->execute(['id'=>$device,'name'=>'Optional Mac','platform'=>'darwin','arch'=>'arm64','version'=>'1.0.0','at'=>$now]);
    $registry->syncDeviceWorker($device, ['project.read','codex:cli','git','browser_debug_context','tool.office.word','tool.office.excel','tool.adobe.photoshop','device.screen.inspect','device.gui.inspect','device.gui.operate','device.process','workspace.files','system.shell'], 'READY', $now);
    $stillCloud = $registry->route('project.read', $now);
    m13_assert(($stillCloud['providerId'] ?? null) === 'vps-native', 'optional device never becomes a hidden dependency for cloud-capable work');
    $specialist = $registry->route('code.specialist', $now);
    m13_assert(($specialist['providerId'] ?? null) === 'device:' . $device, 'Codex CLI is exposed only as the human-facing specialist capability');
    m13_assert($registry->route('document.office', $now) === null, 'detected Office inventory never grants an executable Office route');
    m13_assert(($registry->route('device.screen.inspect', $now)['providerId'] ?? null) === 'device:' . $device, 'provider-neutral screen inspection is routable only while a device advertises it');
    m13_assert(($registry->route('device.gui.operate', $now)['providerId'] ?? null) === 'device:' . $device, 'provider-neutral GUI operation is routable through the connected device');
    m13_assert($registry->route('creative.photoshop', $now) === null, 'Photoshop inventory alone never grants executable creative authority');
    $registry->syncDeviceWorker($device, ['project.read','codex:cli','git','browser_debug_context','tool.office.word','tool.office.excel','tool.adobe.photoshop','tool.awh-device-runtime','tool.pack.playwright','tool.pack.chrome-devtools','tool.pack.premiere','tool.pack.after-effects','device.screen.inspect','device.gui.inspect','device.gui.operate','device.process','workspace.files','system.shell','creative.photoshop','creative.premiere','creative.aftereffects','browser.playwright','browser.debug'], 'READY', $now);
    m13_assert(($registry->route('creative.photoshop', $now)['providerId'] ?? null) === 'device:' . $device, 'explicit worker creative capability is routable after full local runtime verification');
    foreach (['creative.premiere','creative.aftereffects','browser.playwright','browser.debug'] as $packCapability) m13_assert(($registry->route($packCapability, $now)['providerId'] ?? null) === 'device:' . $device, 'verified Tool Pack capability is routable: ' . $packCapability);
    m13_assert((int)$pdo->query("SELECT COUNT(*) FROM control_capability_catalog WHERE capability IN ('device.screen.inspect','device.gui.inspect','device.gui.operate','creative.photoshop','creative.premiere','creative.aftereffects','browser.playwright','browser.debug','device.process') AND source_id='awh-core' AND enabled=1")->fetchColumn() === 9, 'device fabric and lazy Tool Pack capability labels are registered without a schema migration');
    $router=(new ReflectionClass(HubControlPlaneService::class))->getMethod('deviceAutomationRequest');
    $deviceRoute=$router->invoke(null,'ใช้ Adobe Photoshop ทำวารสารและตรวจภาพจริงบน M5');
    m13_assert(($deviceRoute['capability']??null)==='creative.photoshop'&&($deviceRoute['mode']??null)==='PHOTOSHOP','Photoshop owner goals route to the explicit creative capability instead of generic GUI automation');
    $premiereRoute=$router->invoke(null,'ใช้ Adobe Premiere Pro บน M5 ตัด timeline แล้วตรวจ export');
    m13_assert(($premiereRoute['capability']??null)==='creative.premiere'&&($premiereRoute['mode']??null)==='PREMIERE','Premiere owner goals route to the lazy Premiere Tool Pack');
    $afterEffectsRoute=$router->invoke(null,'ใช้ Adobe After Effects บน M5 ทำ composition และ keyframe');
    m13_assert(($afterEffectsRoute['capability']??null)==='creative.aftereffects'&&($afterEffectsRoute['mode']??null)==='AFTER_EFFECTS','After Effects owner goals route to the lazy After Effects Tool Pack');
    $debugRoute=$router->invoke(null,'เปิด Chrome DevTools ตรวจ network request และ performance บน M5');
    m13_assert(($debugRoute['capability']??null)==='browser.debug'&&($debugRoute['mode']??null)==='BROWSER_DEBUG','DevTools owner goals route to Browser Diagnostics');
    $playwrightRoute=$router->invoke(null,'ใช้ Playwright browser E2E บน M5 ทดสอบ flow login');
    m13_assert(($playwrightRoute['capability']??null)==='browser.playwright'&&($playwrightRoute['mode']??null)==='BROWSER_ACTIONS','Playwright owner goals route to Browser Actions');
    $shellRoute=$router->invoke(null,'รัน shell บน M5: echo ready');
    m13_assert(($shellRoute['capability']??null)==='system.shell'&&($shellRoute['mode']??null)==='SHELL','explicit shell owner goals route to system.shell instead of process primitives');
    $processRoute=$router->invoke(null,'ตรวจ process บน M5 ที่กำลังทำงาน');
    m13_assert(($processRoute['capability']??null)==='device.process'&&($processRoute['mode']??null)==='PROCESS','process lifecycle owner goals remain on device.process');

    $guiControl=HubControlPlaneService::openExisting($db);
    $guiControl->heartbeat((string)$guiOnEnrollment['accessToken'],['schemaVersion'=>1,'deviceId'=>$guiOnDevice,'state'=>'READY','capabilities'=>['device.gui.operate','runtime.ai.on','runtime.gui.ready']],$now);
    $guiControl->heartbeat((string)$guiLiveEnrollment['accessToken'],['schemaVersion'=>1,'deviceId'=>$guiLiveDevice,'state'=>'READY','capabilities'=>['device.gui.operate','runtime.ai.live','runtime.gui.ready','runtime.visual.ready','app.foreground.photoshop']],$now);
    $guiTask=m13_uuid(); $guiExecution=m13_uuid();
    $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,'แก้ Photoshop วารสารประชาสัมพันธ์','WAITING_FOR_WORKER',NULL,NULL,0,NULL,NULL,:key,NULL,:at,:at,NULL)")->execute(['task'=>$guiTask,'user'=>$owner,'project'=>$project,'key'=>'m13-live-gui-routing-0001','at'=>$now]);
    $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,NULL,'DEVICE','device.gui.operate','WAITING_FOR_CAPABILITY',NULL,NULL,0,NULL,'{}',NULL,:at,:at)")->execute(['execution'=>$guiExecution,'task'=>$guiTask,'project'=>$project,'at'=>$now]);
    $registry->ensureExecutionEnvelope($guiExecution,$now);
    $onClaim=$guiControl->claim((string)$guiOnEnrollment['accessToken'],['schemaVersion'=>1,'deviceId'=>$guiOnDevice],$now);
    m13_assert(($onClaim['task']??null)===null,'ON worker defers GUI mutation while stronger LIVE visual authority is fresh');
    $liveClaim=$guiControl->claim((string)$guiLiveEnrollment['accessToken'],['schemaVersion'=>1,'deviceId'=>$guiLiveDevice],$now);
    m13_assert(($liveClaim['task']['taskId']??null)===$guiTask,'LIVE visual worker with matching Photoshop foreground wins GUI routing');
    $guiControl->updateTask((string)$guiLiveEnrollment['accessToken'],$guiTask,['schemaVersion'=>1,'deviceId'=>$guiLiveDevice,'state'=>'COMPLETED','progress'=>100,'message'=>'verified live route','resultSummary'=>'GUI route selected from live operational evidence'],$now);
    $guiControl->heartbeat((string)$guiOnEnrollment['accessToken'],['schemaVersion'=>1,'deviceId'=>$guiOnDevice,'state'=>'READY','capabilities'=>['device.gui.operate']],$now);
    $guiControl->heartbeat((string)$guiLiveEnrollment['accessToken'],['schemaVersion'=>1,'deviceId'=>$guiLiveDevice,'state'=>'READY','capabilities'=>['device.gui.operate']],$now);
    $legacyGuiTask=m13_uuid(); $legacyGuiExecution=m13_uuid();
    $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,'legacy gui worker','WAITING_FOR_WORKER',NULL,NULL,0,NULL,NULL,:key,NULL,:at,:at,NULL)")->execute(['task'=>$legacyGuiTask,'user'=>$owner,'project'=>$project,'key'=>'m13-legacy-gui-routing-0001','at'=>$now]);
    $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,NULL,'DEVICE','device.gui.operate','WAITING_FOR_CAPABILITY',NULL,NULL,0,NULL,'{}',NULL,:at,:at)")->execute(['execution'=>$legacyGuiExecution,'task'=>$legacyGuiTask,'project'=>$project,'at'=>$now]);
    $registry->ensureExecutionEnvelope($legacyGuiExecution,$now);
    $legacyClaim=$guiControl->claim((string)$guiOnEnrollment['accessToken'],['schemaVersion'=>1,'deviceId'=>$guiOnDevice],$now);
    m13_assert(($legacyClaim['task']['taskId']??null)===$legacyGuiTask,'workers without operational evidence preserve the legacy compatible claim behavior');
    $guiControl->updateTask((string)$guiOnEnrollment['accessToken'],$legacyGuiTask,['schemaVersion'=>1,'deviceId'=>$guiOnDevice,'state'=>'COMPLETED','progress'=>100,'message'=>'legacy compatible route','resultSummary'=>'No live evidence changed legacy routing'],$now);

    $specialistTask = m13_uuid(); $specialistExecution = m13_uuid();
    $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,'specialist','WAITING_FOR_WORKER',NULL,NULL,0,NULL,NULL,:key,NULL,:at,:at,NULL)")->execute(['task'=>$specialistTask,'user'=>$owner,'project'=>$project,'key'=>'m13-specialist-task-0001','at'=>$now]);
    $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,NULL,'CODEX','codex:cli','WAITING_FOR_CAPABILITY',NULL,NULL,0,NULL,'{}',NULL,:at,:at)")->execute(['execution'=>$specialistExecution,'task'=>$specialistTask,'project'=>$project,'at'=>$now]);
    $specialistEnvelope = $registry->ensureExecutionEnvelope($specialistExecution, $now);
    m13_assert(($specialistEnvelope['providerId'] ?? null) === 'device:' . $device && ($specialistEnvelope['mutationScope'] ?? null) === 'DEVICE_WORKSPACE', 'legacy codex:cli contract resolves through the specialist alias and standard workspace scope without changing the execution row');
    $leaseUntil = gmdate('c', strtotime($now) + 300);
    $firstAuthority = $registry->activateExecutionAuthority($specialistExecution, $leaseUntil, $now);
    m13_assert(($firstAuthority['granted'] ?? false) === true, 'first mutating execution owns project authority');
    $control=HubControlPlaneService::openExisting($db);
    $blockedCheckpoint=['schemaVersion'=>1,'checkpointId'=>'623b45c0-23e1-408d-ae0f-ac5eca7f6900','deviceId'=>$writerDevice,'projectId'=>$project,'taskId'=>null,'baseRevision'=>str_repeat('a',40),'wipRevision'=>str_repeat('b',40),'wipRef'=>'refs/awh/wip/'.$project.'/623b45c0-23e1-408d-ae0f-ac5eca7f6900','treeRevision'=>str_repeat('c',40),'files'=>[['path'=>'src/guard.php','state'=>'modified','sha256'=>str_repeat('d',64),'sizeBytes'=>16]],'artifactRefs'=>[],'syncState'=>'SYNCED'];
    $parallelCheckpoint=$control->publishWorkspaceCheckpoint((string)$writerEnrollment['accessToken'],$blockedCheckpoint,$now);
    m13_assert(($parallelCheckpoint['workspace']['lease']['active']??false)===true,'workspace WIP remains parallel with an isolated workspace execution');
    m13_assert((int)$pdo->query("SELECT COUNT(*) FROM control_workspace_checkpoints WHERE checkpoint_id='623b45c0-23e1-408d-ae0f-ac5eca7f6900'")->fetchColumn()===1,'parallel workspace checkpoint is stored atomically');
    $secondTask = m13_uuid(); $secondExecution = m13_uuid();
    $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,'second mutation','WAITING_FOR_WORKER',NULL,NULL,0,NULL,NULL,:key,NULL,:at,:at,NULL)")->execute(['task'=>$secondTask,'user'=>$owner,'project'=>$project,'key'=>'m13-second-mutation-0001','at'=>$now]);
    $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,NULL,'VPS','project.mutate.assisted','QUEUED',NULL,NULL,0,NULL,'{}',NULL,:at,:at)")->execute(['execution'=>$secondExecution,'task'=>$secondTask,'project'=>$project,'at'=>$now]);
    $secondAuthority = $registry->activateExecutionAuthority($secondExecution, $leaseUntil, $now);
    m13_assert(($secondAuthority['granted'] ?? false) === true && ($secondAuthority['mutationScope'] ?? null) === 'PROJECT_CANDIDATE' && ($secondAuthority['mutationResource'] ?? null) === 'CANDIDATE', 'candidate mutation runs in parallel with a separate workspace resource');
    $readAuthority = $registry->activateExecutionAuthority($legacyExecution, $leaseUntil, $now);
    m13_assert(($readAuthority['granted'] ?? false) === true && ($readAuthority['mutationScope'] ?? null) === 'READ', 'read execution remains parallel while mutations are active');
    $authorityStatus = $registry->executionAuthorityStatus($now);
    m13_assert(($authorityStatus['mode'] ?? null) === 'RESOURCE_SCOPED_CONCURRENCY' && ($authorityStatus['activeMutationCount'] ?? 0) === 2 && ($authorityStatus['waitingMutationCount'] ?? -1) === 0, 'authority status exposes parallel non-conflicting resource lanes');
    m13_assert(HubCapabilityRegistryService::mutationResourcesConflict('CANONICAL:SOURCE','CANONICAL:SOURCE')===true,'same canonical resource conflicts');
    m13_assert(HubCapabilityRegistryService::mutationResourcesConflict('CANONICAL:SOURCE','CANONICAL:DEPLOY:AWH')===false,'raw resource comparison stays backwards-compatible');
    m13_assert(HubCapabilityRegistryService::mutationResourcesConflict('CANDIDATE','CANONICAL:SOURCE')===false,'isolated candidate work never blocks source promotion');
    m13_assert(HubCapabilityRegistryService::mutationResourcesConflictForProjects('CANONICAL:SOURCE',$project,'CANONICAL:DEPLOY:AWH',$project)===false,'exact-SHA same-project deploy does not block later source promotion');
    m13_assert(HubCapabilityRegistryService::mutationResourcesConflictForProjects('CANONICAL:SOURCE',$project,'CANONICAL:DEPLOY:VPS_PLATFORM',$project2)===false,'exact-SHA VPS Platform deploy does not block canonical source across projects');
    m13_assert(HubCapabilityRegistryService::mutationResourcesConflictForProjects('CANDIDATE',$project,'CANONICAL:DEPLOY:VPS_PLATFORM',$project2)===false,'candidate work stays isolated from host-global platform deployment');
    m13_assert(HubCapabilityRegistryService::mutationResourcesConflictForProjects('CANONICAL:DEPLOY:AWH',$project,'CANONICAL:DEPLOY:BAY_ASSESSMENT',$project2)===false,'independent release tracks may deploy across projects');

    $arbRows=[
        ['deploy-a',$project,'system.core.release'],
        ['source-a',$project,'source.promote'],
        ['source-b',$project2,'source.promote'],
        ['deploy-b',$project2,'system.assessment.release'],
        ['platform',$project2,'system.platform.release'],
    ];
    $arb=[];
    foreach($arbRows as [$label,$pid,$cap]){
        $task=m13_uuid();$execution=m13_uuid();$arb[$label]=[$task,$execution];
        $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,:goal,'WAITING_FOR_WORKER',NULL,NULL,0,NULL,NULL,:key,NULL,:at,:at,NULL)")->execute(['task'=>$task,'user'=>$owner,'project'=>$pid,'goal'=>$label,'key'=>'m13-arbitration-'.$label,'at'=>$now]);
        $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,NULL,'VPS',:capability,'QUEUED',NULL,NULL,0,NULL,'{}',NULL,:at,:at)")->execute(['execution'=>$execution,'task'=>$task,'project'=>$pid,'capability'=>$cap,'at'=>$now]);
    }
    $deployA=$registry->activateExecutionAuthority($arb['deploy-a'][1],$leaseUntil,$now);
    m13_assert(($deployA['granted']??false)===true,'first project owns shared deploy lane');
    $sourceA=$registry->activateExecutionAuthority($arb['source-a'][1],$leaseUntil,$now);
    m13_assert(($sourceA['granted']??false)===true,'same-project source promotion remains independent after exact-SHA deploy authority is established');
    $registry->updateEnvelopeState($arb['source-a'][1],'RELEASED',null,$now);
    $sourceB=$registry->activateExecutionAuthority($arb['source-b'][1],$leaseUntil,$now);
    m13_assert(($sourceB['granted']??false)===true,'another project source promotion remains independent from deploy');
    $registry->updateEnvelopeState($arb['source-b'][1],'RELEASED',null,$now);
    $deployB=$registry->activateExecutionAuthority($arb['deploy-b'][1],$leaseUntil,$now);
    m13_assert(($deployB['granted']??false)===true&&($deployB['mutationResource']??null)==='CANONICAL:DEPLOY:BAY_ASSESSMENT','independent Assessment deploy runs alongside AWH deploy');
    $platform=$registry->activateExecutionAuthority($arb['platform'][1],$leaseUntil,$now);
    m13_assert(($platform['granted']??true)===false&&in_array(($platform['blockingMutationResource']??null),['CANONICAL:DEPLOY:AWH','CANONICAL:DEPLOY:BAY_ASSESSMENT'],true),'VPS Platform host-global deploy waits while any product deploy is active');
    foreach($arb as [$task,$execution]){
        $registry->updateEnvelopeState($execution,'RELEASED',null,$now);
        $pdo->prepare("UPDATE control_task_executions SET state='COMPLETED' WHERE execution_id=:id")->execute(['id'=>$execution]);
        $pdo->prepare("UPDATE control_tasks SET state='COMPLETED' WHERE task_id=:id")->execute(['id'=>$task]);
    }

    $registry->updateEnvelopeState($specialistExecution, 'RELEASED', null, $now);
    $pdo->prepare("UPDATE control_task_executions SET state='COMPLETED' WHERE execution_id=:id")->execute(['id'=>$secondExecution]);
    $pdo->prepare("UPDATE control_tasks SET state='COMPLETED' WHERE task_id=:id")->execute(['id'=>$secondTask]);
    $pdo->prepare("UPDATE control_execution_envelopes SET state='OPEN',lease_expires_at=NULL WHERE execution_id=:id")->execute(['id'=>$secondExecution]);
    $terminalFiltered = $registry->executionAuthorityStatus($now);
    m13_assert(($terminalFiltered['activeMutationCount'] ?? -1) === 0 && ($terminalFiltered['waitingMutationCount'] ?? -1) === 0, 'terminal historical envelopes stay auditable but never appear as waiting authority');
    $terminalEnvelope=$pdo->prepare("SELECT state FROM control_execution_envelopes WHERE execution_id=:id");$terminalEnvelope->execute(['id'=>$secondExecution]);
    m13_assert($terminalEnvelope->fetchColumn()==='RELEASED','terminal historical envelope is reconciled to released state');
    $registry->syncDeviceWorker($device, [], 'OFFLINE', gmdate('c', strtotime($now) + 30));
    m13_assert($registry->route('code.specialist', gmdate('c', strtotime($now) + 30)) === null, 'offline optional device disappears from routing truthfully');

    $after = $registry->status(false, $now);
    $visible = array_column($after['capabilities'], 'state', 'capability');
    m13_assert(($visible['project.mutate.assisted'] ?? null) === 'READY', 'Cloud-assisted source editing is visible as ready');
    m13_assert(($visible['voice.tts'] ?? null) === 'PLANNED' && ($visible['video.render'] ?? null) === 'PLANNED', 'future voice/video capabilities are truthful planned entries');

    // Scheduler regression: one blocked queue head may not starve a later
    // execution whose mutation resource is independently eligible.
    $pdo->exec("UPDATE control_task_executions SET state='CANCELLED',lease_owner=NULL,lease_expires_at=NULL WHERE state='QUEUED' AND task_id IN (SELECT task_id FROM control_tasks WHERE state IN ('QUEUED','WAITING_FOR_WORKER'))");
    $pdo->exec("UPDATE control_tasks SET state='CANCELLED',cancelled_at=updated_at WHERE state IN ('QUEUED','WAITING_FOR_WORKER') AND task_id IN (SELECT task_id FROM control_task_executions WHERE state='CANCELLED')");
    $pdo->exec("UPDATE control_execution_envelopes SET state='RELEASED',lease_expires_at=NULL WHERE execution_id IN (SELECT execution_id FROM control_task_executions WHERE state='CANCELLED')");
    $schedulerRoot=$root.'/scheduler-vault'; @mkdir($schedulerRoot,0700,true); putenv('AWH_PROJECT_VAULT_ROOT='.$schedulerRoot);
    $durable=new HubDurableExecutionService($pdo,HubProjectVaultService::fromEnvironment($pdo),null,null);
    $fixtureAt=gmdate('c',strtotime($now)+60);
    // Production has canonical source columns introduced after M13. Add only
    // those compatibility columns here so the scheduler regression exercises
    // the current source-readiness authority without pulling newer migrations
    // into the M13 contract fixture.
    $pdo->exec("ALTER TABLE projects ADD COLUMN canonical_source_authority TEXT");
    $pdo->exec("ALTER TABLE projects ADD COLUMN canonical_source_revision TEXT");
    $pdo->exec("ALTER TABLE projects ADD COLUMN canonical_source_vault_revision_id TEXT");
    $pdo->prepare("UPDATE projects SET canonical_source_authority='GITHUB',canonical_source_revision=:sha WHERE project_id=:project")->execute(['sha'=>str_repeat('a',40),'project'=>$project]);

    $headAt=gmdate('c',strtotime($fixtureAt)+1);$headTask=m13_uuid();$headExecution=m13_uuid();
    $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,'blocked scheduler head','QUEUED',NULL,NULL,0,NULL,NULL,:key,NULL,:at,:at,NULL)")->execute(['task'=>$headTask,'user'=>$owner,'project'=>$project2,'key'=>'m13-scheduler-head','at'=>$headAt]);
    $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,NULL,'VPS','project.mutate.assisted','QUEUED',NULL,NULL,0,NULL,:checkpoint,NULL,:at,:at)")->execute(['execution'=>$headExecution,'task'=>$headTask,'project'=>$project2,'checkpoint'=>json_encode(['mode'=>'PROJECT_ASSISTED_EDIT'],JSON_THROW_ON_ERROR),'at'=>$headAt]);

    $readAt=gmdate('c',strtotime($fixtureAt)+2);$readTask=m13_uuid();$readExecution=m13_uuid();
    $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,'eligible scheduler follower','QUEUED',NULL,NULL,0,NULL,NULL,:key,NULL,:at,:at,NULL)")->execute(['task'=>$readTask,'user'=>$owner,'project'=>$project,'key'=>'m13-scheduler-read','at'=>$readAt]);
    $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,NULL,'VPS','project.read','QUEUED',NULL,NULL,0,NULL,:checkpoint,NULL,:at,:at)")->execute(['execution'=>$readExecution,'task'=>$readTask,'project'=>$project,'checkpoint'=>json_encode(['mode'=>'PROJECT_INSPECTION'],JSON_THROW_ON_ERROR),'at'=>$readAt]);

    $claimMethod=new ReflectionMethod(HubDurableExecutionService::class,'claim');$claimMethod->setAccessible(true);
    $claimed=$claimMethod->invoke($durable,gmdate('c',strtotime($fixtureAt)+3));
    m13_assert(is_array($claimed)&&($claimed['execution_id']??null)===$readExecution,'source-not-ready scheduler head is skipped and later non-conflicting execution is claimed');
    $headRow=$pdo->query("SELECT state,attempt_count FROM control_task_executions WHERE execution_id=".$pdo->quote($headExecution))->fetch();
    m13_assert(is_array($headRow)&&$headRow['state']==='QUEUED'&&(int)$headRow['attempt_count']===0,'skipped scheduler head remains durable without consuming retry budget');
    $headEnvelope=$pdo->query("SELECT state FROM control_execution_envelopes WHERE execution_id=".$pdo->quote($headExecution))->fetchColumn();
    m13_assert($headEnvelope==='WAITING','skipped scheduler head records waiting authority instead of blocking the tick');
    foreach([[$headTask,$headExecution],[$readTask,$readExecution]] as [$task,$execution]){
        $pdo->prepare("UPDATE control_task_executions SET state='CANCELLED',lease_owner=NULL,lease_expires_at=NULL WHERE execution_id=:execution")->execute(['execution'=>$execution]);
        $pdo->prepare("UPDATE control_tasks SET state='CANCELLED',lease_expires_at=NULL,cancelled_at=:at,updated_at=:at WHERE task_id=:task")->execute(['at'=>$readAt,'task'=>$task]);
        $pdo->prepare("UPDATE control_execution_envelopes SET state='RELEASED',lease_expires_at=NULL,updated_at=:at WHERE execution_id=:execution")->execute(['at'=>$readAt,'execution'=>$execution]);
    }

    // Provider recovery regression: only genuinely newer canonical health may
    // wake the same preserved execution, and one observation may wake it once.
    $pdo->exec("CREATE TABLE IF NOT EXISTS control_ai_provider_profiles(provider_id TEXT PRIMARY KEY,lifecycle TEXT NOT NULL,current_availability TEXT NOT NULL,updated_at TEXT NOT NULL)");
    $pdo->exec("CREATE TABLE IF NOT EXISTS control_ai_models(provider_id TEXT NOT NULL,model_id TEXT NOT NULL,lifecycle TEXT NOT NULL,enabled INTEGER NOT NULL,PRIMARY KEY(provider_id,model_id))");
    $pdo->exec("CREATE TABLE IF NOT EXISTS control_ai_model_health(provider_id TEXT NOT NULL,model_id TEXT NOT NULL,circuit_state TEXT NOT NULL,circuit_until TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(provider_id,model_id))");
    $pdo->exec("CREATE TABLE IF NOT EXISTS control_ai_route_decisions(route_id TEXT PRIMARY KEY,execution_id TEXT NOT NULL,provider_id TEXT,model_id TEXT,created_at TEXT NOT NULL)");
    $waitAt=gmdate('c',strtotime($fixtureAt)+20);$recoverAt=gmdate('c',strtotime($waitAt)+60);$wakeAt=gmdate('c',strtotime($recoverAt)+1);
    $providerTask=m13_uuid();$providerExecution=m13_uuid();
    $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,'provider recovery fixture','WAITING_FOR_WORKER',NULL,NULL,0,NULL,'PROVIDER_UNAVAILABLE',:key,NULL,:at,:at,NULL)")->execute(['task'=>$providerTask,'user'=>$owner,'project'=>$project,'key'=>'m13-provider-recovery','at'=>$waitAt]);
    $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,NULL,'VPS','agent.conversation','WAITING_FOR_CAPABILITY',NULL,NULL,3,NULL,:checkpoint,'PROVIDER_UNAVAILABLE',:at,:at)")->execute(['execution'=>$providerExecution,'task'=>$providerTask,'project'=>$project,'checkpoint'=>json_encode(['mode'=>'NATIVE_CONVERSATION','_executionPolicy'=>['version'=>'execution-failure-v1','code'=>'PROVIDER_UNAVAILABLE','nextEligibleAt'=>'2099-01-01T00:00:00+00:00']],JSON_THROW_ON_ERROR),'at'=>$waitAt]);
    $registry->ensureExecutionEnvelope($providerExecution,$waitAt);$registry->updateEnvelopeState($providerExecution,'WAITING',null,$waitAt);
    $pdo->prepare("INSERT INTO control_ai_provider_profiles(provider_id,lifecycle,current_availability,updated_at) VALUES('fixture-health','PRODUCTION','AVAILABLE',:at)")->execute(['at'=>$recoverAt]);
    $pdo->prepare("INSERT INTO control_ai_models(provider_id,model_id,lifecycle,enabled) VALUES('fixture-health','fixture-model','PRODUCTION',1)")->execute();
    $pdo->prepare("INSERT INTO control_ai_model_health(provider_id,model_id,circuit_state,circuit_until,updated_at) VALUES('fixture-health','fixture-model','CLOSED',NULL,:at)")->execute(['at'=>$recoverAt]);
    $pdo->prepare("INSERT INTO control_ai_route_decisions(route_id,execution_id,provider_id,model_id,created_at) VALUES(:route,:execution,'fixture-health','fixture-model',:at)")->execute(['route'=>m13_uuid(),'execution'=>$providerExecution,'at'=>$waitAt]);
    $wakeMethod=new ReflectionMethod(HubDurableExecutionService::class,'reconcileRecoverableProviderWaits');$wakeMethod->setAccessible(true);
    m13_assert($wakeMethod->invoke($durable,$wakeAt)===1,'new provider health evidence wakes one preserved execution');
    $wakeRow=$pdo->query("SELECT state,attempt_count,last_error_code,checkpoint_json FROM control_task_executions WHERE execution_id=".$pdo->quote($providerExecution))->fetch();
    $wakeCheckpoint=is_array($wakeRow)?json_decode((string)$wakeRow['checkpoint_json'],true):null;
    m13_assert(is_array($wakeRow)&&$wakeRow['state']==='QUEUED'&&(int)$wakeRow['attempt_count']===0&&$wakeRow['last_error_code']===null&&($wakeCheckpoint['_capabilityRecovery']['providerId']??null)==='fixture-health','provider wake reuses exact execution and records recovery evidence');
    $secondWait=gmdate('c',strtotime($recoverAt)+60);
    $pdo->prepare("UPDATE control_task_executions SET state='WAITING_FOR_CAPABILITY',attempt_count=3,last_error_code='PROVIDER_UNAVAILABLE',updated_at=:at WHERE execution_id=:execution")->execute(['at'=>$secondWait,'execution'=>$providerExecution]);
    $pdo->prepare("UPDATE control_tasks SET state='WAITING_FOR_WORKER',failure_code='PROVIDER_UNAVAILABLE',updated_at=:at WHERE task_id=:task")->execute(['at'=>$secondWait,'task'=>$providerTask]);
    m13_assert($wakeMethod->invoke($durable,gmdate('c',strtotime($secondWait)+60))===0,'unchanged provider health evidence never creates an automatic retry loop');
    m13_assert($pdo->query("SELECT state FROM control_task_executions WHERE execution_id=".$pdo->quote($providerExecution))->fetchColumn()==='WAITING_FOR_CAPABILITY','provider execution stays preserved until newer health evidence exists');

    m13_assert($pdo->query('PRAGMA integrity_check')->fetchColumn() === 'ok' && $pdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'M13 preserves database integrity and foreign keys');
    $releasedCheckpoint=$control->publishWorkspaceCheckpoint((string)$writerEnrollment['accessToken'],$blockedCheckpoint,gmdate('c',strtotime($now)+2));
    m13_assert(($releasedCheckpoint['workspace']['lease']['active']??false)===true,'workspace lease remains stable after parallel resource lanes release');
    fwrite(STDOUT, "AWH M13 Anywhere Execution: PASS\n");
} finally {
    m13_clean($root);
}
