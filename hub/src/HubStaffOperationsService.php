<?php

declare(strict_types=1);

require_once __DIR__ . '/HubBackupService.php';
require_once __DIR__ . '/HubInfrastructureService.php';
require_once __DIR__ . '/HubStorageGovernanceService.php';
require_once __DIR__ . '/HubExecutionTriageService.php';

/**
 * Read/report projection for the always-on Staff loop.  Execution and
 * mutation remain owned by HubDurableExecutionService and canonical tables.
 * This class creates no queue, task, lease, memory or report table.
 */
final class HubStaffOperationsService
{
    private const MORNING_BRIEF_KEY = 'system.morningBrief';
    private const STAFF_ROLES = [
        'Product / UX Staff', 'UI Design Staff', 'Frontend Staff', 'Backend / Architecture Staff', 'QA Staff',
        'Database Steward', 'SRE / Operations Staff', 'Storage / Housekeeping Staff', 'Security Staff',
        'Release Guardian', 'Recovery Staff', 'AI Provider Staff', 'Performance / Capacity Staff', 'Cost Staff',
    ];

    public function __construct(private readonly PDO $pdo, private readonly string $databasePath, ?HubStorageGovernanceService $storage = null)
    {
        $this->storage = $storage ?? new HubStorageGovernanceService();
    }

    private readonly HubStorageGovernanceService $storage;

    /** @param array<string,mixed>|null $batch @param array<string,mixed>|null $telemetry @param array<string,mixed>|null $release @param array<string,mixed>|null $governorRun */
    public function snapshot(?string $now = null, ?array $batch = null, ?array $telemetry = null, ?array $release = null, ?array $governorRun = null, ?array $housekeepingRun = null): array
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
        $executionTriage = (new HubExecutionTriageService($this->pdo))->snapshot($at);
        $backup = $this->backup($at);
        $storage = $this->storage->audit($at, [
            'control' => (string) ($release['controlReleaseId'] ?? ''),
            'web' => (string) ($release['webReleaseId'] ?? ''),
        ]);
        $managedSites = $this->managedSites($telemetry, $release, $backup, $storage);
        $roles = $this->roles($telemetry, $release, $database, $backup, $storage, $providers, $queue);
        $governor = $this->governor($telemetry, $queue, $storage, $backup, $providers, $governorRun);
        $loop = $this->loop($telemetry, $queue, $batch, $governor);
        $report = $this->activityReport($queue, $loop, $governor, $batch);
        $housekeeping = $this->housekeeping($storage, $housekeepingRun);
        $morningBrief = $this->morningBrief($at, $since, $telemetry, $release, $database, $backup, $storage, $queue, $workers, $providers, $roles, $authorities, $batch, $executionTriage, $housekeeping);
        return [
            'schemaVersion' => 2,
            'generatedAt' => $at,
            'loop' => $loop,
            'governor' => $governor,
            'selfHealing' => $this->selfHealing($batch, $telemetry, $providers, $storage),
            'housekeeping' => $housekeeping,
            'roles' => $roles,
            'report' => $report,
            'canonicalAuthorities' => $authorities,
            'queue' => $queue,
            'workers' => $workers,
            'providers' => $providers,
            'executionTriage' => $executionTriage,
            'database' => $database,
            'backupRecovery' => $backup,
            'storageGovernance' => $storage,
            'hostingCenter' => ['state' => 'READINESS_ONLY', 'managedSites' => count($managedSites), 'operations' => ['siteHealth' => 'OBSERVED', 'maintenanceMode' => 'OWNER_APPROVAL', 'deployCandidate' => 'OWNER_APPROVAL', 'rollback' => 'OWNER_APPROVAL', 'backupVerify' => 'OBSERVED', 'logInspect' => 'OWNER_ONLY'], 'arbitraryShell' => false],
            'managedSites' => $managedSites,
            'morningBrief' => $morningBrief,
            'persistedMorningBrief' => $this->latestMorningBrief(),
            'safety' => ['canonicalAuthoritiesOnly' => true, 'newTables' => false, 'arbitraryShell' => false, 'credentialsExposed' => false, 'purgeMode' => $housekeepingRun === null ? 'AUDIT_ONLY' : 'VERIFIED_QUARANTINE_ONLY'],
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
        $eligible = $this->pdo->prepare("SELECT e.execution_id,e.task_id,e.required_capability,t.project_id,p.name AS project_name FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id JOIN projects p ON p.project_id=t.project_id WHERE e.state='QUEUED' AND e.executor_kind='VPS' AND e.required_capability IN ('agent.conversation','project.read','project.search','project.mutate.text','project.mutate.assisted','artifact.object') AND t.state IN ('QUEUED','WAITING_FOR_WORKER') ORDER BY e.created_at,e.execution_id LIMIT 1");
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
    private function backup(string $at): array
    {
        try {
            $root = getenv('AWH_HUB_BACKUP_ROOT') ?: '/var/backups/awh-hub'; $meta = HubBackupService::latestMetadata($root); $latest = is_array($meta['latest'] ?? null) ? $meta['latest'] : null; $state = !($meta['configured'] ?? false) ? 'UNKNOWN' : (($latest['status'] ?? null) === 'VERIFIED' ? 'VERIFIED' : ($latest === null ? 'MISSING' : 'REVIEW')); $freshness = HubBackupService::freshness($latest, $at); return ['state' => $state, 'freshness' => $freshness, 'latest' => $latest === null ? null : ['status' => (string) ($latest['status'] ?? 'REVIEW'), 'name' => (string) ($latest['name'] ?? ''), 'sizeBytes' => (int) ($latest['sizeBytes'] ?? 0), 'databaseUserVersion' => array_key_exists('databaseUserVersion', $latest) ? (int) $latest['databaseUserVersion'] : null, 'modifiedAt' => (string) ($latest['modifiedAt'] ?? '')], 'restoreReadiness' => $state === 'VERIFIED' ? 'READY_FOR_BOUNDED_DRILL' : 'NOT_READY'];
        } catch (Throwable) { return ['state' => 'UNKNOWN', 'freshness' => ['state'=>'UNKNOWN','ageSeconds'=>null,'maxAgeSeconds'=>HubBackupService::FRESHNESS_MAX_AGE_SECONDS], 'latest' => null, 'restoreReadiness' => 'UNKNOWN']; }
    }

    /** @param array<string,mixed> $telemetry @param array<string,mixed> $release @param array<string,mixed> $database @param array<string,mixed> $backup @param array<string,mixed> $storage @param array<string,mixed> $providers @param array<string,mixed> $queue @return list<array<string,mixed>> */
    private function roles(array $telemetry, array $release, array $database, array $backup, array $storage, array $providers, array $queue): array
    {
        $services = []; foreach (($telemetry['server']['services'] ?? []) as $service) if (is_array($service)) $services[(string) ($service['key'] ?? '')] = (string) ($service['state'] ?? 'UNKNOWN');
        $ops = ($telemetry['state'] ?? 'UNKNOWN') === 'READY' && in_array($services['nginx'] ?? 'UNKNOWN', ['ACTIVE', 'RELOADING'], true) && in_array($services['php-fpm'] ?? 'UNKNOWN', ['ACTIVE', 'RELOADING'], true);
        $security = (($telemetry['server']['security']['fail2ban'] ?? 'UNKNOWN') === 'ACTIVE' && ($telemetry['server']['security']['automaticUpdates'] ?? 'UNKNOWN') === 'ACTIVE');
        $role = static fn (string $name, string $state, string $why, string $next): array => ['role' => $name, 'state' => $state, 'why' => $why, 'nextAction' => $next];
        $notConfigured = static fn (string $name, string $next): array => $role($name, 'NOT_CONFIGURED', 'ยังไม่มี specialist execution evidence ที่ผูกกับ canonical task', $next);
        return [
            $notConfigured(self::STAFF_ROLES[0], 'เลือกงาน Product / UX จาก Owner backlog ผ่าน Governor'),
            $notConfigured(self::STAFF_ROLES[1], 'รอ design evidence ที่ผูกกับ canonical artifact'),
            $notConfigured(self::STAFF_ROLES[2], 'รอ frontend execution evidence ที่ผูกกับ candidate'),
            $notConfigured(self::STAFF_ROLES[3], 'รอ backend/architecture execution evidence ที่ผูกกับ candidate'),
            $notConfigured(self::STAFF_ROLES[4], 'รัน QA ผ่าน canonical execution เมื่อมีงาน eligible'),
            $role(self::STAFF_ROLES[5], ($database['state'] ?? null) === 'HEALTHY' ? 'PASS' : 'FAIL', 'schema, integrity และ foreign-key checks', 'preserve SQLite locking และ recheck ใน tick ถัดไป'),
            $role(self::STAFF_ROLES[6], $ops ? 'PASS' : 'UNKNOWN', 'fresh VPS telemetry และ web service state', $ops ? 'continue bounded observation' : 'refresh telemetry และ inspect service state'),
            $role(self::STAFF_ROLES[7], in_array($storage['state'] ?? 'UNKNOWN', ['GOVERNED', 'BOUNDED_REVIEW'], true) ? 'PASS' : 'REVIEW', 'bounded roots ถูกจัดประเภทโดยไม่ทำลายข้อมูล', 'review quarantine และ retain unknown items'),
            $role(self::STAFF_ROLES[8], $security ? 'PASS' : 'UNKNOWN', 'อ่าน host protection telemetry เท่านั้น', $security ? 'continue monitoring' : 'คง UNKNOWN จน telemetry สดพอ'),
            $role(self::STAFF_ROLES[9], ($release['pointersMatch'] ?? false) ? 'PASS' : 'REVIEW', 'control/web pointers จาก release authority', 'keep rollback pointer available'),
            $role(self::STAFF_ROLES[10], ($backup['state'] ?? '') === 'VERIFIED' && ($backup['freshness']['state'] ?? '') === 'FRESH' && ($database['state'] ?? '') === 'HEALTHY' ? 'PASS' : 'REVIEW', 'verified + fresh backup และ healthy DB', 'ตรวจ backup scheduler/freshness แล้ว run bounded restore drill เมื่อถึงกำหนด'),
            $role(self::STAFF_ROLES[11], ($providers['state'] ?? 'UNKNOWN') === 'OBSERVED' ? 'PASS' : 'UNKNOWN', 'provider/model/routes/outcomes จาก M16 governance', 'fallback หรือ wait ตาม provider policy'),
            $role(self::STAFF_ROLES[12], (int) ($database['locking']['busyTimeoutMs'] ?? 0) > 0 ? 'PASS' : 'UNKNOWN', 'bounded transactions และ SQLite busy timeout', 'watch stuck leases และ lock evidence'),
            $role(self::STAFF_ROLES[13], $this->table('control_provider_usage') ? 'PASS' : 'UNKNOWN', 'usage ถูกวัดโดยไม่เปิด credential', 'respect budget และ route policy'),
        ];
    }

    /** @param array<string,mixed> $telemetry @param array<string,mixed> $queue @param array<string,mixed>|null $batch @param array<string,mixed> $governor */
    private function loop(array $telemetry, array $queue, ?array $batch, array $governor): array
    {
        $processed = is_array($batch) ? (int) ($batch['processed'] ?? 0) : 0;
        $completed = is_array($batch) ? (int) ($batch['completed'] ?? 0) : 0;
        $failed = is_array($batch) ? (int) ($batch['failed'] ?? 0) : 0;
        $execute = is_array($batch) ? ($processed > 0 ? 'PASS' : 'IDLE') : 'NOT_RUN';
        $selected = is_array($governor['selectedWork'] ?? null);
        return ['state' => ($telemetry['state'] ?? 'UNKNOWN') === 'READY' ? 'READY' : 'UNKNOWN', 'authority' => 'HubDurableExecutionService/control_task_executions', 'phases' => [
            ['name' => 'OBSERVE', 'state' => 'PASS'], ['name' => 'DIAGNOSE', 'state' => 'PASS'], ['name' => 'PRIORITIZE', 'state' => $selected ? 'PASS' : 'IDLE'], ['name' => 'CANONICAL_TASK', 'state' => $selected ? 'PASS' : 'NOT_RUN'], ['name' => 'EXECUTE', 'state' => $execute], ['name' => 'VERIFY', 'state' => $completed > 0 && $failed === 0 ? 'PASS' : ($processed > 0 ? 'FAIL' : 'NOT_RUN')], ['name' => 'REPORT', 'state' => 'PASS'], ['name' => 'CONTINUE', 'state' => 'READY'],
        ], 'nextEligible' => $queue['nextEligible'], 'batch' => is_array($batch) ? ['processed' => $processed, 'completed' => (int) ($batch['completed'] ?? 0), 'waiting' => (int) ($batch['waiting'] ?? 0), 'failed' => (int) ($batch['failed'] ?? 0), 'recovered' => (int) ($batch['recovered'] ?? 0)] : null];
    }

    /** @param array<string,mixed> $telemetry @param array<string,mixed> $queue @param array<string,mixed> $storage @param array<string,mixed> $backup @param array<string,mixed> $providers @param array<string,mixed>|null $governorRun */
    private function governor(array $telemetry, array $queue, array $storage, array $backup, array $providers, ?array $governorRun = null): array
    {
        $signals = [];
        if (($queue['nextEligible'] ?? null) !== null) $signals[] = ['source' => 'canonical_queue', 'state' => 'ELIGIBLE_WORK'];
        if ((int) ($queue['waitingCapabilityCount'] ?? 0) > 0) $signals[] = ['source' => 'capability', 'state' => 'WAITING_FOR_CAPABILITY', 'count' => (int) $queue['waitingCapabilityCount']];
        if ((int) ($queue['stuckExecutionCount'] ?? 0) > 0) $signals[] = ['source' => 'execution', 'state' => 'STUCK_LEASE', 'count' => (int) $queue['stuckExecutionCount']];
        if (($queue['failedLast24h'] ?? []) !== []) $signals[] = ['source' => 'execution', 'state' => 'FAILED_EXECUTION'];
        if (($storage['state'] ?? 'UNKNOWN') === 'BOUNDED_REVIEW') $signals[] = ['source' => 'storage', 'state' => 'UNKNOWN_REVIEW'];
        if (($backup['state'] ?? 'UNKNOWN') !== 'VERIFIED') $signals[] = ['source' => 'backup', 'state' => (string) ($backup['state'] ?? 'UNKNOWN')];
        elseif (($backup['freshness']['state'] ?? 'UNKNOWN') !== 'FRESH') $signals[] = ['source' => 'backup', 'state' => 'STALE_OR_UNKNOWN_FRESHNESS'];
        if (($telemetry['state'] ?? 'UNKNOWN') !== 'READY') $signals[] = ['source' => 'telemetry', 'state' => (string) ($telemetry['state'] ?? 'UNKNOWN')];
        if (($providers['state'] ?? 'UNKNOWN') !== 'OBSERVED') $signals[] = ['source' => 'provider', 'state' => (string) ($providers['state'] ?? 'UNKNOWN')];
        if (is_array($governorRun) && is_string($governorRun['decision'] ?? null)) return [
            'schemaVersion'=>1,'state'=>(string)($governorRun['state']??'UNKNOWN'),'decision'=>(string)$governorRun['decision'],'selectedWork'=>is_array($governorRun['selectedWork']??null)?$governorRun['selectedWork']:null,'created'=>(bool)($governorRun['created']??false),'signals'=>is_array($governorRun['signals']??null)?array_slice($governorRun['signals'],0,20):$signals,'queueAuthority'=>'control_tasks/control_task_executions','taskCreation'=>'CONTROL_PLANE_TYPED_MATERIALIZER','riskPolicy'=>['lowRiskAutoContinue'=>true,'mediumRisk'=>'CANDIDATE_OR_APPROVAL','highRisk'=>'OWNER_APPROVAL','killSwitch'=>'POLICY_REQUIRED'],'blockedWorkDoesNotStopLoop'=>true,'reason'=>(string)($governorRun['reason']??''),'nextAction'=>'ตรวจผล execution แล้วเลือกงาน eligible ถัดไปใน tick ต่อไป','arbitraryShell'=>false,
        ];
        $next = is_array($queue['nextEligible'] ?? null) ? $queue['nextEligible'] : null;
        return ['schemaVersion' => 1, 'state' => $next === null ? (count($signals) ? 'REVIEW_OR_WAITING' : 'IDLE') : 'READY', 'decision' => $next === null ? 'WAIT_FOR_ELIGIBLE_WORK' : 'SELECT_EXISTING_CANONICAL_TASK', 'selectedWork' => $next, 'signals' => array_slice($signals, 0, 20), 'queueAuthority' => 'control_tasks/control_task_executions', 'taskCreation' => 'AUTOMATION_OR_CONTROL_PLANE_ONLY', 'riskPolicy' => ['lowRiskAutoContinue' => true, 'mediumRisk' => 'CANDIDATE_OR_APPROVAL', 'highRisk' => 'OWNER_APPROVAL', 'killSwitch' => 'POLICY_REQUIRED'], 'blockedWorkDoesNotStopLoop' => true, 'nextAction' => $next === null ? 'รอ tick ถัดไปและเลือกงาน canonical ที่ eligible' : 'ส่งงานเดิมเข้า HubDurableExecutionService claim/lease'];
    }

    /** @param array<string,mixed>|null $batch @param array<string,mixed> $telemetry @param array<string,mixed> $providers @param array<string,mixed> $storage */
    private function selfHealing(?array $batch, array $telemetry, array $providers, array $storage): array
    {
        $processed = is_array($batch) ? (int) ($batch['processed'] ?? 0) : 0;
        $recovered = is_array($batch) ? (int) ($batch['recovered'] ?? 0) : 0;
        $retryQueued = 0;
        if (is_array($batch['results'] ?? null)) foreach ($batch['results'] as $result) if (is_array($result) && ($result['state'] ?? null) === 'QUEUED') $retryQueued++;
        return ['schemaVersion' => 1, 'state' => $recovered > 0 || $retryQueued > 0 ? 'BOUNDED_ACTION_OBSERVED' : 'OBSERVE_ONLY', 'operations' => ['expiredLeaseRecovery' => $recovered > 0 ? 'PASS' : 'NOT_OBSERVED', 'policyQualifiedRetry' => $retryQueued > 0 ? 'PASS' : 'NOT_OBSERVED', 'serviceReload' => 'NOT_CONFIGURED', 'providerFallback' => count($providers['routesLast24h'] ?? []) > 0 ? 'OBSERVED' : 'NOT_OBSERVED', 'storagePressure' => in_array($storage['state'] ?? 'UNKNOWN', ['GOVERNED', 'BOUNDED_REVIEW'], true) ? 'OBSERVED' : 'UNKNOWN'], 'processed' => $processed, 'arbitraryShell' => false, 'nextAction' => ($telemetry['state'] ?? 'UNKNOWN') === 'READY' ? 'ตรวจ bounded recovery/retry ใน tick ถัดไป' : 'คง UNKNOWN จน telemetry สดพอ'];
    }

    /** @param array<string,mixed> $storage @param array<string,mixed>|null $run */
    private function housekeeping(array $storage, ?array $run = null): array
    {
        $actions = is_array($storage['actions'] ?? null) ? $storage['actions'] : [];
        if ($run === null) return ['schemaVersion' => 1, 'state' => 'AUDIT_ONLY', 'authority' => 'HubStorageGovernanceService', 'lifecycle' => 'DISCOVER → CLASSIFY → REFERENCE_CHECK → QUARANTINE → VERIFY → PURGE', 'scan' => ($actions['scanned'] ?? false) === true ? 'PASS' : 'NOT_RUN', 'classification' => 'PASS', 'referenceCheck' => 'NOT_RUN', 'quarantine' => (string) ($actions['quarantine'] ?? 'SAFE_TO_PURGE_ONLY'), 'verify' => (string) ($actions['verifyQuarantine'] ?? 'HASH_AND_SIZE_REQUIRED'), 'purge' => (string) ($actions['purge'] ?? 'EXPLICIT_VERIFIED_QUARANTINE_ONLY'), 'unknownItemsRetained' => true, 'nextAction' => 'executor tick เท่านั้นที่มีสิทธิ์ทำ bounded housekeeping'];
        $state = (string) ($run['state'] ?? 'UNKNOWN');
        return ['schemaVersion' => 1, 'state' => $state, 'authority' => 'HubStorageGovernanceService', 'lifecycle' => 'DISCOVER → CLASSIFY → REFERENCE_CHECK → QUARANTINE → VERIFY → PURGE', 'scan' => 'PASS', 'classification' => 'PASS', 'referenceCheck' => (int) ($run['referenceChecked'] ?? 0) >= (int) ($run['quarantined'] ?? 0) ? 'PASS' : 'REVIEW', 'quarantine' => (int) ($run['quarantined'] ?? 0), 'verify' => (int) ($run['verified'] ?? 0), 'purge' => (int) ($run['purged'] ?? 0), 'reclaimedBytes' => (int) ($run['reclaimedBytes'] ?? 0), 'blocked' => (int) ($run['blocked'] ?? 0), 'unknownItemsRetained' => ($run['unknownRetained'] ?? false) === true, 'nextAction' => $state === 'QUARANTINED_REVIEW' ? 'คงไฟล์ไว้ใน quarantine และตรวจรอบถัดไป ห้าม purge เพิ่ม' : 'ตรวจใหม่ใน executor tick ถัดไป'];
    }

    /** A generic, derived Managed Site view. It is deliberately not a site database or a fake domain binding. */
    private function managedSites(array $telemetry, array $release, array $backup, array $storage): array
    {
        $domains = is_array($telemetry['server']['domains'] ?? null) ? array_values(array_filter($telemetry['server']['domains'], static fn (mixed $domain): bool => is_array($domain))) : [];
        $projects = [];
        try { $query = $this->pdo->query('SELECT project_id, name, type FROM projects ORDER BY name, project_id LIMIT 100'); $projects = $query === false ? [] : $query->fetchAll(); } catch (Throwable) {}
        $sites = [];
        foreach ($projects as $project) {
            if (!is_array($project)) continue;
            $projectId = (string) ($project['project_id'] ?? ''); if ($projectId === '') continue;
            $sites[] = ['siteId' => 'derived-' . substr(hash('sha256', $projectId), 0, 16), 'projectId' => $projectId, 'name' => (string) ($project['name'] ?? 'Project'), 'type' => (string) ($project['type'] ?? 'general'), 'identity' => 'DERIVED_READ_ONLY', 'environment' => 'UNKNOWN', 'domain' => null, 'subdomains' => [], 'observedDomains' => array_slice(array_map(static fn (array $domain): string => (string) ($domain['name'] ?? ''), $domains), 0, 20), 'runtime' => 'UNKNOWN', 'runtimeVersion' => null, 'release' => $release['controlReleaseId'] ?? null, 'databaseMapping' => 'UNKNOWN', 'ssl' => ['state' => count($domains) > 0 ? 'OBSERVED' : 'UNKNOWN'], 'health' => ($telemetry['state'] ?? 'UNKNOWN') === 'READY' ? 'OBSERVED' : 'UNKNOWN', 'logs' => 'OWNER_ONLY', 'backup' => $backup['state'] ?? 'UNKNOWN', 'deployPolicy' => 'OWNER_APPROVAL', 'maintenanceMode' => 'OWNER_APPROVAL', 'storage' => ['state' => $storage['state'] ?? 'UNKNOWN', 'reclaimableBytes' => $storage['reclaimableBytes'] ?? null], 'incidents' => 'READ_FROM_CANONICAL_TASKS'];
        }
        return $sites;
    }

    /** @param array<string,mixed> $queue @param array<string,mixed> $loop @param array<string,mixed> $governor @param array<string,mixed>|null $batch */
    private function activityReport(array $queue, array $loop, array $governor, ?array $batch = null): array
    {
        $next = is_array($governor['selectedWork'] ?? null) ? $governor['selectedWork'] : (is_array($queue['nextEligible'] ?? null) ? $queue['nextEligible'] : null);
        $processed=is_array($batch)?(int)($batch['processed']??0):0;$completed=is_array($batch)?(int)($batch['completed']??0):0;$failed=is_array($batch)?(int)($batch['failed']??0):0;
        $realState=$completed>0&&$failed===0?'COMPLETED':($processed>0?'EXECUTED_WITH_REVIEW':($next===null?'IDLE_OR_WAITING':'ELIGIBLE'));
        return ['WHAT' => $next === null ? 'ตรวจสถานะและรอ canonical work ที่ eligible' : (($governor['decision']??null)==='CREATE_CANONICAL_TASK'?'สร้างและทำ canonical Staff audit':'เลือก canonical task ที่พร้อมให้ VPS executor ทำต่อ'), 'WHY' => 'รักษา Staff loop แบบ bounded และไม่สร้าง queue ซ้ำ', 'PROJECT' => $next['project'] ?? null, 'REAL_STATE' => $realState, 'RESULT_OR_BLOCKER' => $completed>0?'execution และ artifact verification สำเร็จ':((int) ($queue['waitingCapabilityCount'] ?? 0) > 0 ? 'มีงานรอ capability แต่ไม่หยุดงานที่ eligible' : 'ไม่มี blocker จาก capability ใน projection นี้'), 'NEXT_ACTION' => $completed>0?'เลือกงาน eligible ถัดไปใน tick ต่อไป':($next === null ? 'ตรวจใหม่ใน tick ถัดไป' : 'ใช้ HubDurableExecutionService claim ผ่าน lease เดิม')];
    }

    /** @param array<string,mixed> $authorities */
    private function morningBrief(string $at, string $since, array $telemetry, array $release, array $database, array $backup, array $storage, array $queue, array $workers, array $providers, array $roles, array $authorities, ?array $batch = null, array $executionTriage = [], array $housekeeping = []): array
    {
        $passed = count(array_filter($roles, static fn (array $role): bool => ($role['state'] ?? '') === 'PASS'));
        $completed = (int) ($queue['tasksByState']['COMPLETED'] ?? 0);
        $failed = array_sum(array_map(static fn (array $item): int => (int) ($item['amount'] ?? 0), is_array($queue['failedLast24h'] ?? null) ? $queue['failedLast24h'] : []));
        return ['schemaVersion' => 1, 'briefDate' => substr($at, 0, 10), 'generatedAt' => $at, 'window' => ['since' => $since, 'until' => $at], 'overnight' => ['tasks' => $queue['tasksByState'] ?? [], 'executions' => $queue['executionsByState'] ?? [], 'completedTasks' => $completed, 'failedTasks' => $failed, 'failed' => $queue['failedLast24h'] ?? [], 'recoveredFailures' => is_array($batch) ? (int) ($batch['recovered'] ?? 0) : null, 'stuck' => $queue['stuckExecutionCount'] ?? 0, 'executionTriage' => is_array($executionTriage['current']['summary'] ?? null) ? $executionTriage['current']['summary'] : []], 'visibleChanges' => ['artifactsCreatedLast24h' => $authorities['activeArtifacts'] ?? 0], 'vps' => ['state' => $telemetry['state'] ?? 'UNKNOWN', 'services' => array_map(static fn (array $service): array => ['key' => (string) ($service['key'] ?? ''), 'state' => (string) ($service['state'] ?? 'UNKNOWN')], is_array($telemetry['server']['services'] ?? null) ? $telemetry['server']['services'] : [])], 'release' => ['control' => $release['controlReleaseId'] ?? null, 'web' => $release['webReleaseId'] ?? null, 'pointersMatch' => (bool) ($release['pointersMatch'] ?? false)], 'database' => $database, 'backup' => $backup, 'storage' => ['state' => $storage['state'] ?? 'UNKNOWN', 'summary' => $storage['summary'] ?? [], 'disk' => $storage['disk'] ?? null, 'housekeeping' => $housekeeping], 'workers' => $workers, 'providers' => $providers, 'canonicalAuthorities' => $authorities, 'staff' => ['rolesPass' => $passed, 'rolesTotal' => count($roles), 'next' => $queue['nextEligible'] ?? null], 'nextPlannedWork' => $queue['nextEligible'] ?? null];
    }

    /** Persist one brief per UTC day in the existing audited settings revision ledger. */
    public function persistMorningBrief(array $brief, ?string $now = null): array
    {
        if (!$this->table('control_product_setting_revisions') || !$this->table('owner_bootstrap')) return ['state' => 'NOT_CONFIGURED', 'persisted' => false, 'reason' => 'canonical revision or owner authority unavailable'];
        try {
            $owner = $this->pdo->query('SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id = 1 AND bootstrap_closed = 1')->fetchColumn();
            if (!is_string($owner) || $owner === '') return ['state' => 'BLOCKED', 'persisted' => false, 'reason' => 'closed Owner authority unavailable'];
            $at = gmdate('c', strtotime($now ?? ($brief['generatedAt'] ?? 'now')) ?: time());
            $brief['schemaVersion'] = 1; $brief['briefDate'] = substr((string) ($brief['briefDate'] ?? $at), 0, 10); $brief['generatedAt'] = (string) ($brief['generatedAt'] ?? $at);
            $encoded = json_encode($brief, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            if (strlen($encoded) > 60 * 1024) return ['state' => 'FAILED', 'persisted' => false, 'reason' => 'brief exceeds bounded size'];
            $existing = $this->latestMorningBrief();
            if (($existing['state'] ?? null) === 'PERSISTED' && (($existing['brief']['briefDate'] ?? null) === $brief['briefDate']) && self::briefFingerprint($existing['brief']) === self::briefFingerprint($brief)) return $existing;
            $this->pdo->exec('BEGIN IMMEDIATE');
            $revision = $this->scalar('SELECT COALESCE(MAX(revision_no), 0) + 1 FROM control_product_setting_revisions WHERE setting_key = ' . $this->pdo->quote(self::MORNING_BRIEF_KEY));
            $this->pdo->prepare('INSERT INTO control_product_setting_revisions(revision_id, setting_key, revision_no, value_json, updated_by_user_id, created_at) VALUES(:id, :key, :revision, :value, :user, :at)')->execute(['id' => $this->uuid(), 'key' => self::MORNING_BRIEF_KEY, 'revision' => $revision, 'value' => $encoded, 'user' => $owner, 'at' => $at]);
            $this->pdo->exec('COMMIT');
            return ['state' => 'PERSISTED', 'persisted' => true, 'revision' => $revision, 'briefDate' => $brief['briefDate'], 'brief' => $brief];
        } catch (Throwable) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            return ['state' => 'FAILED', 'persisted' => false, 'reason' => 'durable brief write failed'];
        }
    }

    /** @return array<string,mixed> */
    public function latestMorningBrief(): array
    {
        if (!$this->table('control_product_setting_revisions')) return ['state' => 'NOT_CONFIGURED', 'persisted' => false];
        try {
            $q = $this->pdo->prepare('SELECT revision_no, value_json, created_at FROM control_product_setting_revisions WHERE setting_key = :key ORDER BY revision_no DESC LIMIT 1'); $q->execute(['key' => self::MORNING_BRIEF_KEY]); $row = $q->fetch();
            if (!is_array($row)) return ['state' => 'NOT_FOUND', 'persisted' => false];
            $brief = json_decode((string) $row['value_json'], true, 32, JSON_THROW_ON_ERROR);
            if (!is_array($brief)) return ['state' => 'INVALID', 'persisted' => false];
            return ['state' => 'PERSISTED', 'persisted' => true, 'revision' => (int) $row['revision_no'], 'createdAt' => (string) $row['created_at'], 'briefDate' => (string) ($brief['briefDate'] ?? ''), 'brief' => $brief];
        } catch (Throwable) { return ['state' => 'INVALID', 'persisted' => false]; }
    }

    /** Keep one durable revision per material daily state, not one stale snapshot forever. */
    private static function briefFingerprint(array $brief): string
    {
        $stable = [];
        foreach (['overnight', 'visibleChanges', 'vps', 'release', 'database', 'backup', 'workers', 'providers', 'canonicalAuthorities', 'staff', 'nextPlannedWork'] as $key) if (array_key_exists($key, $brief)) $stable[$key] = $brief[$key];
        if (is_array($brief['storage'] ?? null)) $stable['storage'] = ['state' => $brief['storage']['state'] ?? null, 'summary' => $brief['storage']['summary'] ?? null];
        return hash('sha256', json_encode($stable, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    }

    private function table(string $name): bool { try { $q = $this->pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name"); $q->execute(['name' => $name]); return $q->fetchColumn() === 1; } catch (Throwable) { return false; } }
    private function scalar(string $sql, array $params = []): int { try { $q = $this->pdo->prepare($sql); $q->execute($params); return (int) $q->fetchColumn(); } catch (Throwable) { return 0; } }
    private function uuid(): string { $bytes = random_bytes(16); $bytes[6] = chr((ord($bytes[6]) & 15) | 64); $bytes[8] = chr((ord($bytes[8]) & 63) | 128); return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4)); }
    private function pragmaText(string $name): string { try { return strtoupper((string) $this->pdo->query('PRAGMA ' . $name)->fetchColumn()); } catch (Throwable) { return 'UNKNOWN'; } }
    private function pragmaInt(string $name): int { try { return (int) $this->pdo->query('PRAGMA ' . $name)->fetchColumn(); } catch (Throwable) { return 0; } }
}
