<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubCentralProjectAuthorityMigration.php';
require_once dirname(__DIR__) . '/src/HubProjectVault.php';
require_once dirname(__DIR__) . '/src/HubProjectVaultService.php';
require_once dirname(__DIR__) . '/src/HubDurableExecutionService.php';

/**
 * One bounded, unprivileged executor tick.  A service manager invokes this
 * repeatedly; it never daemonizes, reads browser credentials, executes shell
 * commands, or enables network access itself.
 */
$database = getenv('AWH_HUB_DB_PATH');
if (!is_string($database) || $database === '' || str_contains($database, "\0")) { fwrite(STDERR, "DATABASE_CONFIG_INVALID\n"); exit(2); }
try {
    $pdo = new PDO('sqlite:' . $database, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]); $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec('PRAGMA busy_timeout = 2500');
    $result = HubDurableExecutionService::fromEnvironment($pdo)->runOnce();
    fwrite(STDOUT, json_encode(['status' => $result === null ? 'IDLE' : 'PROCESSED', 'execution' => $result], JSON_UNESCAPED_SLASHES) . "\n");
} catch (HubDurableExecutionException|HubProjectVaultException|HubCentralProjectAuthorityMigrationException $error) { fwrite(STDERR, $error->codeName . "\n"); exit(1); }
catch (Throwable) { fwrite(STDERR, "EXECUTOR_UNAVAILABLE\n"); exit(1); }
