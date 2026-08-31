<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubBackupService.php';

$database = getenv('AWH_HUB_DB_PATH') ?: '/var/lib/awh-hub/awh.sqlite';
$backupRoot = getenv('AWH_HUB_BACKUP_ROOT') ?: '/var/backups/awh-hub';
$readGroup = getenv('AWH_HUB_BACKUP_READ_GROUP') ?: 'awh-hub';

try {
    if (!preg_match('/^[a-z_][a-z0-9_-]{0,31}$/D', $readGroup)) {
        throw new HubBackupException('Backup read group is invalid', 'BACKUP_GROUP_INVALID');
    }
    $created = HubBackupService::create($database, $backupRoot, null, $readGroup);
    $verified = HubBackupService::verify($created['backupPath'], $created['manifestPath']);
    fwrite(STDOUT, json_encode([
        'status' => 'VERIFIED',
        'backup' => basename($created['backupPath']),
        'bytes' => $verified['bytes'],
        'sha256' => $verified['sha256'],
        'databaseUserVersion' => $verified['databaseUserVersion'],
    ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
    exit(0);
} catch (HubBackupException $error) {
    fwrite(STDERR, 'AWH_BACKUP_FAILED=' . $error->codeName . "\n");
    exit(2);
}
