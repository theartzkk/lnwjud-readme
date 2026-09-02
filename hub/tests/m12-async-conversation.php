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
require_once dirname(__DIR__) . '/src/HubEnrollmentService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneService.php';

function bf_assert(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
function bf_clean(string $root): void {
    if (!is_dir($root)) return;
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($it as $file) { $path = $file->getPathname(); $file->isDir() && !$file->isLink() ? @rmdir($path) : @unlink($path); }
    @rmdir($root);
}

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { fwrite(STDOUT, "AWH Async Conversation: SKIP sqlite unavailable\n"); exit(77); }
$root = rtrim(sys_get_temp_dir(), '/') . '/awh-blockfree-' . bin2hex(random_bytes(5));
$base = dirname(__DIR__); $now = gmdate('c');
$owner = '223b45c0-23e1-408d-ae0f-ac5eca7f6900';
$project = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
$device = '423b45c0-23e1-408d-ae0f-ac5eca7f6900';
try {
    mkdir($root, 0700, true);
    foreach (['vault','attachments','credentials','artifacts','workspaces','transfers'] as $dir) mkdir($root . '/' . $dir, 0700, true);
    putenv('AWH_PROJECT_VAULT_ROOT=' . $root . '/vault');
    putenv('AWH_ATTACHMENT_ROOT=' . $root . '/attachments');
    putenv('AWH_PROVIDER_CREDENTIAL_ROOT=' . $root . '/credentials');
    putenv('AWH_ARTIFACT_ROOT=' . $root . '/artifacts');
    putenv('AWH_TASK_WORKSPACE_ROOT=' . $root . '/workspaces');
    putenv('AWH_TASK_TRANSFER_ROOT=' . $root . '/transfers');
    $db = $root . '/awh.sqlite';
    $pdo = new PDO('sqlite:' . $db, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec(file_get_contents($base . '/schema.sql'));
    foreach (['enrollment_rate_limits','device_project_memberships','device_tokens','pairing_projects','pairing_codes','user_project_memberships','device_enrollments','owner_bootstrap','hub_users'] as $table) $pdo->exec('DROP TABLE IF EXISTS ' . $table);
    $pdo->prepare('INSERT INTO projects(project_id,name,type,created_at,source_revision,observed_at,provenance) VALUES(:id,:name,:type,:at,NULL,:at,:source)')->execute(['id'=>$project,'name'=>'Block-Free Fixture','type'=>'php','at'=>$now,'source'=>'fixture']);
    bf_assert(HubSchemaMigration::apply($db, $base . '/migrations/001_m3e_enrollment.sql', $now, false, $base . '/schema.sql') === 'applied', 'M3E');
    bf_assert(HubEnrollmentApiMigration::apply($db, $base . '/migrations/002_m3e2_enrollment_api.sql', $now) === 'applied', 'M3E2');
    $enrollment = HubEnrollmentService::openExisting($db); $initial = $enrollment->initializeOwner($owner, 'Art', [$project], $now);
    $enrolled = $enrollment->enrollDevice(['schemaVersion'=>1,'pairingCode'=>$initial['initialPairingCode'],'deviceId'=>$device,'displayName'=>'Memory Worker','platform'=>'darwin','arch'=>'x64','appVersion'=>'1.0.0-rc.1'], $now);
    foreach ([[HubControlPlaneMigration::class,'003_m4_control_plane.sql'],[HubOwnerAuthMigration::class,'004_owner_auth.sql'],[HubAssistantWorkstreamMigration::class,'005_assistant_workstream.sql'],[HubWorkspaceContinuityMigration::class,'006_workspace_continuity.sql'],[HubUnifiedWorkspaceMigration::class,'007_unified_workspace.sql']] as [$migration,$sql]) {
        bf_assert($migration::apply($db, $base . '/migrations/' . $sql, $now) === 'applied', $sql);
    }
    bf_assert(HubFinalProductMigration::apply($db, $base . '/migrations/008_final_product.sql', $now) === 'applied', 'M9');
    bf_assert(HubFoundingMemoryMigration::apply($db, $base . '/migrations/009_founding_memory.sql', $now) === 'applied', 'M10');
    bf_assert(HubSelfServiceMigration::apply($db, $base . '/migrations/010_self_service.sql', $now) === 'applied', 'M11');
    bf_assert(HubCentralProjectAuthorityMigration::apply($db, $base . '/migrations/011_central_project_authority.sql', $now) === 'applied', 'M12');
    $service = HubControlPlaneService::openExisting($db);
    $memoryInsert = $pdo->prepare("INSERT INTO project_memory(project_id,memory_file,status,sha256,size_bytes,observed_at,provenance) VALUES(:project,:file,'present',:sha,12,:at,'m12-memory-fixture')");
    foreach (['PROJECT.md','HANDOFF.md','TASKS.md','ARCHITECTURE.md','DECISIONS.md'] as $file) $memoryInsert->execute(['project'=>$project,'file'=>$file,'sha'=>str_repeat('a',64),'at'=>$now]);
    $legacyWorkerProjects = $service->workerProjects((string)$enrolled['accessToken'], $device, $now);
    bf_assert(($legacyWorkerProjects['projects'][0]['memoryReady'] ?? null) === false, 'worker projection must expose legacy five-file metadata as not ready');
    $memoryInsert->execute(['project'=>$project,'file'=>'CURRENT_STATE.md','sha'=>str_repeat('b',64),'at'=>$now]);
    $readyWorkerProjects = $service->workerProjects((string)$enrolled['accessToken'], $device, $now);
    bf_assert(($readyWorkerProjects['projects'][0]['memoryReady'] ?? null) === true, 'worker projection must expose canonical six-file metadata as ready');
    $submit = (new ReflectionClass(HubControlPlaneService::class))->getMethod('submitConversationForUser'); $submit->setAccessible(true);
    $payload = ['schemaVersion'=>1,'projectId'=>$project,'message'=>'สวัสดี ช่วยเล่าสถานะตอนนี้ให้หน่อย','idempotencyKey'=>'blockfree-chat-0001'];
    $submit->invoke($service, $owner, $payload, $now);
    $q = $pdo->prepare("SELECT m.message_id,m.task_id,m.conversation_id,t.state AS task_state,e.executor_kind,e.required_capability,e.state AS execution_state,e.checkpoint_json FROM control_conversation_messages m JOIN control_tasks t ON t.task_id=m.task_id JOIN control_task_executions e ON e.task_id=t.task_id WHERE m.idempotency_key=:key AND m.message_kind='USER'");
    $q->execute(['key'=>'blockfree-chat-0001']); $row = $q->fetch();
    bf_assert(is_array($row), 'durable conversation row missing');
    bf_assert($row['task_state'] === 'QUEUED' && $row['executor_kind'] === 'VPS' && $row['required_capability'] === 'agent.conversation' && $row['execution_state'] === 'QUEUED', 'conversation did not enter durable VPS execution');
    $checkpoint = json_decode((string)$row['checkpoint_json'], true, 16, JSON_THROW_ON_ERROR);
    bf_assert(($checkpoint['mode'] ?? null) === 'NATIVE_CONVERSATION' && ($checkpoint['messageId'] ?? null) === $row['message_id'], 'checkpoint is not bound to the submitted message');
    $premature = $pdo->prepare("SELECT COUNT(*) FROM control_conversation_messages WHERE task_id=:task AND message_kind IN ('ASSISTANT','FAILURE','RESULT')");
    $premature->execute(['task'=>$row['task_id']]);
    bf_assert((int)$premature->fetchColumn() === 0, 'provider work leaked into synchronous submit');
    $submit->invoke($service, $owner, $payload, $now);
    $count = $pdo->prepare('SELECT COUNT(*) FROM control_task_executions WHERE task_id=:task'); $count->execute(['task'=>$row['task_id']]);
    bf_assert((int)$count->fetchColumn() === 1, 'idempotent resubmit duplicated native execution');
    $durable = new HubDurableExecutionService($pdo, HubProjectVaultService::fromEnvironment($pdo));
    $contextMethod = new ReflectionMethod(HubDurableExecutionService::class, 'conversationContext');
    $durableContext = $contextMethod->invoke($durable, $owner, $project, 'ใช้ไฟล์ล่าสุด', (string)$row['conversation_id']);
    bf_assert(($durableContext['conversationReferent']['latestTask']['taskId'] ?? null) === $row['task_id'], 'durable native context must use the same canonical conversation referent projection');
    bf_assert($pdo->query('PRAGMA integrity_check')->fetchColumn() === 'ok' && $pdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'database integrity');
    fwrite(STDOUT, "AWH Async Conversation: PASS\n");
} finally {
    foreach (['AWH_PROJECT_VAULT_ROOT','AWH_ATTACHMENT_ROOT','AWH_PROVIDER_CREDENTIAL_ROOT','AWH_ARTIFACT_ROOT','AWH_TASK_WORKSPACE_ROOT','AWH_TASK_TRANSFER_ROOT'] as $key) putenv($key);
    bf_clean($root);
}
