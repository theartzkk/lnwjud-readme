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
require_once dirname(__DIR__) . '/src/HubCostAwareAiMigration.php';
require_once dirname(__DIR__) . '/src/HubAutomationMigration.php';
require_once dirname(__DIR__) . '/src/HubAutomationRegistryService.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentService.php';

function m15_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function m15_uuid(): string { $bytes = random_bytes(16); $bytes[6] = chr((ord($bytes[6]) & 15) | 64); $bytes[8] = chr((ord($bytes[8]) & 63) | 128); return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4)); }
function m15_clean(string $root): void { if (!is_dir($root)) return; $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST); foreach ($files as $file) { $path = $file->getPathname(); $file->isDir() && !$file->isLink() ? @rmdir($path) : @unlink($path); } @rmdir($root); }

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { fwrite(STDOUT, "AWH M15 Automation Registry: SKIP pdo_sqlite unavailable\n"); exit(77); }

$root = sys_get_temp_dir() . '/awh-m15-' . bin2hex(random_bytes(6));
$base = dirname(__DIR__);
$now = '2026-08-27T15:30:00+00:00';
$owner = '223b45c0-23e1-408d-ae0f-ac5eca7f6900';
$project = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
$projectTwo = '313b45c0-23e1-408d-ae0f-ac5eca7f6900';

try {
    mkdir($root, 0700, true);
    $db = $root . '/awh.sqlite';
    $pdo = new PDO('sqlite:' . $db, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec(file_get_contents($base . '/schema.sql'));
    foreach (['enrollment_rate_limits','device_project_memberships','device_tokens','pairing_projects','pairing_codes','user_project_memberships','device_enrollments','owner_bootstrap','hub_users'] as $table) $pdo->exec('DROP TABLE IF EXISTS ' . $table);
    $insertProject = $pdo->prepare('INSERT INTO projects(project_id,name,type,created_at,source_revision,observed_at,provenance) VALUES(:id,:name,:type,:at,NULL,:at,:provenance)');
    $insertProject->execute(['id'=>$project,'name'=>'Automation Project','type'=>'php','at'=>$now,'provenance'=>'m15-fixture']);
    $insertProject->execute(['id'=>$projectTwo,'name'=>'Second Project','type'=>'php','at'=>$now,'provenance'=>'m15-fixture']);

    m15_assert(HubSchemaMigration::apply($db, $base . '/migrations/001_m3e_enrollment.sql', $now, false, $base . '/schema.sql') === 'applied', 'M3E');
    m15_assert(HubEnrollmentApiMigration::apply($db, $base . '/migrations/002_m3e2_enrollment_api.sql', $now) === 'applied', 'M3E2');
    HubEnrollmentService::openExisting($db)->initializeOwner($owner, 'Art', [$project, $projectTwo], $now);
    foreach ([[HubControlPlaneMigration::class,'003_m4_control_plane.sql'],[HubOwnerAuthMigration::class,'004_owner_auth.sql'],[HubAssistantWorkstreamMigration::class,'005_assistant_workstream.sql'],[HubWorkspaceContinuityMigration::class,'006_workspace_continuity.sql'],[HubUnifiedWorkspaceMigration::class,'007_unified_workspace.sql']] as [$migration,$sql]) m15_assert($migration::apply($db, $base . '/migrations/' . $sql, $now) === 'applied', $sql);
    m15_assert(HubFinalProductMigration::apply($db, $base . '/migrations/008_final_product.sql', $now) === 'applied', 'M9');
    m15_assert(HubFoundingMemoryMigration::apply($db, $base . '/migrations/009_founding_memory.sql', $now) === 'applied', 'M10');
    m15_assert(HubSelfServiceMigration::apply($db, $base . '/migrations/010_self_service.sql', $now) === 'applied', 'M11');
    m15_assert(HubCentralProjectAuthorityMigration::apply($db, $base . '/migrations/011_central_project_authority.sql', $now) === 'applied', 'M12');
    m15_assert(HubAnywhereExecutionMigration::apply($db, $base . '/migrations/012_anywhere_execution_fabric.sql', $now) === 'applied', 'M13');
    m15_assert(HubCostAwareAiMigration::apply($db, $base . '/migrations/013_cost_aware_ai.sql', $now) === 'applied', 'M14');
    m15_assert((int)$pdo->query('PRAGMA user_version')->fetchColumn() === 14, 'M14 baseline');

    m15_assert(HubAutomationMigration::apply($db, $base . '/migrations/014_automations.sql', $now) === 'applied', 'M15 migration');
    m15_assert(HubAutomationMigration::apply($db, $base . '/migrations/014_automations.sql', $now) === 'already-applied', 'M15 idempotence');
    m15_assert((int)$pdo->query('PRAGMA user_version')->fetchColumn() === 15, 'M15 version');
    m15_assert((int)$pdo->query("SELECT COUNT(*) FROM awh_schema_migrations WHERE migration_id='m15-automation-registry'")->fetchColumn() === 1, 'M15 ledger');
    m15_assert($pdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'M15 foreign keys');

    $conversation = m15_uuid();
    $pdo->prepare("INSERT INTO control_conversations(conversation_id,user_id,project_id,created_at,updated_at,last_task_id,title,archived_at,origin) VALUES(:id,:user,:project,:at,:at,NULL,'Automation Chat',NULL,'native')")
        ->execute(['id'=>$conversation,'user'=>$owner,'project'=>$project,'at'=>$now]);
    $tasksBefore = (int)$pdo->query('SELECT COUNT(*) FROM control_tasks')->fetchColumn();
    $registry = new HubAutomationRegistryService($pdo);

    $exact = $registry->create($owner, [
        'projectId'=>$project,'conversationId'=>$conversation,'name'=>'Morning brief','goal'=>'สรุปงานเช้าสำหรับวันนี้','timingMode'=>'exact_schedule',
        'scheduleIcal'=>"BEGIN:VEVENT\nDTSTART:20260828T080000\nRRULE:FREQ=DAILY\nEND:VEVENT",'enabled'=>true,
    ], $now);
    m15_assert(($exact['enabled'] ?? false) === true && ($exact['timingMode'] ?? null) === 'exact_schedule', 'exact automation created');
    m15_assert(($exact['conversationId'] ?? null) === $conversation, 'conversation bound');

    $updated = $registry->replace($owner, $exact['automationId'], [
        'projectId'=>$project,'conversationId'=>$conversation,'name'=>'Morning brief updated','goal'=>'สรุปงานเช้าแบบสั้น','timingMode'=>'flexible_schedule',
        'scheduleIcal'=>"BEGIN:VEVENT\nDTSTART:20260828T080000\nRRULE:FREQ=DAILY\nEND:VEVENT",'enabled'=>true,
    ], '2026-08-27T15:31:00+00:00');
    m15_assert(($updated['timingMode'] ?? null) === 'flexible_schedule' && ($updated['name'] ?? null) === 'Morning brief updated', 'automation replaced');

    $watch = $registry->create($owner, [
        'projectId'=>$project,'name'=>'Worker availability','goal'=>'แจ้งเมื่อ worker ที่ต้องใช้พร้อม','timingMode'=>'condition_watch',
        'scheduleIcal'=>"BEGIN:VEVENT\nRRULE:FREQ=HOURLY\nEND:VEVENT",'conditionKey'=>'worker.ready','conditionDescription'=>'worker ที่เหมาะกับงานกลับมาออนไลน์','enabled'=>true,
    ], '2026-08-27T15:32:00+00:00');
    m15_assert(($watch['conditionKey'] ?? null) === 'worker.ready' && ($watch['conversationId'] ?? 'not-null') === null, 'condition watch created');

    $disabled = $registry->setEnabled($owner, $watch['automationId'], false, '2026-08-27T15:33:00+00:00');
    m15_assert(($disabled['enabled'] ?? true) === false, 'automation disabled');
    $archived = $registry->archive($owner, $watch['automationId'], '2026-08-27T15:34:00+00:00');
    m15_assert(($archived['archivedAt'] ?? null) !== null && ($archived['enabled'] ?? true) === false, 'automation archived without deletion');
    $archivedAgain = $registry->archive($owner, $watch['automationId'], '2026-08-27T15:35:00+00:00');
    m15_assert(($archivedAgain['archivedAt'] ?? null) === ($archived['archivedAt'] ?? null), 'archive idempotent');
    m15_assert(count($registry->listForUser($owner)) === 1 && count($registry->listForUser($owner, true)) === 2, 'archive visibility bounded');

    try {
        $registry->create($owner, ['projectId'=>$project,'name'=>'Invalid watch','goal'=>'invalid','timingMode'=>'condition_watch','scheduleIcal'=>"BEGIN:VEVENT\nDTSTART:20260828T080000\nEND:VEVENT",'conditionKey'=>'test.ready','conditionDescription'=>'test'], $now);
        throw new RuntimeException('condition watch without recurrence was accepted');
    } catch (HubAutomationRegistryException $error) { m15_assert($error->codeName === 'AUTOMATION_SCHEDULE_INVALID', 'condition recurrence rejected'); }

    try {
        $registry->create($owner, ['projectId'=>$projectTwo,'conversationId'=>$conversation,'name'=>'Cross project','goal'=>'invalid','timingMode'=>'exact_schedule','scheduleIcal'=>"BEGIN:VEVENT\nDTSTART:20260828T090000\nEND:VEVENT"], $now);
        throw new RuntimeException('cross-project conversation was accepted');
    } catch (HubAutomationRegistryException $error) { m15_assert($error->codeName === 'CONVERSATION_ACCESS_DENIED', 'cross-project conversation rejected'); }

    m15_assert((int)$pdo->query('SELECT COUNT(*) FROM control_tasks')->fetchColumn() === $tasksBefore, 'registry never creates canonical tasks early');
    m15_assert((int)$pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name LIKE 'control_automation_%' AND name <> 'control_automations'")->fetchColumn() === 0, 'no automation run queue or shadow authority');
    fwrite(STDOUT, "AWH M15 Automation Registry: PASS\n");
} finally {
    m15_clean($root);
}
