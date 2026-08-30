<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubCentralProjectAuthorityMigration.php';
require_once dirname(__DIR__) . '/src/HubProjectVault.php';
require_once dirname(__DIR__) . '/src/HubProjectVaultService.php';
require_once dirname(__DIR__) . '/src/HubDurableExecutionService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneService.php';
require_once dirname(__DIR__) . '/src/HubAutomationSchedulerService.php';
require_once dirname(__DIR__) . '/src/HubStaffOperationsService.php';
require_once __DIR__ . '/system-telemetry.php';

/**
 * One bounded, unprivileged executor tick. A service manager invokes this
 * repeatedly; each invocation stays one-shot, reads no browser credentials, executes
 * no arbitrary shell input, and exposes no network listener. Schema-15 automations and
 * bounded infrastructure telemetry reuse this same timer and existing authorities.
 * Each tick drains only a small fixed batch so backlog progresses without turning
 * the timer into an unbounded daemon or bypassing canonical leases/approvals.
 */
$database = getenv('AWH_HUB_DB_PATH');
if (!is_string($database) || $database === '' || str_contains($database, "\0")) { fwrite(STDERR, "DATABASE_CONFIG_INVALID\n"); exit(2); }
try {
    $pdo = new PDO('sqlite:' . $database, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec('PRAGMA busy_timeout = 7500'); $pdo->exec('PRAGMA journal_mode = WAL'); $pdo->exec('PRAGMA synchronous = NORMAL');

    $automation = ['status' => 'UNAVAILABLE'];
    $automationReady = (int)$pdo->query('PRAGMA user_version')->fetchColumn() >= 15
        && $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='control_automations'")->fetchColumn() === 1;
    if ($automationReady) {
        try {
            $control = HubControlPlaneService::openExisting($database);
            $scheduler = new HubAutomationSchedulerService($pdo, static fn(string $userId, array $definition, string $occurrenceAt): array => $control->materializeAutomationSubmission($userId, $definition, $occurrenceAt));
            $automation = ['status' => 'READY', 'summary' => $scheduler->tick()];
        } catch (HubAutomationSchedulerException|HubControlPlaneException $error) {
            $automation = ['status' => 'DEGRADED', 'code' => $error->codeName];
        }
    }


    $telemetry = ['status' => 'UNAVAILABLE'];
    try {
        $refresh = telemetryRefreshIfStale(null, 60);
        $telemetry = ['status' => 'READY', 'refresh' => (string) ($refresh['status'] ?? 'UNKNOWN')];
    } catch (Throwable) {
        // Infrastructure visibility is advisory and must never stop task execution.
        $telemetry = ['status' => 'DEGRADED'];
    }

    $control ??= HubControlPlaneService::openExisting($database);
    $execution = HubDurableExecutionService::fromEnvironment($pdo, static fn(array $request): array => $control->materializeContinuationSubmission($request));
    $batch = $execution->runBatch(4);
    $staffTelemetry = HubInfrastructureService::fromEnvironment()->status();
    $staffService = new HubStaffOperationsService($pdo, $database);
    $staff = $staffService->snapshot(null, $batch, $staffTelemetry, HubInfrastructureService::releaseState());
    $persistedBrief = $staffService->persistMorningBrief($staff['morningBrief']);
    $staff['persistedMorningBrief'] = $persistedBrief;
    fwrite(STDOUT, json_encode(['status' => $batch['processed'] === 0 ? 'IDLE' : 'PROCESSED', 'automation' => $automation, 'telemetry' => $telemetry, 'executionBatch' => $batch, 'recoveredExecutions' => (int) ($batch['recovered'] ?? 0), 'staff' => ['loop' => $staff['loop'], 'governor' => $staff['governor'], 'selfHealing' => $staff['selfHealing'], 'housekeeping' => $staff['housekeeping'], 'report' => $staff['report'], 'morningBrief' => $staff['morningBrief'], 'persistedMorningBrief' => $persistedBrief]], JSON_UNESCAPED_SLASHES) . "\n");
} catch (HubDurableExecutionException|HubProjectVaultException|HubCentralProjectAuthorityMigrationException $error) { fwrite(STDERR, $error->codeName . "\n"); exit(1); }
catch (Throwable) { fwrite(STDERR, "EXECUTOR_UNAVAILABLE\n"); exit(1); }
