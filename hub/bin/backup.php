<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubBackupService.php';

$action = strtolower($argv[1] ?? '');
$database = $argv[2] ?? getenv('AWH_HUB_DB_PATH') ?: '/var/lib/awh-hub/awh.sqlite';
$backupRoot = $argv[3] ?? getenv('AWH_HUB_BACKUP_ROOT') ?: '/var/backups/awh-hub';
$readGroup = getenv('AWH_HUB_BACKUP_READ_GROUP');
if (($readGroup === false || $readGroup === '') && rtrim($backupRoot, DIRECTORY_SEPARATOR) === '/var/backups/awh-hub') $readGroup = 'awh-hub';
if ($readGroup === false || $readGroup === '') $readGroup = null;

try {
    if ($action === 'create') {
        $result = HubBackupService::create($database, $backupRoot, $argv[4] ?? null, is_string($readGroup) ? $readGroup : null);
        fwrite(STDOUT, json_encode(['status' => 'CREATED', 'backup' => basename($result['backupPath']), 'manifest' => $result['manifest']], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
        exit(0);
    }
    if ($action === 'verify') {
        $manifest = $argv[3] ?? ($database . '.json');
        $result = HubBackupService::verify($database, $manifest);
        fwrite(STDOUT, json_encode($result, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
        exit(0);
    }
    if ($action === 'drill') {
        $manifest = $argv[3] ?? ($database . '.json');
        $scratch = $argv[4] ?? getenv('AWH_HUB_RESTORE_DRILL_ROOT') ?: sys_get_temp_dir();
        $result = HubBackupService::restoreDrill($database, $manifest, $scratch);
        fwrite(STDOUT, json_encode($result, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
        exit(0);
    }
    fwrite(STDERR, "Usage: php hub/bin/backup.php create [db] [backupRoot] [now]\n       php hub/bin/backup.php verify <backup.sqlite> [manifest.json]\n       php hub/bin/backup.php drill <backup.sqlite> [manifest.json] [scratchRoot]\n");
    exit(64);
} catch (HubBackupException $error) {
    fwrite(STDERR, 'AWH_BACKUP_FAILED=' . $error->codeName . "\n");
    exit(2);
}
