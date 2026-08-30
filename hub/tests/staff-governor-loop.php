<?php

declare(strict_types=1);

foreach (['HubSchemaMigration','HubEnrollmentApiMigration','HubControlPlaneMigration','HubOwnerAuthMigration','HubAssistantWorkstreamMigration','HubWorkspaceContinuityMigration','HubUnifiedWorkspaceMigration','HubFinalProductMigration','HubFoundingMemoryMigration','HubSelfServiceMigration','HubCentralProjectAuthorityMigration','HubAnywhereExecutionMigration','HubCostAwareAiMigration','HubAutomationMigration','HubSelfSufficientAiMigration','HubEnrollmentService','HubControlPlaneService','HubExecutionTriageService','HubStaffGovernorService','HubStaffOperationsService'] as $class) require_once dirname(__DIR__) . '/src/' . $class . '.php';

function staff_loop_expect(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function staff_loop_uuid(): string { $bytes = random_bytes(16); $bytes[6] = chr((ord($bytes[6]) & 15) | 64); $bytes[8] = chr((ord($bytes[8]) & 63) | 128); return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4)); }
function staff_loop_clean(string $root): void { if (!is_dir($root)) return; $items = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST); foreach ($items as $item) { $path = $item->getPathname(); $item->isDir() && !$item->isLink() ? @rmdir($path) : @unlink($path); } @rmdir($root); }

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { fwrite(STDOUT, "AWH Staff Governor Loop: SKIP pdo_sqlite unavailable\n"); exit(77); }

$root = sys_get_temp_dir() . '/awh-staff-loop-' . bin2hex(random_bytes(6));
$base = dirname(__DIR__);
$database = $root . '/awh.sqlite';
$now = '2026-08-30T08:00:00+00:00';
$owner = '223b45c0-23e1-408d-ae0f-ac5eca7f6900';
$project = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
$roots = ['artifacts' => $root . '/artifacts', 'vault' => $root . '/vault', 'workspaces' => $root . '/workspaces', 'backups' => $root . '/backups'];

try {
    mkdir($root, 0700, true); foreach ($roots as $path) mkdir($path, 0700, true);
    putenv('AWH_ARTIFACT_ROOT=' . $roots['artifacts']); putenv('AWH_PROJECT_VAULT_ROOT=' . $roots['vault']); putenv('AWH_TASK_WORKSPACE_ROOT=' . $roots['workspaces']); putenv('AWH_HUB_BACKUP_ROOT=' . $roots['backups']); putenv('AWH_CONTROL_ORIGIN=https://awh.test');
    $pdo = new PDO('sqlite:' . $database, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys=ON'); $pdo->exec(file_get_contents($base . '/schema.sql'));
    foreach (['enrollment_rate_limits','device_project_memberships','device_tokens','pairing_projects','pairing_codes','user_project_memberships','device_enrollments','owner_bootstrap','hub_users'] as $table) $pdo->exec('DROP TABLE IF EXISTS ' . $table);
    $pdo->prepare('INSERT INTO projects(project_id,name,type,created_at,source_revision,observed_at,provenance) VALUES(:id,:name,:type,:at,NULL,:at,:provenance)')->execute(['id' => $project, 'name' => "Art's Workspace Hub", 'type' => 'awh-core', 'at' => $now, 'provenance' => 'staff-loop-fixture']);
    staff_loop_expect(HubSchemaMigration::apply($database, $base . '/migrations/001_m3e_enrollment.sql', $now, false, $base . '/schema.sql') === 'applied', 'M3E');
    staff_loop_expect(HubEnrollmentApiMigration::apply($database, $base . '/migrations/002_m3e2_enrollment_api.sql', $now) === 'applied', 'M3E2');
    HubEnrollmentService::openExisting($database)->initializeOwner($owner, 'Art Owner', [$project], $now);
    $chain = [[HubControlPlaneMigration::class,'003_m4_control_plane.sql'],[HubOwnerAuthMigration::class,'004_owner_auth.sql'],[HubAssistantWorkstreamMigration::class,'005_assistant_workstream.sql'],[HubWorkspaceContinuityMigration::class,'006_workspace_continuity.sql'],[HubUnifiedWorkspaceMigration::class,'007_unified_workspace.sql'],[HubFinalProductMigration::class,'008_final_product.sql'],[HubFoundingMemoryMigration::class,'009_founding_memory.sql'],[HubSelfServiceMigration::class,'010_self_service.sql'],[HubCentralProjectAuthorityMigration::class,'011_central_project_authority.sql'],[HubAnywhereExecutionMigration::class,'012_anywhere_execution_fabric.sql'],[HubCostAwareAiMigration::class,'013_cost_aware_ai.sql'],[HubAutomationMigration::class,'014_automations.sql'],[HubSelfSufficientAiMigration::class,'015_self_sufficient_ai.sql']];
    foreach ($chain as [$migration, $sql]) staff_loop_expect($migration::apply($database, $base . '/migrations/' . $sql, $now) === 'applied', $sql);

    // Historical failures and blocked capability work stay canonical evidence.
    $failedTask = staff_loop_uuid(); $failedExecution = staff_loop_uuid(); $staleTask = staff_loop_uuid(); $staleExecution = staff_loop_uuid(); $retryTask = staff_loop_uuid(); $retryExecution = staff_loop_uuid(); $defectTask = staff_loop_uuid(); $defectExecution = staff_loop_uuid(); $waitingTask = staff_loop_uuid(); $waitingExecution = staff_loop_uuid();
    $task = $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:id,:user,:project,:goal,:state,NULL,NULL,0,NULL,:code,:key,NULL,:at,:at,NULL)");
    $task->execute(['id'=>$failedTask,'user'=>$owner,'project'=>$project,'goal'=>'historical field proof fixture','state'=>'FAILED','code'=>'SCHEMA_FIELDS','key'=>'staff-loop-failed-0001','at'=>'2026-08-20T08:00:00+00:00']);
    $task->execute(['id'=>$staleTask,'user'=>$owner,'project'=>$project,'goal'=>'old production task retained for review','state'=>'FAILED','code'=>'SCHEMA_FIELDS','key'=>'staff-loop-stale-0001','at'=>'2026-08-20T08:00:00+00:00']);
    $task->execute(['id'=>$retryTask,'user'=>$owner,'project'=>$project,'goal'=>'provider work can retry under policy','state'=>'FAILED','code'=>'PROVIDER_UNAVAILABLE','key'=>'staff-loop-retry-0001','at'=>'2026-08-30T07:30:00+00:00']);
    $task->execute(['id'=>$defectTask,'user'=>$owner,'project'=>$project,'goal'=>'current unexplained production defect','state'=>'FAILED','code'=>'EXECUTION_FAILED','key'=>'staff-loop-defect-0001','at'=>'2026-08-30T07:40:00+00:00']);
    $task->execute(['id'=>$waitingTask,'user'=>$owner,'project'=>$project,'goal'=>'requires offline specialist fixture','state'=>'WAITING_FOR_WORKER','code'=>'PROVIDER_QUOTA_EXHAUSTED','key'=>'staff-loop-waiting-0001','at'=>'2026-08-30T07:00:00+00:00']);
    $execution = $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:id,:task,:project,NULL,:kind,:capability,:state,NULL,NULL,:attempts,NULL,'{}',:code,:at,:at)");
    $execution->execute(['id'=>$failedExecution,'task'=>$failedTask,'project'=>$project,'kind'=>'VPS','capability'=>'project.read','state'=>'FAILED','attempts'=>3,'code'=>'SCHEMA_FIELDS','at'=>'2026-08-20T08:00:00+00:00']);
    $execution->execute(['id'=>$staleExecution,'task'=>$staleTask,'project'=>$project,'kind'=>'VPS','capability'=>'project.read','state'=>'FAILED','attempts'=>3,'code'=>'SCHEMA_FIELDS','at'=>'2026-08-20T08:00:00+00:00']);
    $execution->execute(['id'=>$retryExecution,'task'=>$retryTask,'project'=>$project,'kind'=>'VPS','capability'=>'agent.conversation','state'=>'FAILED','attempts'=>1,'code'=>'PROVIDER_UNAVAILABLE','at'=>'2026-08-30T07:30:00+00:00']);
    $execution->execute(['id'=>$defectExecution,'task'=>$defectTask,'project'=>$project,'kind'=>'VPS','capability'=>'project.read','state'=>'FAILED','attempts'=>3,'code'=>'EXECUTION_FAILED','at'=>'2026-08-30T07:40:00+00:00']);
    $execution->execute(['id'=>$waitingExecution,'task'=>$waitingTask,'project'=>$project,'kind'=>'CODEX','capability'=>'code.specialist','state'=>'WAITING_FOR_CAPABILITY','attempts'=>0,'code'=>'WAITING_FOR_CAPABILITY','at'=>'2026-08-30T07:00:00+00:00']);

    $control = HubControlPlaneService::openExisting($database);
    $governor = new HubStaffGovernorService($pdo, static fn (string $signal, string $occurrenceAt): array => $control->materializeStaffMaintenanceSubmission($signal, $occurrenceAt));
    $decision = $governor->tick($now);
    staff_loop_expect(($decision['decision'] ?? null) === 'CREATE_CANONICAL_TASK' && ($decision['created'] ?? false) === true, 'Governor must create one bounded canonical maintenance task when only blocked/failed work remains');
    $staffTask = $decision['selectedWork']['taskId'] ?? null; staff_loop_expect(is_string($staffTask), 'Governor must return the selected canonical task');
    staff_loop_expect((int) $pdo->query("SELECT COUNT(*) FROM control_tasks WHERE idempotency_key LIKE 'staff.platform-daily-audit.%'")->fetchColumn() === 1, 'Governor must use the canonical task table exactly once');
    $queued = $pdo->prepare('SELECT required_capability,state,checkpoint_json FROM control_task_executions WHERE task_id=:task'); $queued->execute(['task'=>$staffTask]); $queuedRow = $queued->fetch();
    staff_loop_expect(is_array($queuedRow) && $queuedRow['required_capability'] === 'artifact.object' && $queuedRow['state'] === 'QUEUED' && (json_decode((string)$queuedRow['checkpoint_json'], true)['mode'] ?? null) === 'STAFF_PLATFORM_AUDIT', 'Staff work must use the bounded artifact capability and durable execution authority');
    $sameTick = $governor->tick('2026-08-30T08:00:01+00:00');
    staff_loop_expect(($sameTick['decision'] ?? null) === 'SELECT_EXISTING_CANONICAL_TASK' && (int) $pdo->query("SELECT COUNT(*) FROM control_tasks WHERE idempotency_key LIKE 'staff.platform-daily-audit.%'")->fetchColumn() === 1, 'Governor must select existing eligible work without duplicating it');

    $batch = HubDurableExecutionService::fromEnvironment($pdo)->runBatch(4, '2026-08-30T08:00:02+00:00');
    staff_loop_expect(($batch['processed'] ?? 0) === 1 && ($batch['completed'] ?? 0) === 1, 'VPS executor must complete the Staff maintenance task');
    $artifact = $pdo->prepare("SELECT a.kind,o.storage_key FROM control_artifacts a JOIN control_artifact_objects o ON o.artifact_id=a.artifact_id WHERE a.task_id=:task"); $artifact->execute(['task'=>$staffTask]); $artifactRow = $artifact->fetch();
    staff_loop_expect(is_array($artifactRow) && $artifactRow['kind'] === 'staff-platform-audit', 'Staff verification must persist one canonical audit artifact');
    $report = json_decode((string) file_get_contents(HubArtifactStore::fromEnvironment()->read((string)$artifactRow['storage_key'])), true, 64, JSON_THROW_ON_ERROR);
    staff_loop_expect(($report['database']['integrity'] ?? null) === 'PASS' && ($report['database']['foreignKeys'] ?? null) === 'PASS', 'Staff artifact must verify database integrity and FK');
    staff_loop_expect(($report['executionTriage']['summary']['blockedCapability'] ?? 0) === 1, 'Staff artifact must preserve and classify blocked capability work');
    staff_loop_expect(($report['executionTriage']['summary']['obsoleteStale'] ?? 0) === 1, 'Staff artifact must classify stale historical failure without deleting it');
    staff_loop_expect(($report['executionTriage']['summary']['historicalExpected'] ?? 0) === 1 && ($report['executionTriage']['summary']['retryable'] ?? 0) === 1 && ($report['executionTriage']['summary']['currentDefect'] ?? 0) === 1, 'Staff artifact must distinguish historical, retryable and current-defect failures');
    staff_loop_expect((int) $pdo->query("SELECT COUNT(*) FROM control_task_executions WHERE execution_id IN ('$failedExecution','$staleExecution','$retryExecution','$defectExecution','$waitingExecution')")->fetchColumn() === 5, 'Staff must never delete failed/waiting audit evidence');

    $telemetry = ['state'=>'READY','server'=>['services'=>[['key'=>'nginx','state'=>'ACTIVE'],['key'=>'php-fpm','state'=>'ACTIVE']],'security'=>['fail2ban'=>'ACTIVE','automaticUpdates'=>'ACTIVE']]];
    $release = ['controlReleaseId'=>'m16-fixture','webReleaseId'=>'m16-fixture','pointersMatch'=>true];
    $snapshot = (new HubStaffOperationsService($pdo, $database, new HubStorageGovernanceService(['hubData'=>$root,'backups'=>$roots['backups']])))->snapshot('2026-08-30T08:00:03+00:00', $batch, $telemetry, $release, $decision);
    foreach ($snapshot['loop']['phases'] as $phase) staff_loop_expect(($phase['state'] ?? null) === 'PASS' || (($phase['name'] ?? null) === 'CONTINUE' && ($phase['state'] ?? null) === 'READY'), 'completed Staff field loop must prove every phase');
    staff_loop_expect(($snapshot['governor']['decision'] ?? null) === 'CREATE_CANONICAL_TASK' && ($snapshot['report']['REAL_STATE'] ?? null) === 'COMPLETED', 'Staff report must reflect the real Governor run rather than a post-run idle snapshot');
    staff_loop_expect(($snapshot['executionTriage']['summary'] ?? null) === ($report['executionTriage']['summary'] ?? null), 'Owner Staff projection and canonical audit artifact must share one triage authority');
    staff_loop_expect($pdo->query('PRAGMA integrity_check')->fetchColumn() === 'ok' && $pdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'Staff field loop preserves database integrity/FK');
    fwrite(STDOUT, "AWH Staff Governor Loop: PASS\n");
} finally {
    foreach (['AWH_ARTIFACT_ROOT','AWH_PROJECT_VAULT_ROOT','AWH_TASK_WORKSPACE_ROOT','AWH_HUB_BACKUP_ROOT','AWH_CONTROL_ORIGIN'] as $name) putenv($name);
    staff_loop_clean($root);
}
