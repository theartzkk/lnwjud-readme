<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubBackupService.php';

$action = strtolower((string) ($argv[1] ?? ''));
$database = (string) (getenv('AWH_HUB_DB_PATH') ?: '/var/lib/awh-hub/awh.sqlite');
$backupRoot = (string) (getenv('AWH_HUB_BACKUP_ROOT') ?: '/var/backups/awh');

try {
    if ($action === 'create') {
        $result = HubBackupService::create($database, $backupRoot);
    } elseif ($action === 'verify') {
        $backup = (string) ($argv[2] ?? '');
        $manifest = isset($argv[3]) ? (string) $argv[3] : $backup . '.json';
        $result = HubBackupService::verify($backup, $manifest);
    } elseif ($action === 'drill') {
        $backup = (string) ($argv[2] ?? '');
        $manifest = isset($argv[3]) ? (string) $argv[3] : $backup . '.json';
        $scratch = isset($argv[4]) ? (string) $argv[4] : sys_get_temp_dir();
        $result = HubBackupService::restoreDrill($backup, $manifest, $scratch);
    } else {
        throw new HubBackupException('Usage: backup.php create|verify|drill', 'BACKUP_ACTION_INVALID');
    }
    fwrite(STDOUT, json_encode(['ok' => true, 'result' => $result], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
    exit(0);
} catch (HubBackupException $error) {
    fwrite(STDERR, json_encode(['ok' => false, 'code' => $error->codeName, 'message' => $error->getMessage()], JSON_UNESCAPED_SLASHES) . "\n");
    exit(2);
} catch (Throwable) {
    fwrite(STDERR, json_encode(['ok' => false, 'code' => 'BACKUP_UNEXPECTED', 'message' => 'Backup operation failed']) . "\n");
    exit(3);
}
