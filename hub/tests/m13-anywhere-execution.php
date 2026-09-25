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
    $before = $registry->status(false, $now);
    m13_assert(($before['anywhereFirst'] ?? false) === true && ($before['deviceRequired'] ?? true) === false, 'M13 declares anywhere-first without making a device mandatory');
    m13_assert(($registry->route('project.read', $now) ?? null) === null, 'catalog alone never claims an executor is online');
    $cloudCaps = ['agent.conversation','project.read','project.search','project.mutate.text','project.mutate.assisted','artifact.object'];
    $registry->advertiseVps($cloudCaps, $now, gmdate('c', strtotime($now) + 300));
    $cloudRoute = $registry->route('project.read', $now);
    m13_assert(($cloudRoute['providerId'] ?? null) === 'vps-native' && ($cloudRoute['availabilityMode'] ?? null) === 'ALWAYS_ON', 'Cloud provider is preferred for a core read capability');

    $pdo->prepare('INSERT INTO devices(device_id,display_name,platform,arch,app_version,last_seen_at,revoked_at) VALUES(:id,:name,:platform,:arch,:version,:at,NULL)')->execute(['id'=>$device,'name'=>'Optional Mac','platform'=>'darwin','arch'=>'arm64','version'=>'1.0.0','at'=>$now]);
    $registry->syncDeviceWorker($device, ['project.read','codex:cli','git','browser_debug_context','tool.office.word','tool.office.excel','device.screen.inspect','device.gui.inspect','device.gui.operate','device.process','workspace.files','system.shell'], 'READY', $now);
    $stillCloud = $registry->route('project.read', $now);
    m13_assert(($stillCloud['providerId'] ?? null) === 'vps-native', 'optional device never becomes a hidden dependency for cloud-capable work');
    $specialist = $registry->route('code.specialist', $now);
    m13_assert(($specialist['providerId'] ?? null) === 'device:' . $device, 'Codex CLI is exposed only as the human-facing specialist capability');
    m13_assert($registry->route('document.office', $now) === null, 'detected Office inventory never grants an executable Office route');
    m13_assert(($registry->route('device.screen.inspect', $now)['providerId'] ?? null) === 'device:' . $device, 'provider-neutral screen inspection is routable only while a device advertises it');
    m13_assert(($registry->route('device.gui.operate', $now)['providerId'] ?? null) === 'device:' . $device, 'provider-neutral GUI operation is routable through the connected device');
    m13_assert((int)$pdo->query("SELECT COUNT(*) FROM control_capability_catalog WHERE capability IN ('device.screen.inspect','device.gui.inspect','device.gui.operate','device.process') AND source_id='awh-core' AND enabled=1")->fetchColumn() === 4, 'device fabric capability labels are registered without a schema migration');

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
    m13_assert(HubCapabilityRegistryService::mutationResourcesConflict('CANONICAL:SOURCE','CANONICAL:DEPLOY')===false,'raw resource comparison stays backwards-compatible');
    m13_assert(HubCapabilityRegistryService::mutationResourcesConflict('CANDIDATE','CANONICAL:SOURCE')===false,'isolated candidate work never blocks source promotion');
    m13_assert(HubCapabilityRegistryService::mutationResourcesConflictForProjects('CANONICAL:SOURCE',$project,'CANONICAL:DEPLOY',$project)===true,'same-project source and deploy are interlocked');
    m13_assert(HubCapabilityRegistryService::mutationResourcesConflictForProjects('CANONICAL:DEPLOY',$project,'CANONICAL:DEPLOY',$project2)===true,'shared deploy lane serializes across projects');

    $arbRows=[
        ['deploy-a',$project,'system.core.release'],
        ['source-a',$project,'source.promote'],
        ['source-b',$project2,'source.promote'],
        ['deploy-b',$project2,'system.assessment.release'],
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
    m13_assert(($sourceA['granted']??true)===false&&($sourceA['blockingProjectId']??null)===$project,'same-project source promotion waits for active deploy');
    $sourceB=$registry->activateExecutionAuthority($arb['source-b'][1],$leaseUntil,$now);
    m13_assert(($sourceB['granted']??false)===true,'another project source promotion remains independent from deploy');
    $registry->updateEnvelopeState($arb['source-b'][1],'RELEASED',null,$now);
    $deployB=$registry->activateExecutionAuthority($arb['deploy-b'][1],$leaseUntil,$now);
    m13_assert(($deployB['granted']??true)===false&&($deployB['blockingProjectId']??null)===$project,'second project deploy waits on VPS-global deploy lane');
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
    m13_assert($pdo->query('PRAGMA integrity_check')->fetchColumn() === 'ok' && $pdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'M13 preserves database integrity and foreign keys');
    $releasedCheckpoint=$control->publishWorkspaceCheckpoint((string)$writerEnrollment['accessToken'],$blockedCheckpoint,gmdate('c',strtotime($now)+2));
    m13_assert(($releasedCheckpoint['workspace']['lease']['active']??false)===true,'workspace lease remains stable after parallel resource lanes release');
    fwrite(STDOUT, "AWH M13 Anywhere Execution: PASS\n");
} finally {
    m13_clean($root);
}
