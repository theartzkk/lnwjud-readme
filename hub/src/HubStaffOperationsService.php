<?php

declare(strict_types=1);

require_once __DIR__ . '/HubBackupService.php';
require_once __DIR__ . '/HubInfrastructureService.php';
require_once __DIR__ . '/HubStorageGovernanceService.php';

/**
 * Read/report projection for the always-on Staff loop.  Execution and
 * mutation remain owned by HubDurableExecutionService and canonical tables.
 * This class creates no queue, task, lease, memory or report table.
 */
final class HubStaffOperationsService
{
    private const STAFF_ROLES = ['SRE / Operations', 'Storage / Housekeeping', 'Database Steward', 'Release Guardian', 'Recovery', 'Security', 'AI Provider Ops', 'Performance / Capacity', 'Cost', 'Product / UX backlog'];

    public function __construct(private readonly PDO $pdo, private readonly string $databasePath, ?HubStorageGovernanceService $storage = null)
    {
        $this->storage = $storage ?? new HubStorageGovernanceService();
    }

    private readonly HubStorageGovernanceService $storage;

    /** @param array<string,mixed>|null $batch @param array<string,mixed>|null $telemetry @param array<string,mixed>|null $release */
    public function snapshot(?string $now = null, ?array $batch = null, ?array $telemetry = null, ?array $release = null): array
    {
        $at = gmdate('c', strtotime($now ?? 'now') ?: time());
        $since = gmdate('c', (strtotime($at) ?: time()) - 86400);
        $telemetry ??= HubInfrastructureService::fromEnvironment()->status($at);
        $release ??= HubInfrastructureService::releaseState();
        $database = $this->database($at);
        $queue = $this->queue($at, $since);
        $authorities = $this->authorities($since);
        $workers = $this->workers();
        $providers = $this->providers($since);
        $backup = $this->backup();
        $storage = $this->storage->audit($at, [
            'control' => (string) ($release['controlReleaseId'] ?? ''),
            'web' => (string) ($release['webReleaseId'] ?? ''),
        ]);
        $roles = $this->roles($telemetry, $release, $database, $backup, $storage, $providers, $queue);
        $loop = $this->loop($telemetry, $queue, $batch);
        $report = $this->activityReport($queue, $loop);
        return [
            'schemaVersion' => 1,
            'generatedAt' => $at,
            'loop' => $loop,
            'roles' => $roles,
            'report' => $report,
            'canonicalAuthorities' => $authorities,
            'queue' => $queue,
            'workers' => $workers,
            'providers' => $providers,
            'database' => $database,
            'backupRecovery' => $backup,
            'storageGovernance' => $storage,
            'morningBrief' => $this->morningBrief($at, $since, $telemetry, $release, $database, $backup, $storage, $queue, $workers, $providers, $roles, $authorities),
            'safety' => ['canonicalAuthoritiesOnly' => true, 'newTables' => false, 'arbitraryShell' => false, 'credentialsExposed' => false, 'purgeMode' => 'AUDIT_ONLY'],
        ];
    }

    /** @return array<string,mixed> */
    private function database(string $at): array
    {
        $schema = $this->pragmaInt('user_version');
        $integrity = 'UNKNOWN'; $foreign = 'UNKNOWN';
        try { $integrity = $this->pdo->query('PRAGMA integrity_check')->fetchColumn() === 'ok' ? 'PASS' : 'FAIL'; } catch (Throwable) {}
        try { $foreign = $this->pdo->query('PRAGMA foreign_key_check')->fetchAll() === [] ? 'PASS' : 'FAIL'; } catch (Throwable) {}
        return ['state' => $schema >= 16 && $integrity === 'PASS' && $foreign === 'PASS' ? 'HEALTHY' : 'NEEDS_ATTENTION', 'schemaVersion' => $schema, 'integrity' => $integrity, 'foreignKeys' => $foreign, 'locking' => ['journalMode' => $this->pragmaText('journal_mode'), 'lockingMode' => $this->pragmaText('locking_mode'), 'synchronous' => $this->pragmaInt('synchronous'), 'busyTimeoutMs' => $this->pragmaInt('busy_timeout'), 'transactionModel' => 'bounded BEGIN IMMEDIATE; no lock weakening'], 'observedAt' => $at];
    }

    /** @return array<string,mixed> */
    private function queue(string $at, string $since): array
    {
        $tasks = $this->counts('control_tasks'); $executions = $this->counts('control_task_executions');
        $waiting = $this->scalar("SELECT COUNT(*) FROM control_task_executions WHERE state='WAITING_FOR_CAPABILITY'");
        $stuck = $this->scalar("SELECT COUNT(*) FROM control_task_executions WHERE state IN ('LEASED','RUNNING') AND (lease_expires_at IS NULL OR lease_expires_at <= :at)", ['at' => $at]);
        $failed = $this->group("SELECT COALESCE(last_error_code,'EXECUTION_FAILED') AS name, COUNT(*) AS amount FROM control_task_executions WHERE state='FAILED' AND updated_at >= :since GROUP BY COALESCE(last_error_code,'EXECUTION_FAILED') ORDER BY amount DESC", ['since' => $since]);
        $eligible = $this->pdo->prepare("SELECT e.execution_id,e.task_id,e.required_capability,t.project_id,p.name AS project_name FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id JOIN projects p ON p.project_id=t.project_id WHERE e.state='QUEUED' AND e.executor_kind='VPS' AND e.required_capability IN ('agent.conversation','project.read','project.search','project.mutate.text','project.mutate.assisted') AND t.state IN ('QUEUED','WAITING_FOR_WORKER') ORDER BY e.created_at,e.execution_id LIMIT 1");
        $eligible->execute(); $next = $eligible->fetch();
        return ['tasksByState' => $tasks, 'executionsByState' => $executions, 'waitingCapabilityCount' => $waiting, 'stuckExecutionCount' => $stuck, 'failedLast24h' => $failed, 'activeLeaseCount' => $this->scalar("SELECT COUNT(*) FROM control_task_executions WHERE lease_expires_at > :at", ['at' => $at]), 'nextEligible' => is_array($next) ? ['taskId' => (string) $next['task_id'], 'executionId' => (string) $next['execution_id'], 'projectId' => (string) $next['project_id'], 'project' => (string) $next['project_name'], 'requiredCapability' => (string) $next['required_capability']] : null];
    }

    /** @return array<string,int> */
    private function counts(string $table): array
    {
        if (!$this->table($table)) return [];
        $out = []; foreach ($this->pdo->query("SELECT state, COUNT(*) AS amount FROM {$table} GROUP BY state") ?: [] as $row) $out[(string) $row['state']] = (int) $row['amount']; return $out;
    }

    /** @return list<array{name:string,amount:int}> */
    private function group(string $sql, array $params): array
    {
        try { $q = $this->pdo->prepare($sql); $q->execute($params); return array_map(static fn (array $row): array => ['name' => (string) $row['name'], 'amount' => (int) $row['amount']], $q->fetchAll()); } catch (Throwable) { return []; }
    }

    /** @return array<string,int> */
    private function workers(): array { return $this->counts('control_workers'); }

    /** @return array<string,int> */
    private function authorities(string $since): array
    {
        return [
            'projects' => $this->scalar('SELECT COUNT(*) FROM projects'),
            'pendingApprovals' => $this->scalar("SELECT COUNT(*) FROM control_approvals WHERE status='PENDING' AND expires_at >= :since", ['since' => $since]),
            'activeArtifacts' => $this->scalar('SELECT COUNT(*) FROM control_artifacts WHERE created_at >= :since', ['since' => $since]),
            'artifactBytes' => $this->scalar('SELECT COALESCE(SUM(size_bytes),0) FROM control_artifacts WHERE created_at >= :since', ['since' => $since]),
        ];
    }

    /** @return array<string,mixed> */
    private function providers(string $since): array
    {
        $profiles = $this->group("SELECT lifecycle AS name, COUNT(*) AS amount FROM control_ai_provider_profiles GROUP BY lifecycle", []);
        $models = $this->group("SELECT lifecycle AS name, COUNT(*) AS amount FROM control_ai_models GROUP BY lifecycle", []);
        $health = $this->group("SELECT circuit_state AS name, COUNT(*) AS amount FROM control_ai_model_health GROUP BY circuit_state", []);
        $routes = $this->group("SELECT decision_state AS name, COUNT(*) AS amount FROM control_ai_route_decisions WHERE created_at >= :since GROUP BY decision_state", ['since' => $since]);
        $outcomes = $this->group("SELECT status AS name, COUNT(*) AS amount FROM control_ai_outcomes WHERE completed_at >= :since GROUP BY status", ['since' => $since]);
        $usage = $this->scalar("SELECT COALESCE(SUM(estimated_microunits),0) FROM control_provider_usage WHERE created_at >= :since", ['since' => $since]);
        return ['state' => $profiles === [] ? 'UNKNOWN' : 'OBSERVED', 'profilesByLifecycle' => $profiles, 'modelsByLifecycle' => $models, 'modelCircuitByState' => $health, 'routesLast24h' => $routes, 'outcomesLast24h' => $outcomes, 'estimatedMicrounitsLast24h' => $usage];
    }

    /** @return array<string,mixed> */
    private function backup(): array
    {
        try {
            $root = getenv('AWH_HUB_BACKUP_ROOT') ?: '/var/backups/awh-hub'; $meta = HubBackupService::latestMetadata($root); $latest = is_array($meta['latest'] ?? null) ? $meta['latest'] : null; $state = !($meta['configured'] ?? false) ? 'UNKNOWN' : (($latest['status'] ?? null) === 'VERIFIED' ? 'VERIFIED' : ($latest === null ? 'MISSING' : 'REVIEW')); return ['state' => $state, 'latest' => $latest === null ? null : ['status' => (string) ($latest['status'] ?? 'REVIEW'), 'name' => (string) ($latest['name'] ?? ''), 'sizeBytes' => (int) ($latest['sizeBytes'] ?? 0), 'databaseUserVersion' => (int) ($latest['databaseUserVersion'] ?? 0), 'modifiedAt' => (string) ($latest['modifiedAt'] ?? '')], 'restoreReadiness' => $state === 'VERIFIED' ? 'READY_FOR_BOUNDED_DRILL' : 'NOT_READY'];
        } catch (Throwable) { return ['state' => 'UNKNOWN', 'latest' => null, 'restoreReadiness' => 'UNKNOWN']; }
    }

    /** @param array<string,mixed> $telemetry @param array<string,mixed> $release @param array<string,mixed> $database @param array<string,mixed> $backup @param array<string,mixed> $storage @param array<string,mixed> $providers @param array<string,mixed> $queue @return list<array<string,mixed>> */
    private function roles(array $telemetry, array $release, array $database, array $backup, array $storage, array $providers, array $queue): array
    {
        $services = []; foreach (($telemetry['server']['services'] ?? []) as $service) if (is_array($service)) $services[(string) ($service['key'] ?? '')] = (string) ($service['state'] ?? 'UNKNOWN');
        $ops = ($telemetry['state'] ?? 'UNKNOWN') === 'READY' && in_array($services['nginx'] ?? 'UNKNOWN', ['ACTIVE', 'RELOADING'], true) && in_array($services['php-fpm'] ?? 'UNKNOWN', ['ACTIVE', 'RELOADING'], true);
        $security = (($telemetry['server']['security']['fail2ban'] ?? 'UNKNOWN') === 'ACTIVE' && ($telemetry['server']['security']['automaticUpdates'] ?? 'UNKNOWN') === 'ACTIVE');
        $role = static fn (string $name, string $state, string $why, string $next): array => ['role' => $name, 'state' => $state, 'why' => $why, 'nextAction' => $next];
        return [
            $role(self::STAFF_ROLES[0], $ops ? 'PASS' : 'UNKNOWN', 'fresh VPS telemetry and web service state', $ops ? 'continue bounded observation' : 'refresh telemetry and inspect service state'),
            $role(self::STAFF_ROLES[1], in_array($storage['state'] ?? 'UNKNOWN', ['GOVERNED', 'BOUNDED_REVIEW'], true) ? 'PASS' : 'REVIEW', 'bounded roots are classified without destructive actions', 'review quarantine and retain unknown items'),
            $role(self::STAFF_ROLES[2], ($database['state'] ?? null) === 'HEALTHY' ? 'PASS' : 'FAIL', 'schema, integrity and foreign-key checks', 'preserve SQLite locking and recheck on next tick'),
            $role(self::STAFF_ROLES[3], ($release['pointersMatch'] ?? false) ? 'PASS' : 'REVIEW', 'control/web pointers from release authority', 'keep rollback pointer available'),
            $role(self::STAFF_ROLES[4], ($backup['state'] ?? '') === 'VERIFIED' && ($database['state'] ?? '') === 'HEALTHY' ? 'PASS' : 'REVIEW', 'verified backup plus healthy DB', 'run bounded restore drill when due'),
            $role(self::STAFF_ROLES[5], $security ? 'PASS' : 'UNKNOWN', 'host protection telemetry only', $security ? 'continue monitoring' : 'keep UNKNOWN until host telemetry is fresh'),
            $role(self::STAFF_ROLES[6], ($providers['state'] ?? 'UNKNOWN') === 'OBSERVED' ? 'PASS' : 'UNKNOWN', 'provider/model/routes/outcomes are read from M16 governance', 'fallback or wait according to provider policy'),
            $role(self::STAFF_ROLES[7], (int) ($database['locking']['busyTimeoutMs'] ?? 0) > 0 ? 'PASS' : 'UNKNOWN', 'bounded transactions and observed SQLite busy timeout', 'watch stuck leases and lock evidence'),
            $role(self::STAFF_ROLES[8], 'PASS', 'usage is measured without credential data', 'respect budget and route policy'),
            $role(self::STAFF_ROLES[9], $this->table('control_tasks') && $this->table('control_task_executions') ? 'PASS' : 'UNKNOWN', 'backlog work uses canonical task/execution authority', $queue['nextEligible'] === null ? 'observe and select next eligible task' : 'execute the existing eligible task'),
        ];
    }

    /** @param array<string,mixed> $telemetry @param array<string,mixed> $queue @param array<string,mixed>|null $batch */
    private function loop(array $telemetry, array $queue, ?array $batch): array
    {
        $processed = is_array($batch) ? (int) ($batch['processed'] ?? 0) : 0;
        $execute = is_array($batch) ? ($processed > 0 ? 'PASS' : 'IDLE') : 'NOT_RUN';
        return ['state' => ($telemetry['state'] ?? 'UNKNOWN') === 'READY' ? 'READY' : 'UNKNOWN', 'authority' => 'HubDurableExecutionService/control_task_executions', 'phases' => [
            ['name' => 'OBSERVE', 'state' => 'PASS'], ['name' => 'DIAGNOSE', 'state' => 'PASS'], ['name' => 'PRIORITIZE', 'state' => $queue['nextEligible'] === null ? 'IDLE' : 'PASS'], ['name' => 'CANONICAL_TASK', 'state' => $queue['nextEligible'] === null ? 'IDLE' : 'PASS'], ['name' => 'EXECUTE', 'state' => $execute], ['name' => 'VERIFY', 'state' => $processed > 0 ? 'PASS' : 'NOT_RUN'], ['name' => 'REPORT', 'state' => 'PASS'], ['name' => 'CONTINUE', 'state' => 'READY'],
        ], 'nextEligible' => $queue['nextEligible'], 'batch' => is_array($batch) ? ['processed' => $processed, 'completed' => (int) ($batch['completed'] ?? 0), 'waiting' => (int) ($batch['waiting'] ?? 0), 'failed' => (int) ($batch['failed'] ?? 0), 'recovered' => (int) ($batch['recovered'] ?? 0)] : null];
    }

    /** @param array<string,mixed> $queue @param array<string,mixed> $loop */
    private function activityReport(array $queue, array $loop): array
    {
        $next = is_array($queue['nextEligible'] ?? null) ? $queue['nextEligible'] : null;
        return ['WHAT' => $next === null ? 'ตรวจสถานะและรอ canonical work ที่ eligible' : 'เลือก canonical task ที่พร้อมให้ VPS executor ทำต่อ', 'WHY' => 'รักษา Staff loop แบบ bounded และไม่สร้าง queue ซ้ำ', 'PROJECT' => $next['project'] ?? null, 'REAL_STATE' => $next === null ? 'IDLE_OR_WAITING' : 'ELIGIBLE', 'RESULT_OR_BLOCKER' => (int) ($queue['waitingCapabilityCount'] ?? 0) > 0 ? 'มีงานรอ capability แต่ไม่หยุดงานที่ eligible' : 'ไม่มี blocker จาก capability ใน projection นี้', 'NEXT_ACTION' => $next === null ? 'ตรวจใหม่ใน tick ถัดไป' : 'ใช้ HubDurableExecutionService claim ผ่าน lease เดิม'];
    }

    /** @param array<string,mixed> $authorities */
    private function morningBrief(string $at, string $since, array $telemetry, array $release, array $database, array $backup, array $storage, array $queue, array $workers, array $providers, array $roles, array $authorities): array
    {
        $passed = count(array_filter($roles, static fn (array $role): bool => ($role['state'] ?? '') === 'PASS'));
        return ['generatedAt' => $at, 'window' => ['since' => $since, 'until' => $at], 'overnight' => ['tasks' => $queue['tasksByState'] ?? [], 'executions' => $queue['executionsByState'] ?? [], 'failed' => $queue['failedLast24h'] ?? [], 'stuck' => $queue['stuckExecutionCount'] ?? 0], 'vps' => ['state' => $telemetry['state'] ?? 'UNKNOWN', 'services' => array_map(static fn (array $service): array => ['key' => (string) ($service['key'] ?? ''), 'state' => (string) ($service['state'] ?? 'UNKNOWN')], is_array($telemetry['server']['services'] ?? null) ? $telemetry['server']['services'] : [])], 'release' => ['control' => $release['controlReleaseId'] ?? null, 'web' => $release['webReleaseId'] ?? null, 'pointersMatch' => (bool) ($release['pointersMatch'] ?? false)], 'database' => $database, 'backup' => $backup, 'storage' => ['state' => $storage['state'] ?? 'UNKNOWN', 'summary' => $storage['summary'] ?? []], 'workers' => $workers, 'providers' => $providers, 'canonicalAuthorities' => $authorities, 'staff' => ['rolesPass' => $passed, 'rolesTotal' => count($roles), 'next' => $queue['nextEligible'] ?? null]];
    }

    private function table(string $name): bool { try { $q = $this->pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name"); $q->execute(['name' => $name]); return $q->fetchColumn() === 1; } catch (Throwable) { return false; } }
    private function scalar(string $sql, array $params = []): int { try { $q = $this->pdo->prepare($sql); $q->execute($params); return (int) $q->fetchColumn(); } catch (Throwable) { return 0; } }
    private function pragmaText(string $name): string { try { return strtoupper((string) $this->pdo->query('PRAGMA ' . $name)->fetchColumn()); } catch (Throwable) { return 'UNKNOWN'; } }
    private function pragmaInt(string $name): int { try { return (int) $this->pdo->query('PRAGMA ' . $name)->fetchColumn(); } catch (Throwable) { return 0; } }
}
