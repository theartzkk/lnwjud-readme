<?php

declare(strict_types=1);

require_once __DIR__ . '/HubUnifiedWorkspaceMigration.php';

/**
 * Final product capability layer.  It is additive to M8: the existing project,
 * task, work-stream, owner-auth and workspace-continuity tables remain the
 * authorities.  This migration only adds access policy, attachment metadata and
 * provider-accounting projections.
 */
final class HubFinalProductMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'MIGRATION_FAILED') { parent::__construct($message); }
}

final class HubFinalProductMigration
{
    public const TARGET_USER_VERSION = 9;
    public const MIGRATION_ID = 'm9-final-product';
    private const TABLES = ['control_provider_policies', 'control_provider_usage', 'control_user_profiles', 'control_project_capabilities', 'control_user_invitations'];
    private const ATTACHMENT_COLUMNS = ['storage_key', 'mime_type', 'size_bytes', 'uploaded_by_user_id', 'uploaded_at', 'deleted_at'];
    private const INDEXES = ['idx_control_conversation_attachments_storage', 'idx_control_conversation_attachments_message', 'idx_control_conversation_attachments_access', 'idx_control_provider_usage_month', 'idx_control_provider_usage_project', 'idx_control_user_profiles_status', 'idx_control_project_capabilities_lookup', 'idx_control_user_invitations_active'];

    public static function apply(string $databasePath, string $sqlPath, ?string $now = null): string
    {
        $pdo = self::open($databasePath);
        $sql = @file_get_contents($sqlPath);
        if (!is_string($sql) || $sql === '') throw new HubFinalProductMigrationException('Final product migration is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash('sha256', $sql); $version = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
        if ($version < 8) throw new HubFinalProductMigrationException('M8 unified workspace authority is unavailable', 'BASE_SCHEMA_INVALID');
        try { HubUnifiedWorkspaceMigration::assertCapabilityReady($pdo, dirname(__DIR__) . '/migrations/007_unified_workspace.sql'); }
        catch (Throwable) { throw new HubFinalProductMigrationException('M8 unified workspace authority is unavailable', 'BASE_SCHEMA_INVALID'); }
        $q = $pdo->prepare('SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = :id'); $q->execute(['id' => self::MIGRATION_ID]); $ledger = $q->fetch();
        if (is_array($ledger)) {
            if ((int) $ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals((string) $ledger['checksum'], $checksum) || $version < self::TARGET_USER_VERSION || !self::ready($pdo)) throw new HubFinalProductMigrationException('Final product migration record is invalid', 'MIGRATION_RECORD_INVALID');
            return 'already-applied';
        }
        if ($version > 8 || self::presentTables($pdo) !== [] || self::missingAttachmentColumns($pdo) !== self::ATTACHMENT_COLUMNS) throw new HubFinalProductMigrationException('Final product migration order is not provable', 'MIGRATION_ORDER_UNCERTAIN');
        $now ??= gmdate('c');
        try {
            $pdo->beginTransaction(); $pdo->exec($sql);
            $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id, schema_version, checksum, applied_at) VALUES(:id, :version, :checksum, :at)')->execute(['id' => self::MIGRATION_ID, 'version' => self::TARGET_USER_VERSION, 'checksum' => $checksum, 'at' => $now]);
            $pdo->exec('PRAGMA user_version = 9'); self::assertReady($pdo, $checksum); $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($error instanceof HubFinalProductMigrationException) throw $error;
            throw new HubFinalProductMigrationException('Final product migration rolled back', 'MIGRATION_ROLLED_BACK');
        }
        return 'applied';
    }

    public static function assertCapabilityReady(PDO $pdo, string $sqlPath): void
    {
        if (!is_file($sqlPath)) throw new HubFinalProductMigrationException('Final product migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        self::assertReady($pdo, hash_file('sha256', $sqlPath));
    }

    private static function assertReady(PDO $pdo, string $checksum): void
    {
        $q = $pdo->prepare('SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = :id'); $q->execute(['id' => self::MIGRATION_ID]); $ledger = $q->fetch();
        if ((int) $pdo->query('PRAGMA user_version')->fetchColumn() < self::TARGET_USER_VERSION || !is_array($ledger) || (int) $ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals(strtolower($checksum), strtolower((string) ($ledger['checksum'] ?? ''))) || !self::ready($pdo) || $pdo->query('PRAGMA foreign_key_check')->fetchAll() !== []) throw new HubFinalProductMigrationException('Final product capability is not ready', 'FINAL_PRODUCT_SCHEMA_NOT_READY');
    }

    private static function open(string $path): PDO
    {
        if ($path === '' || str_contains($path, "\0")) throw new HubFinalProductMigrationException('Database path is invalid', 'DATABASE_CONFIG_INVALID');
        try { $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]); $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec('PRAGMA busy_timeout = 2500'); return $pdo; }
        catch (Throwable) { throw new HubFinalProductMigrationException('Database is unavailable', 'DATABASE_UNAVAILABLE'); }
    }

    private static function presentTables(PDO $pdo): array { $out = []; foreach (self::TABLES as $table) if ($pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '" . $table . "'")->fetchColumn() !== false) $out[] = $table; return $out; }
    private static function missingAttachmentColumns(PDO $pdo): array { $columns = array_column($pdo->query('PRAGMA table_info(control_conversation_attachments)')->fetchAll(), 'name'); return array_values(array_diff(self::ATTACHMENT_COLUMNS, $columns)); }
    private static function ready(PDO $pdo): bool { foreach (self::INDEXES as $index) if ($pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = '" . $index . "'")->fetchColumn() === false) return false; return self::presentTables($pdo) === self::TABLES && self::missingAttachmentColumns($pdo) === []; }
}
