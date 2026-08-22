<?php

declare(strict_types=1);

require_once __DIR__ . '/HubAssistantWorkstreamMigration.php';

final class HubWorkspaceContinuityMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'MIGRATION_FAILED') { parent::__construct($message); }
}

/** M7 stores only WIP metadata/leases; Git remains the portable source authority. */
final class HubWorkspaceContinuityMigration
{
    public const TARGET_USER_VERSION = 7;
    public const MIGRATION_ID = 'm7-workspace-continuity';
    private const TABLES = ['control_workspace_checkpoints', 'control_workspace_leases', 'control_workspace_events'];

    public static function apply(string $databasePath, string $sqlPath, ?string $now = null): string
    {
        $pdo = self::open($databasePath);
        $sql = @file_get_contents($sqlPath);
        if (!is_string($sql) || $sql === '') throw new HubWorkspaceContinuityMigrationException('Workspace continuity migration is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash('sha256', $sql);
        $version = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
        if ($version < 6) throw new HubWorkspaceContinuityMigrationException('M6 assistant authority is unavailable', 'BASE_SCHEMA_INVALID');
        try { HubAssistantWorkstreamMigration::assertCapabilityReady($pdo, dirname(__DIR__) . '/migrations/005_assistant_workstream.sql'); }
        catch (Throwable) { throw new HubWorkspaceContinuityMigrationException('M6 assistant authority is unavailable', 'BASE_SCHEMA_INVALID'); }
        $q = $pdo->prepare('SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = :id'); $q->execute(['id' => self::MIGRATION_ID]); $ledger = $q->fetch();
        if (is_array($ledger)) {
            if ((int) $ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals((string) $ledger['checksum'], $checksum) || $version < self::TARGET_USER_VERSION || !self::ready($pdo)) throw new HubWorkspaceContinuityMigrationException('Workspace continuity migration record is invalid', 'MIGRATION_RECORD_INVALID');
            return 'already-applied';
        }
        if ($version > 6 || self::presentTables($pdo) !== []) throw new HubWorkspaceContinuityMigrationException('Workspace continuity migration order is not provable', 'MIGRATION_ORDER_UNCERTAIN');
        $now ??= gmdate('c');
        try {
            $pdo->beginTransaction();
            $pdo->exec($sql);
            $insert = $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id, schema_version, checksum, applied_at) VALUES(:id, :version, :checksum, :at)');
            $insert->execute(['id' => self::MIGRATION_ID, 'version' => self::TARGET_USER_VERSION, 'checksum' => $checksum, 'at' => $now]);
            $pdo->exec('PRAGMA user_version = 7');
            self::assertReady($pdo, $checksum);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($error instanceof HubWorkspaceContinuityMigrationException) throw $error;
            throw new HubWorkspaceContinuityMigrationException('Workspace continuity migration rolled back', 'MIGRATION_ROLLED_BACK');
        }
        return 'applied';
    }

    public static function assertCapabilityReady(PDO $pdo, string $sqlPath): void
    {
        if (!is_file($sqlPath)) throw new HubWorkspaceContinuityMigrationException('Workspace continuity migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        self::assertReady($pdo, hash_file('sha256', $sqlPath));
    }

    private static function assertReady(PDO $pdo, string $checksum): void
    {
        $q = $pdo->prepare('SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = :id'); $q->execute(['id' => self::MIGRATION_ID]); $ledger = $q->fetch();
        if ((int) $pdo->query('PRAGMA user_version')->fetchColumn() < self::TARGET_USER_VERSION || !is_array($ledger) || (int) $ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals(strtolower($checksum), strtolower((string) ($ledger['checksum'] ?? ''))) || !self::ready($pdo) || $pdo->query('PRAGMA foreign_key_check')->fetchAll() !== []) throw new HubWorkspaceContinuityMigrationException('Workspace continuity capability is not ready', 'WORKSPACE_SCHEMA_NOT_READY');
    }

    private static function open(string $path): PDO
    {
        if ($path === '' || str_contains($path, "\0")) throw new HubWorkspaceContinuityMigrationException('Database path is invalid', 'DATABASE_CONFIG_INVALID');
        try { $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]); $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec('PRAGMA busy_timeout = 2500'); return $pdo; }
        catch (Throwable) { throw new HubWorkspaceContinuityMigrationException('Database is unavailable', 'DATABASE_UNAVAILABLE'); }
    }

    private static function presentTables(PDO $pdo): array { $out = []; foreach (self::TABLES as $table) { $q = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = :name"); $q->execute(['name' => $table]); if ($q->fetchColumn() !== false) $out[] = $table; } return $out; }
    private static function ready(PDO $pdo): bool { foreach (['idx_control_workspace_checkpoints_project', 'idx_control_workspace_checkpoints_device', 'idx_control_workspace_leases_expiry', 'idx_control_workspace_events_project'] as $index) if ($pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = '" . $index . "'")->fetchColumn() === false) return false; return self::presentTables($pdo) === self::TABLES; }
}
