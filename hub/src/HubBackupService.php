<?php

declare(strict_types=1);

final class HubBackupException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'BACKUP_FAILED') { parent::__construct($message); }
}

final class HubBackupService
{
    private const MAX_MANIFEST_BYTES = 65536;

    public static function create(string $databasePath, string $backupRoot, ?string $now = null): array
    {
        self::assertSource($databasePath);
        self::assertBackupRoot($backupRoot);
        $createdAt = new DateTimeImmutable($now ?? 'now', new DateTimeZone('UTC'));
        $stamp = $createdAt->format('Ymd\THis\Z');
        $backupPath = rtrim($backupRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . "awh-{$stamp}.sqlite";
        $manifestPath = $backupPath . '.json';
        if (file_exists($backupPath) || file_exists($manifestPath)) throw new HubBackupException('Backup target already exists', 'BACKUP_EXISTS');

        $pdo = self::open($databasePath);
        self::assertHealthy($pdo);
        $quoted = $pdo->quote($backupPath);
        if (!is_string($quoted)) throw new HubBackupException('Backup target is invalid', 'BACKUP_TARGET_INVALID');
        try { $pdo->exec('VACUUM INTO ' . $quoted); }
        catch (Throwable) { throw new HubBackupException('SQLite snapshot could not be created', 'BACKUP_CREATE_FAILED'); }
        @chmod($backupPath, 0600);

        $verified = self::verify($backupPath);
        $manifest = [
            'schemaVersion' => 1,
            'createdAt' => $createdAt->format(DATE_ATOM),
            'file' => basename($backupPath),
            'bytes' => $verified['bytes'],
            'sha256' => $verified['sha256'],
            'databaseUserVersion' => $verified['databaseUserVersion'],
            'integrity' => 'PASS',
            'foreignKeys' => 'PASS',
        ];
        self::writeManifest($manifestPath, $manifest);
        return ['backupPath' => $backupPath, 'manifestPath' => $manifestPath, 'manifest' => $manifest];
    }

    public static function verify(string $backupPath, ?string $manifestPath = null): array
    {
        self::assertSource($backupPath);
        $pdo = self::open($backupPath);
        self::assertHealthy($pdo);
        $hash = hash_file('sha256', $backupPath);
        $bytes = filesize($backupPath);
        if (!is_string($hash) || !is_int($bytes) || $bytes < 1) throw new HubBackupException('Backup payload is invalid', 'BACKUP_INVALID');
        $result = [
            'status' => 'VERIFIED',
            'bytes' => $bytes,
            'sha256' => $hash,
            'databaseUserVersion' => (int) $pdo->query('PRAGMA user_version')->fetchColumn(),
        ];
        if ($manifestPath !== null) self::verifyManifest($manifestPath, basename($backupPath), $result);
        return $result;
    }

    public static function restoreDrill(string $backupPath, string $manifestPath, string $scratchRoot): array
    {
        self::assertBackupRoot($scratchRoot);
        $verified = self::verify($backupPath, $manifestPath);
        $drillPath = rtrim($scratchRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'awh-restore-drill-' . bin2hex(random_bytes(8)) . '.sqlite';
        if (file_exists($drillPath) || is_link($drillPath)) throw new HubBackupException('Restore drill target already exists', 'RESTORE_DRILL_EXISTS');
        try {
            if (!copy($backupPath, $drillPath)) throw new HubBackupException('Restore drill could not materialize snapshot', 'RESTORE_DRILL_COPY_FAILED');
            @chmod($drillPath, 0600);
            $restored = self::verify($drillPath);
            if (!hash_equals($verified['sha256'], $restored['sha256']) || $verified['databaseUserVersion'] !== $restored['databaseUserVersion']) throw new HubBackupException('Restore drill does not match source backup', 'RESTORE_DRILL_MISMATCH');
            return ['status' => 'PASS', 'databaseUserVersion' => $restored['databaseUserVersion'], 'sha256' => $restored['sha256']];
        } finally {
            if (is_file($drillPath) && !is_link($drillPath)) @unlink($drillPath);
        }
    }

    public static function latestMetadata(string $backupRoot): array
    {
        if ($backupRoot === '' || str_contains($backupRoot, "\0") || !is_dir($backupRoot) || is_link($backupRoot)) return ['configured' => false, 'latest' => null];
        $manifests = glob(rtrim($backupRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'awh-*.sqlite.json');
        if (!is_array($manifests) || $manifests === []) return ['configured' => true, 'latest' => null];
        usort($manifests, static fn (string $a, string $b): int => ((int) (@filemtime($b) ?: 0)) <=> ((int) (@filemtime($a) ?: 0)));
        $newest = $manifests[0];
        if (!is_file($newest) || is_link($newest)) return ['configured' => true, 'latest' => ['status' => 'REVIEW', 'reason' => 'LATEST_MANIFEST_UNAVAILABLE']];
        $newestBackup = substr($newest, 0, -5);
        try {
            $verified = self::verify($newestBackup, $newest);
            $raw = self::readManifest($newest);
            return ['configured' => true, 'latest' => [
                'name' => basename($newestBackup),
                'sizeBytes' => $verified['bytes'],
                'modifiedAt' => is_string($raw['createdAt'] ?? null) ? $raw['createdAt'] : gmdate('c', (int) (@filemtime($newest) ?: time())),
                'status' => 'VERIFIED',
                'sha256' => $verified['sha256'],
                'databaseUserVersion' => $verified['databaseUserVersion'],
            ]];
        } catch (Throwable) {
            // The newest snapshot must remain visible as REVIEW. Falling back
            // to an older verified file would misreport recovery freshness.
            $review = ['status' => 'REVIEW', 'name' => basename($newestBackup), 'sizeBytes' => is_file($newestBackup) ? max(0, (int) (@filesize($newestBackup) ?: 0)) : 0, 'modifiedAt' => gmdate('c', (int) (@filemtime($newest) ?: time())), 'reason' => 'LATEST_BACKUP_INVALID'];
            foreach (array_slice($manifests, 1) as $manifestPath) {
                if (!is_file($manifestPath) || is_link($manifestPath)) continue;
                $backupPath = substr($manifestPath, 0, -5);
                try {
                    $verified = self::verify($backupPath, $manifestPath);
                    $raw = self::readManifest($manifestPath);
                    $review['lastVerified'] = ['name' => basename($backupPath), 'sizeBytes' => $verified['bytes'], 'modifiedAt' => is_string($raw['createdAt'] ?? null) ? $raw['createdAt'] : gmdate('c', (int) (@filemtime($manifestPath) ?: time())), 'databaseUserVersion' => $verified['databaseUserVersion']];
                    break;
                } catch (Throwable) { continue; }
            }
            return ['configured' => true, 'latest' => $review];
        }
    }

    private static function open(string $path): PDO
    {
        try {
            if (!defined('PDO::SQLITE_ATTR_OPEN_FLAGS') || !defined('PDO::SQLITE_OPEN_READONLY')) {
                throw new RuntimeException('PDO SQLite read-only flags are unavailable');
            }
            $pdo = new PDO('sqlite:' . $path, null, null, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::SQLITE_ATTR_OPEN_FLAGS => PDO::SQLITE_OPEN_READONLY,
            ]);
            $pdo->exec('PRAGMA foreign_keys = ON');
            $pdo->exec('PRAGMA busy_timeout = 5000');
            return $pdo;
        } catch (Throwable) { throw new HubBackupException('SQLite backup database is unavailable', 'BACKUP_DATABASE_UNAVAILABLE'); }
    }

    private static function assertHealthy(PDO $pdo): void
    {
        try {
            $integrity = $pdo->query('PRAGMA integrity_check')->fetchAll(PDO::FETCH_COLUMN);
            if ($integrity !== ['ok']) throw new HubBackupException('SQLite integrity check failed', 'BACKUP_INTEGRITY_FAILED');
            $foreign = $pdo->query('PRAGMA foreign_key_check')->fetchAll();
            if ($foreign !== []) throw new HubBackupException('SQLite foreign key check failed', 'BACKUP_FOREIGN_KEY_FAILED');
        } catch (HubBackupException $error) { throw $error; }
        catch (Throwable) { throw new HubBackupException('SQLite backup health check failed', 'BACKUP_HEALTH_FAILED'); }
    }

    private static function assertSource(string $path): void
    {
        if ($path === '' || str_contains($path, "\0") || !is_file($path) || is_link($path) || !is_readable($path)) throw new HubBackupException('Backup source is invalid', 'BACKUP_SOURCE_INVALID');
    }

    private static function assertBackupRoot(string $root): void
    {
        if ($root === '' || str_contains($root, "\0") || !is_dir($root) || is_link($root) || !is_writable($root)) throw new HubBackupException('Backup root is invalid', 'BACKUP_ROOT_INVALID');
    }

    private static function writeManifest(string $path, array $manifest): void
    {
        $json = json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
        $temporary = $path . '.tmp-' . bin2hex(random_bytes(6));
        try {
            if (file_put_contents($temporary, $json, LOCK_EX) !== strlen($json)) throw new HubBackupException('Backup manifest could not be written', 'BACKUP_MANIFEST_WRITE_FAILED');
            @chmod($temporary, 0600);
            if (!rename($temporary, $path)) throw new HubBackupException('Backup manifest could not be activated', 'BACKUP_MANIFEST_WRITE_FAILED');
        } finally { if (is_file($temporary) && !is_link($temporary)) @unlink($temporary); }
    }

    private static function readManifest(string $path): array
    {
        if (!is_file($path) || is_link($path) || !is_readable($path)) throw new HubBackupException('Backup manifest is invalid', 'BACKUP_MANIFEST_INVALID');
        $bytes = filesize($path);
        if (!is_int($bytes) || $bytes < 2 || $bytes > self::MAX_MANIFEST_BYTES) throw new HubBackupException('Backup manifest is invalid', 'BACKUP_MANIFEST_INVALID');
        try { $decoded = json_decode((string) file_get_contents($path), true, 16, JSON_THROW_ON_ERROR); }
        catch (Throwable) { throw new HubBackupException('Backup manifest is invalid', 'BACKUP_MANIFEST_INVALID'); }
        if (!is_array($decoded) || ($decoded['schemaVersion'] ?? null) !== 1) throw new HubBackupException('Backup manifest is invalid', 'BACKUP_MANIFEST_INVALID');
        return $decoded;
    }

    private static function verifyManifest(string $manifestPath, string $expectedFile, array $verified): void
    {
        $manifest = self::readManifest($manifestPath);
        $validHash = is_string($manifest['sha256'] ?? null) && hash_equals((string) $manifest['sha256'], $verified['sha256']);
        $valid = ($manifest['file'] ?? null) === $expectedFile
            && (int) ($manifest['bytes'] ?? -1) === $verified['bytes']
            && (int) ($manifest['databaseUserVersion'] ?? -1) === $verified['databaseUserVersion']
            && ($manifest['integrity'] ?? null) === 'PASS'
            && ($manifest['foreignKeys'] ?? null) === 'PASS'
            && $validHash;
        if (!$valid) throw new HubBackupException('Backup manifest does not match payload', 'BACKUP_MANIFEST_MISMATCH');
    }
}
