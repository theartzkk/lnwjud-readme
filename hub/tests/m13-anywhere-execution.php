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

function m13_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function m13_uuid(): string { $bytes = random_bytes(16); $bytes[6] = chr((ord($bytes[6]) & 15) | 64); $bytes[8] = chr((ord($bytes[8]) & 63) | 128); return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4)); }
function m13_clean(string $root): void { if (!is_dir($root)) return; $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST); foreach ($files as $file) { $path = $file->getPathname(); $file->isDir() && !$file->isLink() ? @rmdir($path) : @unlink($path); } @rmdir($root); }

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { fwrite(STDOUT, "AWH M13 Anywhere Execution: SKIP pdo_sqlite unavailable\n"); exit(77); }

$root = sys_get_temp_dir() . '/awh-m13-' . bin2hex(random_bytes(6));
$base = dirname(__DIR__); $now = gmdate('c');
$owner = '223b45c0-23e1-408d-ae0f-ac5eca7f6900';
$project = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
$device = '423b45c0-23e1-408d-ae0f-ac5eca7f6900';
try {
    mkdir($root, 0700, true); $db = $root . '/awh.sqlite';
    $pdo = new PDO('sqlite:' . $db, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec(file_get_contents($base . '/schema.sql'));
    foreach (['enrollment_rate_limits','device_project_memberships','device_tokens','pairing_projects','pairing_codes','user_project_memberships','device_enrollments','owner_bootstrap','hub_users'] as $table) $pdo->exec('DROP TABLE IF EXISTS ' . $table);
    $pdo->prepare('INSERT INTO projects(project_id,name,type,created_at,source_revision,observed_at,provenance) VALUES(:id,:name,:type,:at,NULL,:at,:provenance)')->execute(['id'=>$project,'name'=>'Anywhere Fixture','type'=>'php','at'=>$now,'provenance'=>'m13-fixture']);
    m13_assert(HubSchemaMigration::apply($db, $base . '/migrations/001_m3e_enrollment.sql', $now, false, $base . '/schema.sql') === 'applied', 'M3E');
    m13_assert(HubEnrollmentApiMigration::apply($db, $base . '/migrations/002_m3e2_enrollment_api.sql', $now) === 'applied', 'M3E2');
    HubEnrollmentService::openExisting($db)->initializeOwner($owner, 'Art', [$project], $now);
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
    $registry->syncDeviceWorker($device, ['project.read','codex:cli','git','browser_debug_context','office'], 'READY', $now);
    $stillCloud = $registry->route('project.read', $now);
    m13_assert(($stillCloud['providerId'] ?? null) === 'vps-native', 'optional device never becomes a hidden dependency for cloud-capable work');
    $specialist = $registry->route('code.specialist', $now);
    m13_assert(($specialist['providerId'] ?? null) === 'device:' . $device, 'Codex CLI is exposed only as the human-facing specialist capability');

    $specialistTask = m13_uuid(); $specialistExecution = m13_uuid();
    $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,'specialist','WAITING_FOR_WORKER',NULL,NULL,0,NULL,NULL,:key,NULL,:at,:at,NULL)")->execute(['task'=>$specialistTask,'user'=>$owner,'project'=>$project,'key'=>'m13-specialist-task-0001','at'=>$now]);
    $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,NULL,'CODEX','codex:cli','WAITING_FOR_CAPABILITY',NULL,NULL,0,NULL,'{}',NULL,:at,:at)")->execute(['execution'=>$specialistExecution,'task'=>$specialistTask,'project'=>$project,'at'=>$now]);
    $specialistEnvelope = $registry->ensureExecutionEnvelope($specialistExecution, $now);
    m13_assert(($specialistEnvelope['providerId'] ?? null) === 'device:' . $device && ($specialistEnvelope['mutationScope'] ?? null) === 'DEVICE_WORKSPACE', 'legacy codex:cli contract resolves through the specialist alias without changing the execution row');
    $registry->syncDeviceWorker($device, [], 'OFFLINE', gmdate('c', strtotime($now) + 30));
    m13_assert($registry->route('code.specialist', gmdate('c', strtotime($now) + 30)) === null, 'offline optional device disappears from routing truthfully');

    $after = $registry->status(false, $now);
    $visible = array_column($after['capabilities'], 'state', 'capability');
    m13_assert(($visible['project.mutate.assisted'] ?? null) === 'READY', 'Cloud-assisted source editing is visible as ready');
    m13_assert(($visible['voice.tts'] ?? null) === 'PLANNED' && ($visible['video.render'] ?? null) === 'PLANNED', 'future voice/video capabilities are truthful planned entries');
    m13_assert($pdo->query('PRAGMA integrity_check')->fetchColumn() === 'ok' && $pdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'M13 preserves database integrity and foreign keys');
    fwrite(STDOUT, "AWH M13 Anywhere Execution: PASS\n");
} finally {
    m13_clean($root);
}
