<?php

declare(strict_types=1);

final class HubOwnerAuthMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'MIGRATION_FAILED') { parent::__construct($message); }
}

final class HubOwnerAuthMigration
{
    public const TARGET_USER_VERSION = 5;
    public const MIGRATION_ID = 'm5-owner-auth';
    private const TABLES = ['owner_passwords', 'auth_login_rate_limits', 'auth_recovery_codes', 'auth_audit_events'];
    private const SESSION_COLUMNS = ['session_kind', 'remembered_until', 'step_up_at'];

    public static function apply(string $databasePath, string $sqlPath, ?string $now = null): string
    {
        $pdo = self::open($databasePath);
        $sql = @file_get_contents($sqlPath);
        if (!is_string($sql) || $sql === '') throw new HubOwnerAuthMigrationException('Owner auth migration is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash('sha256', $sql);
        $version = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
        if ($version < 4) throw new HubOwnerAuthMigrationException('SQLite schema is older than the M4 control authority', 'SCHEMA_VERSION_MISMATCH');
        $sessionTable = $pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'control_sessions'")->fetchColumn();
        if ($sessionTable === false) throw new HubOwnerAuthMigrationException('M4 control session authority is unavailable', 'BASE_SCHEMA_INVALID');
        $q = $pdo->prepare('SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = :id');
        $q->execute(['id' => self::MIGRATION_ID]);
        $ledger = $q->fetch();
        if (is_array($ledger)) {
            if ((int) $ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals((string) $ledger['checksum'], $checksum) || $version < self::TARGET_USER_VERSION || !self::ready($pdo)) throw new HubOwnerAuthMigrationException('Owner auth migration record is invalid', 'MIGRATION_RECORD_INVALID');
            return 'already-applied';
        }
        if ($version > 4 || self::presentTables($pdo) !== []) throw new HubOwnerAuthMigrationException('Owner auth migration order is not provable from the ledger', 'MIGRATION_ORDER_UNCERTAIN');
        $now ??= gmdate('c');
        try {
            $pdo->beginTransaction();
            $pdo->exec($sql);
            $insert = $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id, schema_version, checksum, applied_at) VALUES(:id, :version, :checksum, :at)');
            $insert->execute(['id' => self::MIGRATION_ID, 'version' => self::TARGET_USER_VERSION, 'checksum' => $checksum, 'at' => $now]);
            $pdo->exec('PRAGMA user_version = 5');
            if (!self::ready($pdo) || $pdo->query('PRAGMA foreign_key_check')->fetchAll() !== []) throw new RuntimeException('owner auth schema verification failed');
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($error instanceof HubOwnerAuthMigrationException) throw $error;
            throw new HubOwnerAuthMigrationException('Owner auth migration rolled back', 'MIGRATION_ROLLED_BACK');
        }
        return 'applied';
    }

    public static function assertCapabilityReady(PDO $pdo, string $sqlPath): void
    {
        if (!is_file($sqlPath)) throw new HubOwnerAuthMigrationException('Owner auth migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash_file('sha256', $sqlPath);
        $q = $pdo->prepare('SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = :id');
        $q->execute(['id' => self::MIGRATION_ID]); $ledger = $q->fetch();
        if ((int) $pdo->query('PRAGMA user_version')->fetchColumn() < self::TARGET_USER_VERSION || !is_array($ledger) || (int) $ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals(strtolower((string) $checksum), strtolower((string) ($ledger['checksum'] ?? ''))) || !self::ready($pdo)) throw new HubOwnerAuthMigrationException('Owner auth capability is not ready', 'AUTH_SCHEMA_NOT_READY');
        if ($pdo->query('PRAGMA foreign_key_check')->fetchAll() !== []) throw new HubOwnerAuthMigrationException('Owner auth foreign-key check failed', 'FOREIGN_KEY_CHECK_FAILED');
    }

    private static function open(string $path): PDO { if ($path === '' || str_contains($path, "\0")) throw new HubOwnerAuthMigrationException('Database path is invalid', 'DATABASE_CONFIG_INVALID'); try { $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]); $pdo->exec('PRAGMA foreign_keys = ON'); return $pdo; } catch (Throwable) { throw new HubOwnerAuthMigrationException('Database is unavailable', 'DATABASE_UNAVAILABLE'); } }
    private static function presentTables(PDO $pdo): array { $out = []; foreach (self::TABLES as $table) { $q = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = :name"); $q->execute(['name' => $table]); if ($q->fetchColumn() !== false) $out[] = $table; } return $out; }
    private static function missingSessionColumns(PDO $pdo): array { $columns = array_column($pdo->query('PRAGMA table_info(control_sessions)')->fetchAll(), 'name'); return array_values(array_diff(self::SESSION_COLUMNS, $columns)); }
    private static function ready(PDO $pdo): bool { return self::presentTables($pdo) === self::TABLES && self::missingSessionColumns($pdo) === []; }
}
