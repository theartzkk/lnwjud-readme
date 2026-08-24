<?php

declare(strict_types=1);

require_once __DIR__ . '/HubFoundingMemoryMigration.php';

/**
 * M11 adds only owner-facing provider metadata.  Project, conversation,
 * memory, task, worker, artifact and credential authorities remain where
 * M7--M10 established them.
 */
final class HubSelfServiceMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'MIGRATION_FAILED') { parent::__construct($message); }
}

final class HubSelfServiceMigration
{
    public const TARGET_USER_VERSION = 11;
    public const MIGRATION_ID = 'm11-self-service';
    private const TABLES = ['control_provider_credentials', 'control_project_provider_overrides'];
    private const INDEXES = ['idx_control_provider_credentials_updated', 'idx_control_project_provider_overrides_provider'];

    public static function apply(string $databasePath, string $sqlPath, ?string $now = null): string
    {
        $pdo = self::open($databasePath);
        $sql = @file_get_contents($sqlPath);
        if (!is_string($sql) || $sql === '') throw new HubSelfServiceMigrationException('Self-service migration is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash('sha256', $sql); $version = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
        if ($version < 10) throw new HubSelfServiceMigrationException('M10 Founding Memory authority is unavailable', 'BASE_SCHEMA_INVALID');
        try { HubFoundingMemoryMigration::assertCapabilityReady($pdo, dirname(__DIR__) . '/migrations/009_founding_memory.sql'); }
        catch (Throwable) { throw new HubSelfServiceMigrationException('M10 Founding Memory authority is unavailable', 'BASE_SCHEMA_INVALID'); }
        $q = $pdo->prepare('SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = :id'); $q->execute(['id' => self::MIGRATION_ID]); $ledger = $q->fetch();
        if (is_array($ledger)) {
            if ((int) $ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals((string) $ledger['checksum'], $checksum) || $version < self::TARGET_USER_VERSION || !self::ready($pdo)) throw new HubSelfServiceMigrationException('Self-service migration record is invalid', 'MIGRATION_RECORD_INVALID');
            return 'already-applied';
        }
        if ($version > 10 || self::presentTables($pdo) !== []) throw new HubSelfServiceMigrationException('Self-service migration order is not provable', 'MIGRATION_ORDER_UNCERTAIN');
        $at = self::timestamp($now ?? gmdate('c'));
        try {
            $pdo->beginTransaction(); $pdo->exec($sql);
            $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id, schema_version, checksum, applied_at) VALUES(:id, :version, :checksum, :at)')->execute(['id' => self::MIGRATION_ID, 'version' => self::TARGET_USER_VERSION, 'checksum' => $checksum, 'at' => $at]);
            $pdo->exec('PRAGMA user_version = 11'); self::assertReady($pdo, $checksum); $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($error instanceof HubSelfServiceMigrationException) throw $error;
            throw new HubSelfServiceMigrationException('Self-service migration rolled back', 'MIGRATION_ROLLED_BACK');
        }
        return 'applied';
    }

    public static function assertCapabilityReady(PDO $pdo, string $sqlPath): void
    {
        if (!is_file($sqlPath)) throw new HubSelfServiceMigrationException('Self-service migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        self::assertReady($pdo, hash_file('sha256', $sqlPath));
    }

    private static function assertReady(PDO $pdo, string $checksum): void
    {
        $q = $pdo->prepare('SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = :id'); $q->execute(['id' => self::MIGRATION_ID]); $ledger = $q->fetch();
        if ((int) $pdo->query('PRAGMA user_version')->fetchColumn() < self::TARGET_USER_VERSION || !is_array($ledger) || (int) $ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals(strtolower($checksum), strtolower((string) ($ledger['checksum'] ?? ''))) || !self::ready($pdo) || $pdo->query('PRAGMA foreign_key_check')->fetchAll() !== []) throw new HubSelfServiceMigrationException('Self-service capability is not ready', 'SELF_SERVICE_SCHEMA_NOT_READY');
    }

    private static function open(string $path): PDO
    {
        if ($path === '' || str_contains($path, "\0")) throw new HubSelfServiceMigrationException('Database path is invalid', 'DATABASE_CONFIG_INVALID');
        try { $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]); $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec('PRAGMA busy_timeout = 2500'); return $pdo; }
        catch (Throwable) { throw new HubSelfServiceMigrationException('Database is unavailable', 'DATABASE_UNAVAILABLE'); }
    }

    /** @return list<string> */
    private static function presentTables(PDO $pdo): array { $out = []; foreach (self::TABLES as $table) if ($pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '" . $table . "'")->fetchColumn() !== false) $out[] = $table; return $out; }
    private static function ready(PDO $pdo): bool { foreach (self::INDEXES as $index) if ($pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = '" . $index . "'")->fetchColumn() === false) return false; return self::presentTables($pdo) === self::TABLES; }
    private static function timestamp(string $value): string { if (strtotime($value) === false) throw new HubSelfServiceMigrationException('Self-service migration time is invalid', 'MIGRATION_FAILED'); return gmdate('c', strtotime($value)); }
}
