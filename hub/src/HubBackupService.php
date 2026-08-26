<?php

declare(strict_types=1);

final class HubBackupException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'BACKUP_FAILED')
    {
        parent::__construct($message);
    }
}

final class HubBackupService
{
    public static function create(string $databasePath, string $backupRoot, ?string $now = null): array
    {
        self::assertSource($databasePath); self::assertBackupRoot($backupRoot);
        try { $createdAt = new DateTimeImmutable($now ?? 'now', new DateTimeZone('UTC')); }
        catch (Throwable) { throw new HubBackupException('Backup time is invalid', 'BACKUP_TIME_INVALID'); }
        $stamp = $createdAt->setTimezone(new DateTimeZone('UTC'))->format('Ymd\\THis\\Z');
        $backupPath = rtrim($backupRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . "awh-{$stamp}.sqlite";
        $manifestPath = $backupPath . '.json';
        if (file_exists($backupPath) || file_exists($manifestPath)) throw new HubBackupException('Backup target already exists', 'BACKUP_EXISTS');

        $pdo = self::open($databasePath); self::assertHealthy($pdo);
        $quoted = $pdo->quote($backupPath);
        if (!is_string($quoted)) throw new HubBackupException('Backup target is invalid', 'BACKUP_TARGET_INVALID');
        try {
            $pdo->exec('VACUUM INTO ' . $quoted);
            @chmod($backupPath, 0600);
            $verified = self::verify($backupPath);
            $manifest = [
                'schemaVersion' => 1,
                'createdAt' => $createdAt->setTimezone(new DateTimeZone('UTC'))->format(DATE_ATOM),
                'file' => basename($backupPath),
                'bytes' => $verified['bytes'],
                'sha256' => $verified['sha256'],
                'databaseUserVersion' => $verified['databaseUserVersion'],
                'integrity' => 'PASS',
                'foreignKeys' => 'PASS',
            ];
            $json = json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
            if (file_put_contents($manifestPath, $json, LOCK_EX) === false) throw new RuntimeException('manifest write failed');
            @chmod($manifestPath, 0600);
            return ['backupPath' => $backupPath, 'manifestPath' => $manifestPath, 'manifest' => $manifest];
        } catch (HubBackupException $error) {
            @unlink($manifestPath); @unlink($backupPath); throw $error;
        } catch (Throwable) {
            @unlink($manifestPath); @unlink($backupPath);
            throw new HubBackupException('Backup could not be created', 'BACKUP_CREATE_FAILED');
        }
    }

    public static function verify(string $backupPath, ?string $manifestPath = null): array
    {
        self::assertSource($backupPath);
        $pdo = self::open($backupPath); self::assertHealthy($pdo); $pdo->exec('PRAGMA query_only = ON');
        $hash = hash_file('sha256', $backupPath); $bytes = filesize($backupPath);
        if (!is_string($hash) || !is_int($bytes) || $bytes < 1) throw new HubBackupException('Backup payload is invalid', 'BACKUP_INVALID');
        $result = ['bytes' => $bytes, 'sha256' => $hash, 'databaseUserVersion' => (int) $pdo->query('PRAGMA user_version')->fetchColumn()];
        if ($manifestPath !== null) self::verifyManifest($manifestPath, $backupPath, $result);
        return $result;
    }

    public static function restoreDrill(string $backupPath, string $manifestPath, string $scratchRoot): array
    {
        self::assertBackupRoot($scratchRoot); $verified = self::verify($backupPath, $manifestPath);
        $restorePath = rtrim($scratchRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'awh-restore-drill-' . bin2hex(random_bytes(8)) . '.sqlite';
        try {
            if (!copy($backupPath, $restorePath)) throw new RuntimeException('restore copy failed');
            @chmod($restorePath, 0600); $restored = self::verify($restorePath);
            if (!hash_equals($verified['sha256'], $restored['sha256'])) throw new HubBackupException('Restore drill payload changed', 'BACKUP_RESTORE_MISMATCH');
            return ['status' => 'PASS', 'bytes' => $restored['bytes'], 'sha256' => $restored['sha256'], 'databaseUserVersion' => $restored['databaseUserVersion']];
        } catch (HubBackupException $error) { throw $error; }
        catch (Throwable) { throw new HubBackupException('Restore drill failed', 'BACKUP_RESTORE_FAILED'); }
        finally { @unlink($restorePath); }
    }

    public static function latestMetadata(string $backupRoot): array
    {
        if ($backupRoot === '' || !is_dir($backupRoot) || is_link($backupRoot)) return ['configured' => false, 'status' => 'NOT_CONFIGURED', 'latest' => null];
        $manifests = glob(rtrim($backupRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'awh-*.sqlite.json');
        if (!is_array($manifests) || $manifests === []) return ['configured' => true, 'status' => 'MISSING', 'latest' => null];
        usort($manifests, static fn (string $a, string $b): int => ((int) (@filemtime($b) ?: 0)) <=> ((int) (@filemtime($a) ?: 0)));
        $manifestPath = $manifests[0];
        try {
            $manifest = json_decode((string) file_get_contents($manifestPath), true, 16, JSON_THROW_ON_ERROR);
            if (!is_array($manifest) || !is_string($manifest['file'] ?? null) || basename($manifest['file']) !== $manifest['file']) throw new RuntimeException('bad manifest');
            $backupPath = rtrim($backupRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $manifest['file'];
            $verified = self::verify($backupPath, $manifestPath);
            return ['configured' => true, 'status' => 'VERIFIED', 'latest' => [
                'file' => basename($backupPath),
                'createdAt' => is_string($manifest['createdAt'] ?? null) ? $manifest['createdAt'] : null,
                'bytes' => $verified['bytes'],
                'sha256' => $verified['sha256'],
                'databaseUserVersion' => $verified['databaseUserVersion'],
            ]];
        } catch (Throwable) {
            return ['configured' => true, 'status' => 'REVIEW', 'latest' => null];
        }
    }

    private static function verifyManifest(string $manifestPath, string $backupPath, array $verified): void
    {
        if (!is_file($manifestPath) || is_link($manifestPath)) throw new HubBackupException('Backup manifest is invalid', 'BACKUP_MANIFEST_INVALID');
        try { $manifest = json_decode((string) file_get_contents($manifestPath), true, 16, JSON_THROW_ON_ERROR); }
        catch (Throwable) { throw new HubBackupException('Backup manifest is invalid', 'BACKUP_MANIFEST_INVALID'); }
        if (!is_array($manifest) || ($manifest['schemaVersion'] ?? null) !== 1 || ($manifest['file'] ?? null) !== basename($backupPath)) throw new HubBackupException('Backup manifest is invalid', 'BACKUP_MANIFEST_INVALID');
        if (!hash_equals((string) ($manifest['sha256'] ?? ''), (string) $verified['sha256']) || (int) ($manifest['bytes'] ?? -1) !== (int) $verified['bytes']) throw new HubBackupException('Backup manifest does not match payload', 'BACKUP_MANIFEST_MISMATCH');
        if (($manifest['integrity'] ?? null) !== 'PASS' || ($manifest['foreignKeys'] ?? null) !== 'PASS') throw new HubBackupException('Backup manifest health is invalid', 'BACKUP_MANIFEST_INVALID');
    }

    private static function open(string $path): PDO
    {
        try {
            $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
            $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec('PRAGMA busy_timeout = 5000'); return $pdo;
        } catch (Throwable) { throw new HubBackupException('SQLite backup database is unavailable', 'BACKUP_DATABASE_UNAVAILABLE'); }
    }

    private static function assertHealthy(PDO $pdo): void
    {
        $integrity = $pdo->query('PRAGMA integrity_check')->fetchColumn();
        if ($integrity !== 'ok') throw new HubBackupException('SQLite integrity check failed', 'BACKUP_INTEGRITY_FAILED');
        $foreign = $pdo->query('PRAGMA foreign_key_check')->fetchAll();
        if ($foreign !== []) throw new HubBackupException('SQLite foreign key check failed', 'BACKUP_FOREIGN_KEY_FAILED');
    }

    private static function assertSource(string $path): void
    {
        if ($path === '' || str_contains($path, "\0") || !is_file($path) || is_link($path)) throw new HubBackupException('Backup source is invalid', 'BACKUP_SOURCE_INVALID');
        $bytes = filesize($path); if (!is_int($bytes) || $bytes < 1) throw new HubBackupException('Backup source is empty', 'BACKUP_SOURCE_INVALID');
    }

    private static function assertBackupRoot(string $root): void
    {
        if ($root === '' || str_contains($root, "\0") || !is_dir($root) || is_link($root) || !is_writable($root)) throw new HubBackupException('Backup root is invalid', 'BACKUP_ROOT_INVALID');
        if (realpath($root) === false) throw new HubBackupException('Backup root is unavailable', 'BACKUP_ROOT_INVALID');
    }
}
