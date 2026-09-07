<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubBackupService.php';

$database = getenv('AWH_HUB_DB_PATH') ?: '/var/lib/awh-hub/awh.sqlite';
$backupRoot = getenv('AWH_HUB_BACKUP_ROOT') ?: '/var/backups/awh-hub';
$readGroup = getenv('AWH_HUB_BACKUP_READ_GROUP') ?: 'awh-hub';
$proofPath = getenv('AWH_RECOVERY_DRILL_PROOF_PATH') ?: '/var/lib/awh-hub/recovery-drill.json';

function awhWriteRecoveryProof(string $path, array $proof, string $readGroup): void
{
    if ($path === '' || !str_starts_with($path, '/var/lib/awh-hub/') || str_contains($path, "\0") || is_link($path)) {
        throw new HubBackupException('Recovery proof target is invalid', 'RECOVERY_PROOF_INVALID');
    }
    $directory = dirname($path);
    if (!is_dir($directory) || is_link($directory) || !is_writable($directory)) {
        throw new HubBackupException('Recovery proof storage is unavailable', 'RECOVERY_PROOF_UNAVAILABLE');
    }
    $json = json_encode($proof, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n";
    $temporary = $path . '.tmp-' . bin2hex(random_bytes(6));
    try {
        if (file_put_contents($temporary, $json, LOCK_EX) !== strlen($json)) {
            throw new HubBackupException('Recovery proof could not be written', 'RECOVERY_PROOF_WRITE_FAILED');
        }
        @chmod($temporary, 0640);
        @chgrp($temporary, $readGroup);
        if (!rename($temporary, $path)) {
            throw new HubBackupException('Recovery proof could not be activated', 'RECOVERY_PROOF_WRITE_FAILED');
        }
        @chmod($path, 0640);
        @chgrp($path, $readGroup);
    } finally {
        if (is_file($temporary) && !is_link($temporary)) @unlink($temporary);
    }
}

try {
    if (!preg_match('/^[a-z_][a-z0-9_-]{0,31}$/D', $readGroup)) {
        throw new HubBackupException('Backup read group is invalid', 'BACKUP_GROUP_INVALID');
    }
    $created = HubBackupService::create($database, $backupRoot, null, $readGroup);
    $verified = HubBackupService::verify($created['backupPath'], $created['manifestPath']);
    $drill = HubBackupService::restoreDrill($created['backupPath'], $created['manifestPath'], $backupRoot);
    awhWriteRecoveryProof($proofPath, [
        'schemaVersion' => 1,
        'state' => 'PASS',
        'verifiedAt' => gmdate('c'),
        'backupName' => basename($created['backupPath']),
        'databaseSchemaVersion' => (int) $drill['databaseUserVersion'],
    ], $readGroup);
    fwrite(STDOUT, json_encode([
        'status' => 'VERIFIED',
        'backup' => basename($created['backupPath']),
        'bytes' => $verified['bytes'],
        'sha256' => $verified['sha256'],
        'databaseUserVersion' => $verified['databaseUserVersion'],
        'restoreDrill' => 'PASS',
    ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
    exit(0);
} catch (HubBackupException $error) {
    try {
        awhWriteRecoveryProof($proofPath, [
            'schemaVersion' => 1,
            'state' => 'FAILED',
            'verifiedAt' => gmdate('c'),
            'backupName' => 'unavailable',
            'databaseSchemaVersion' => 0,
        ], preg_match('/^[a-z_][a-z0-9_-]{0,31}$/D', $readGroup) ? $readGroup : 'awh-hub');
    } catch (Throwable) {
        // The original backup/recovery failure remains authoritative.
    }
    fwrite(STDERR, 'AWH_BACKUP_FAILED=' . $error->codeName . "\n");
    exit(2);
}
