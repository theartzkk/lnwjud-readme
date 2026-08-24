<?php

declare(strict_types=1);

final class HubControlPlaneMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'MIGRATION_FAILED')
    {
        parent::__construct($message);
    }
}

final class HubControlPlaneMigration
{
    public const TARGET_USER_VERSION = 4;
    public const MIGRATION_ID = 'm4-control-plane';
    private const TABLES = ['control_sessions', 'control_session_rate_limits', 'control_tasks', 'control_task_events', 'control_workers', 'control_artifacts', 'control_approvals'];

    public static function apply(string $databasePath, string $migrationSqlPath, ?string $now = null): string
    {
        $pdo = self::open($databasePath);
        $sql = @file_get_contents($migrationSqlPath);
        if (!is_string($sql) || $sql === '') throw new HubControlPlaneMigrationException('M4 migration SQL is unavailable', 'MIGRATION_SQL_UNAVAILABLE');
        $checksum = hash('sha256', $sql);
        $now ??= gmdate('c');
        $version = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
        if ($version !== 3 && $version !== self::TARGET_USER_VERSION) throw new HubControlPlaneMigrationException('SQLite schema version is not M3E-compatible', 'SCHEMA_VERSION_MISMATCH');
        $ledger = $pdo->query("SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = '" . self::MIGRATION_ID . "'")->fetch();
        if (is_array($ledger)) {
            if ((int) $ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals((string) $ledger['checksum'], $checksum) || $version < self::TARGET_USER_VERSION || !self::schemaPresent($pdo)) throw new HubControlPlaneMigrationException('Applied M4 migration record is invalid', 'MIGRATION_RECORD_INVALID');
            return 'already-applied';
        }
        if ($version === self::TARGET_USER_VERSION || self::presentTables($pdo) !== []) throw new HubControlPlaneMigrationException('Partial or untracked M4 schema detected', 'MIGRATION_PARTIAL');
        try {
            $pdo->beginTransaction();
            $pdo->exec($sql);
            $insert = $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id, schema_version, checksum, applied_at) VALUES(:id, :version, :checksum, :at)');
            $insert->execute(['id' => self::MIGRATION_ID, 'version' => self::TARGET_USER_VERSION, 'checksum' => $checksum, 'at' => $now]);
            $pdo->exec('PRAGMA user_version = 4');
            self::verify($pdo);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($error instanceof HubControlPlaneMigrationException) throw $error;
            throw new HubControlPlaneMigrationException('M4 migration failed closed', 'MIGRATION_FAILED');
        }
        return 'applied';
    }

    public static function verifyDatabase(string $databasePath, string $migrationSqlPath): void
    {
        $pdo = self::open($databasePath);
        $sql = @file_get_contents($migrationSqlPath);
        if (!is_string($sql) || !is_array($pdo->query("SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = '" . self::MIGRATION_ID . "'")->fetch())) throw new HubControlPlaneMigrationException('M4 migration is not recorded', 'MIGRATION_NOT_APPLIED');
        $row = $pdo->query("SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = '" . self::MIGRATION_ID . "'")->fetch();
        if ((int) $pdo->query('PRAGMA user_version')->fetchColumn() < self::TARGET_USER_VERSION || (int) $row['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals((string) $row['checksum'], hash('sha256', $sql)) || !self::schemaPresent($pdo)) throw new HubControlPlaneMigrationException('M4 schema verification failed', 'SCHEMA_VERIFY_FAILED');
    }

    private static function open(string $path): PDO
    {
        if ($path === '' || str_contains($path, "\0")) throw new HubControlPlaneMigrationException('Database path is invalid', 'DATABASE_CONFIG_INVALID');
        try { $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]); $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec('PRAGMA busy_timeout = 2500'); return $pdo; } catch (Throwable) { throw new HubControlPlaneMigrationException('Database is unavailable', 'DATABASE_UNAVAILABLE'); }
    }

    private static function presentTables(PDO $pdo): array
    {
        $out = [];
        foreach (self::TABLES as $table) { $q = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = :name"); $q->execute(['name' => $table]); if ($q->fetchColumn() !== false) $out[] = $table; }
        return $out;
    }

    private static function schemaPresent(PDO $pdo): bool { return self::presentTables($pdo) === self::TABLES && (bool) $pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_control_tasks_user_idempotency'")->fetchColumn(); }
    private static function verify(PDO $pdo): void { if (!self::schemaPresent($pdo) || (int) $pdo->query('PRAGMA user_version')->fetchColumn() < self::TARGET_USER_VERSION || $pdo->query('PRAGMA foreign_key_check')->fetchAll() !== []) throw new HubControlPlaneMigrationException('M4 schema verification failed', 'SCHEMA_VERIFY_FAILED'); }
}
