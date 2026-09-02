<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubStaffOperationsService.php';

function staff_expect(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function staff_remove(string $path): void
{
    if (!is_dir($path)) return;
    foreach (scandir($path) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') continue;
        $item = $path . DIRECTORY_SEPARATOR . $entry;
        if (is_dir($item) && !is_link($item)) staff_remove($item); else @unlink($item);
    }
    @rmdir($path);
}

$root = sys_get_temp_dir() . '/awh-staff-' . bin2hex(random_bytes(5));
$backup = $root . '/backups';
$dbPath = $root . '/authority.sqlite';
mkdir($backup, 0700, true);
putenv('AWH_HUB_BACKUP_ROOT=' . $backup);

try {
    $pdo = new PDO('sqlite:' . $dbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 7500; PRAGMA user_version = 16;');
    $pdo->exec("CREATE TABLE projects(project_id TEXT PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE owner_bootstrap(singleton_id INTEGER PRIMARY KEY, owner_user_id TEXT NOT NULL, initialized_at TEXT NOT NULL, bootstrap_closed INTEGER NOT NULL);
        CREATE TABLE control_product_setting_revisions(revision_id TEXT PRIMARY KEY, setting_key TEXT NOT NULL, revision_no INTEGER NOT NULL, value_json TEXT NOT NULL, updated_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE control_tasks(task_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, goal TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE control_task_executions(execution_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, project_id TEXT NOT NULL, executor_kind TEXT NOT NULL, required_capability TEXT NOT NULL, state TEXT NOT NULL, lease_expires_at TEXT, attempt_count INTEGER NOT NULL, last_error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE control_workers(device_id TEXT PRIMARY KEY, state TEXT NOT NULL);");
    $pdo->exec("INSERT INTO projects VALUES('p1','AWH test project'); INSERT INTO owner_bootstrap VALUES(1,'owner-1','2026-08-30T00:00:00Z',1); INSERT INTO control_tasks VALUES('t1','p1','fixture queued task','QUEUED','2026-08-30T00:00:00Z'); INSERT INTO control_task_executions VALUES('e1','t1','p1','VPS','project.read','QUEUED',NULL,0,NULL,'2026-08-30T00:00:00Z','2026-08-30T00:00:00Z'); INSERT INTO control_workers VALUES('w1','READY');");
    $telemetry = ['state' => 'READY', 'server' => ['services' => [['key' => 'nginx', 'state' => 'ACTIVE'], ['key' => 'php-fpm', 'state' => 'ACTIVE']], 'security' => ['fail2ban' => 'ACTIVE', 'automaticUpdates' => 'ACTIVE']]];
    $release = ['controlReleaseId' => 'm16-test', 'webReleaseId' => 'm16-test', 'pointersMatch' => true];
    $storage = new HubStorageGovernanceService(['hubData' => $root, 'backups' => $backup]);
    $snapshot = (new HubStaffOperationsService($pdo, $dbPath, $storage))->snapshot('2026-08-30T00:00:30Z', null, $telemetry, $release);
    staff_expect(($snapshot['loop']['nextEligible']['taskId'] ?? null) === 't1', 'staff must select the canonical eligible task');
    staff_expect(count($snapshot['roles']) === 14, 'all Staff roles must be projected');
    staff_expect(($snapshot['governor']['decision'] ?? null) === 'SELECT_EXISTING_CANONICAL_TASK', 'Governor must select existing canonical work');
    staff_expect(($snapshot['database']['state'] ?? null) === 'HEALTHY', 'database projection must be healthy');
    staff_expect(($snapshot['executionTriage']['total'] ?? -1) === 0 && ($snapshot['executionTriage']['auditHistoryPreserved'] ?? false) === true, 'Owner Staff projection must expose bounded canonical execution triage');
    staff_expect(($snapshot['safety']['canonicalAuthoritiesOnly'] ?? false) === true && ($snapshot['safety']['newTables'] ?? true) === false, 'staff must not create a shadow authority');
    staff_expect(($snapshot['morningBrief']['canonicalAuthorities']['projects'] ?? 0) === 1, 'morning brief must expose canonical project count');
    staff_expect(($snapshot['storageGovernance']['actions']['purged'] ?? -1) === 0, 'storage audit must not purge');
    staff_expect(array_key_exists('UNKNOWN', $snapshot['storageGovernance']['summary'] ?? []), 'storage audit must retain an UNKNOWN classification');
    staff_expect(($snapshot['storageGovernance']['disk']['state'] ?? null) === 'READY', 'storage audit must measure filesystem capacity');
    $oldTemp = $root . '/old-worker.part'; file_put_contents($oldTemp, 'bounded stale temp'); touch($oldTemp, strtotime('2026-08-28T00:00:00Z'));
    $retain = $root . '/candidate-review'; mkdir($retain, 0700, true); file_put_contents($retain . '/evidence.txt', 'retain me');
    $housekeepingRun = $storage->housekeep('2026-08-30T00:00:30Z', ['control' => 'm16-test', 'web' => 'm16-test']);
    staff_expect(($housekeepingRun['state'] ?? null) === 'CLEANED' && ($housekeepingRun['purged'] ?? 0) === 1, 'bounded housekeeping must purge exactly one verified stale temp');
    staff_expect(!file_exists($oldTemp) && is_file($retain . '/evidence.txt'), 'housekeeping must not touch quarantine/review evidence or retained content');
    staff_expect(($housekeepingRun['referenceChecked'] ?? 0) === 1 && ($housekeepingRun['verified'] ?? 0) === 1 && ($housekeepingRun['unknownRetained'] ?? false) === true, 'housekeeping must prove reference-check and quarantine verification before purge');
    $withRun = (new HubStaffOperationsService($pdo, $dbPath, $storage))->snapshot('2026-08-30T00:00:31Z', null, $telemetry, $release, null, $housekeepingRun);
    staff_expect(($withRun['housekeeping']['state'] ?? null) === 'CLEANED' && ($withRun['morningBrief']['storage']['housekeeping']['purge'] ?? 0) === 1, 'Morning Brief must retain verified housekeeping evidence');
    $pdo->exec("INSERT INTO control_tasks VALUES
        ('failed-old','p1','production provider request','FAILED','2026-08-30T00:01:00Z'),
        ('success-new','p1','provider request recovered','COMPLETED','2026-08-30T00:02:00Z'),
        ('failed-current','p1','current schema defect','FAILED','2026-08-30T00:03:00Z'),
        ('waiting','p1','budget paused provider work','WAITING_FOR_CAPABILITY','2026-08-30T00:04:00Z'),
        ('waiting-source','p1','managed hosting source setup','WAITING_FOR_CAPABILITY','2026-08-30T00:05:00Z');
        INSERT INTO control_task_executions VALUES
        ('failed-old-ex','failed-old','p1','VPS','project.read','FAILED',NULL,3,'PROVIDER_FAILED','2026-08-30T00:01:00Z','2026-08-30T00:01:00Z'),
        ('success-new-ex','success-new','p1','VPS','project.read','COMPLETED',NULL,1,NULL,'2026-08-30T00:02:00Z','2026-08-30T00:02:00Z'),
        ('failed-current-ex','failed-current','p1','VPS','document.generate','FAILED',NULL,3,'SCHEMA_FIELDS','2026-08-30T00:03:00Z','2026-08-30T00:03:00Z'),
        ('waiting-ex','waiting','p1','VPS','provider.invoke','WAITING_FOR_CAPABILITY',NULL,1,'BUDGET_EXHAUSTED','2026-08-30T00:04:00Z','2026-08-30T00:04:00Z'),
        ('waiting-source-ex','waiting-source','p1','VPS','hosting.site.provision','WAITING_FOR_CAPABILITY',NULL,0,'PROJECT_SOURCE_NOT_READY','2026-08-30T00:05:00Z','2026-08-30T00:05:00Z');");
    $rowsBeforeTriage = (int) $pdo->query('SELECT COUNT(*) FROM control_task_executions')->fetchColumn();
    $triage = (new HubExecutionTriageService($pdo))->snapshot('2026-08-30T00:10:00Z');
    $byId = [];
    foreach ($triage['items'] as $item) $byId[$item['executionId']] = $item;
    staff_expect(($byId['failed-old-ex']['classification'] ?? null) === 'OBSOLETE_STALE', 'a later successful execution for the same project/capability must supersede old failure noise');
    staff_expect(($byId['failed-old-ex']['supersededByExecutionId'] ?? null) === 'success-new-ex', 'triage must show the objective superseding execution');
    staff_expect(($byId['failed-current-ex']['classification'] ?? null) === 'CURRENT_DEFECT', 'unresolved recent failure must remain a current defect');
    staff_expect(($byId['waiting-ex']['classification'] ?? null) === 'POLICY_PAUSED' && ($byId['waiting-ex']['active'] ?? true) === false, 'budget pause must remain visible without becoming an alerting blocker');
    staff_expect(($byId['waiting-source-ex']['classification'] ?? null) === 'SETUP_REQUIRED' && ($byId['waiting-source-ex']['active'] ?? false) === true, 'missing canonical source must be an actionable setup requirement');
    staff_expect(($triage['policyVersion'] ?? null) === 'execution-triage-v2', 'triage policy version must identify objective supersession support');
    staff_expect(($triage['current']['total'] ?? null) === 2, 'current triage must exclude superseded audit-only failures');
    staff_expect(($triage['current']['summary']['currentDefect'] ?? null) === 1 && ($triage['current']['summary']['setupRequired'] ?? null) === 1 && ($triage['current']['summary']['blockedCapability'] ?? null) === 0, 'current triage must retain only alerting defect/setup blockers');
    staff_expect(($triage['nonAlerting']['policyPausedCount'] ?? null) === 1, 'current budget pause must stay visible in the non-alerting projection');
    staff_expect((int) $pdo->query('SELECT COUNT(*) FROM control_task_executions')->fetchColumn() === $rowsBeforeTriage, 'triage must preserve every canonical audit row');
    $service = new HubStaffOperationsService($pdo, $dbPath, $storage);
    $postTriage = $service->snapshot('2026-08-30T00:10:00Z', null, $telemetry, $release);
    staff_expect(($postTriage['morningBrief']['overnight']['executionTriage']['currentDefect'] ?? null) === 1 && ($postTriage['morningBrief']['overnight']['executionTriage']['setupRequired'] ?? null) === 1 && ($postTriage['morningBrief']['overnight']['executionTriage']['blockedCapability'] ?? null) === 0, 'Morning Brief must project current alerting execution blockers rather than policy pauses or audit history');
    staff_expect(!array_key_exists('historicalExpected', $postTriage['morningBrief']['overnight']['executionTriage'] ?? []) && !array_key_exists('obsoleteStale', $postTriage['morningBrief']['overnight']['executionTriage'] ?? []), 'Morning Brief current blocker summary must not present historical audit classifications as live state');
    $persisted = $service->persistMorningBrief($snapshot['morningBrief']);
    staff_expect(($persisted['state'] ?? null) === 'PERSISTED', 'morning brief must persist in the existing revision ledger');
    $again = $service->persistMorningBrief($snapshot['morningBrief']);
    staff_expect(($again['revision'] ?? null) === ($persisted['revision'] ?? null), 'morning brief persistence must be idempotent per day');
    $changed = $snapshot['morningBrief']; $changed['release']['web'] = 'm16-next'; $changed['release']['pointersMatch'] = false;
    $updated = $service->persistMorningBrief($changed, '2026-08-30T00:01:00Z');
    staff_expect(($updated['state'] ?? null) === 'PERSISTED' && (int) ($updated['revision'] ?? 0) === (int) ($persisted['revision'] ?? 0) + 1, 'material morning brief changes must create a new durable revision');
    staff_expect(($service->latestMorningBrief()['state'] ?? null) === 'PERSISTED', 'latest morning brief must survive as durable state');
    fwrite(STDOUT, "AWH Staff Operations: PASS\n");
} finally {
    $pdo = null;
    putenv('AWH_HUB_BACKUP_ROOT');
    staff_remove($root);
}
