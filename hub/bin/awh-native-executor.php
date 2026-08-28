<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubCentralProjectAuthorityMigration.php';
require_once dirname(__DIR__) . '/src/HubProjectVault.php';
require_once dirname(__DIR__) . '/src/HubProjectVaultService.php';
require_once dirname(__DIR__) . '/src/HubDurableExecutionService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneService.php';
require_once dirname(__DIR__) . '/src/HubAutomationSchedulerService.php';

/**
 * One bounded, unprivileged executor tick. A service manager invokes this
 * repeatedly; each invocation stays one-shot, reads no browser credentials, executes
 * no shell commands, and enables no network access itself. Schema-15 automations reuse this
 * same timer and materialize only through HubControlPlaneService authorities.
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

    $result = HubDurableExecutionService::fromEnvironment($pdo)->runOnce();
    fwrite(STDOUT, json_encode(['status' => $result === null ? 'IDLE' : 'PROCESSED', 'automation' => $automation, 'execution' => $result], JSON_UNESCAPED_SLASHES) . "\n");
} catch (HubDurableExecutionException|HubProjectVaultException|HubCentralProjectAuthorityMigrationException $error) { fwrite(STDERR, $error->codeName . "\n"); exit(1); }
catch (Throwable) { fwrite(STDERR, "EXECUTOR_UNAVAILABLE\n"); exit(1); }
