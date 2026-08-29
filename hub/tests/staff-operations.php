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
        CREATE TABLE control_tasks(task_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE control_task_executions(execution_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, project_id TEXT NOT NULL, executor_kind TEXT NOT NULL, required_capability TEXT NOT NULL, state TEXT NOT NULL, lease_expires_at TEXT, last_error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE control_workers(device_id TEXT PRIMARY KEY, state TEXT NOT NULL);");
    $pdo->exec("INSERT INTO projects VALUES('p1','AWH test project'); INSERT INTO control_tasks VALUES('t1','p1','QUEUED','2026-08-30T00:00:00Z'); INSERT INTO control_task_executions VALUES('e1','t1','p1','VPS','project.read','QUEUED',NULL,NULL,'2026-08-30T00:00:00Z','2026-08-30T00:00:00Z'); INSERT INTO control_workers VALUES('w1','READY');");
    $telemetry = ['state' => 'READY', 'server' => ['services' => [['key' => 'nginx', 'state' => 'ACTIVE'], ['key' => 'php-fpm', 'state' => 'ACTIVE']], 'security' => ['fail2ban' => 'ACTIVE', 'automaticUpdates' => 'ACTIVE']]];
    $release = ['controlReleaseId' => 'm16-test', 'webReleaseId' => 'm16-test', 'pointersMatch' => true];
    $storage = new HubStorageGovernanceService(['hubData' => $root, 'backups' => $backup]);
    $snapshot = (new HubStaffOperationsService($pdo, $dbPath, $storage))->snapshot('2026-08-30T00:00:30Z', null, $telemetry, $release);
    staff_expect(($snapshot['loop']['nextEligible']['taskId'] ?? null) === 't1', 'staff must select the canonical eligible task');
    staff_expect(count($snapshot['roles']) === 10, 'all Staff roles must be projected');
    staff_expect(($snapshot['database']['state'] ?? null) === 'HEALTHY', 'database projection must be healthy');
    staff_expect(($snapshot['safety']['canonicalAuthoritiesOnly'] ?? false) === true && ($snapshot['safety']['newTables'] ?? true) === false, 'staff must not create a shadow authority');
    staff_expect(($snapshot['morningBrief']['canonicalAuthorities']['projects'] ?? 0) === 1, 'morning brief must expose canonical project count');
    staff_expect(($snapshot['storageGovernance']['actions']['purged'] ?? -1) === 0, 'storage audit must not purge');
    fwrite(STDOUT, "AWH Staff Operations: PASS\n");
} finally {
    $pdo = null;
    putenv('AWH_HUB_BACKUP_ROOT');
    staff_remove($root);
}
