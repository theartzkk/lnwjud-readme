<?php

declare(strict_types=1);

require_once __DIR__ . '/HubWorkspaceContinuityMigration.php';

/**
 * M8 is an additive projection over M4 task/result/approval authorities and
 * M6/M7 durable conversation/continuity state.  Readiness is ledger and
 * capability based so a later shared schema version remains compatible.
 */
final class HubUnifiedWorkspaceMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'MIGRATION_FAILED') { parent::__construct($message); }
}

final class HubUnifiedWorkspaceMigration
{
    public const TARGET_USER_VERSION = 8;
    public const MIGRATION_ID = 'm8-unified-workspace';
    private const TABLES = ['control_project_device_bindings', 'control_project_contexts', 'control_conversation_attachments', 'control_product_settings', 'control_product_setting_revisions'];
    private const CONVERSATION_COLUMNS = ['title', 'archived_at', 'origin'];
    private const INDEXES = ['idx_control_conversations_project_recent', 'idx_control_conversations_title', 'idx_control_project_contexts_active', 'idx_control_project_contexts_recent', 'idx_control_conversation_attachments_recent', 'idx_control_product_setting_revisions_recent'];

    public static function apply(string $databasePath, string $sqlPath, ?string $now = null): string
    {
        $pdo = self::open($databasePath);
        $sql = @file_get_contents($sqlPath);
        if (!is_string($sql) || $sql === '') throw new HubUnifiedWorkspaceMigrationException('Unified workspace migration is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash('sha256', $sql);
        $version = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
        if ($version < 7) throw new HubUnifiedWorkspaceMigrationException('M7 continuity authority is unavailable', 'BASE_SCHEMA_INVALID');
        try { HubWorkspaceContinuityMigration::assertCapabilityReady($pdo, dirname(__DIR__) . '/migrations/006_workspace_continuity.sql'); }
        catch (Throwable) { throw new HubUnifiedWorkspaceMigrationException('M7 continuity authority is unavailable', 'BASE_SCHEMA_INVALID'); }
        $q = $pdo->prepare('SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = :id');
        $q->execute(['id' => self::MIGRATION_ID]); $ledger = $q->fetch();
        if (is_array($ledger)) {
            if ((int) $ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals((string) $ledger['checksum'], $checksum) || $version < self::TARGET_USER_VERSION || !self::ready($pdo)) throw new HubUnifiedWorkspaceMigrationException('Unified workspace migration record is invalid', 'MIGRATION_RECORD_INVALID');
            return 'already-applied';
        }
        if ($version > 7 || self::presentTables($pdo) !== [] || self::missingConversationColumns($pdo) !== self::CONVERSATION_COLUMNS) throw new HubUnifiedWorkspaceMigrationException('Unified workspace migration order is not provable', 'MIGRATION_ORDER_UNCERTAIN');
        $now ??= gmdate('c');
        try {
            $pdo->beginTransaction();
            $pdo->exec($sql);
            $insert = $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id, schema_version, checksum, applied_at) VALUES(:id, :version, :checksum, :at)');
            $insert->execute(['id' => self::MIGRATION_ID, 'version' => self::TARGET_USER_VERSION, 'checksum' => $checksum, 'at' => $now]);
            $pdo->exec('PRAGMA user_version = 8');
            self::assertReady($pdo, $checksum);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($error instanceof HubUnifiedWorkspaceMigrationException) throw $error;
            throw new HubUnifiedWorkspaceMigrationException('Unified workspace migration rolled back', 'MIGRATION_ROLLED_BACK');
        }
        return 'applied';
    }

    public static function assertCapabilityReady(PDO $pdo, string $sqlPath): void
    {
        if (!is_file($sqlPath)) throw new HubUnifiedWorkspaceMigrationException('Unified workspace migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        self::assertReady($pdo, hash_file('sha256', $sqlPath));
    }

    private static function assertReady(PDO $pdo, string $checksum): void
    {
        $q = $pdo->prepare('SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = :id');
        $q->execute(['id' => self::MIGRATION_ID]); $ledger = $q->fetch();
        if ((int) $pdo->query('PRAGMA user_version')->fetchColumn() < self::TARGET_USER_VERSION || !is_array($ledger) || (int) $ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals(strtolower($checksum), strtolower((string) ($ledger['checksum'] ?? ''))) || !self::ready($pdo) || $pdo->query('PRAGMA foreign_key_check')->fetchAll() !== []) throw new HubUnifiedWorkspaceMigrationException('Unified workspace capability is not ready', 'UNIFIED_WORKSPACE_SCHEMA_NOT_READY');
    }

    private static function open(string $path): PDO
    {
        if ($path === '' || str_contains($path, "\0")) throw new HubUnifiedWorkspaceMigrationException('Database path is invalid', 'DATABASE_CONFIG_INVALID');
        try { $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]); $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec('PRAGMA busy_timeout = 2500'); return $pdo; }
        catch (Throwable) { throw new HubUnifiedWorkspaceMigrationException('Database is unavailable', 'DATABASE_UNAVAILABLE'); }
    }

    private static function presentTables(PDO $pdo): array { $out = []; foreach (self::TABLES as $table) if ($pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '" . $table . "'")->fetchColumn() !== false) $out[] = $table; return $out; }
    private static function missingConversationColumns(PDO $pdo): array { $columns = array_column($pdo->query('PRAGMA table_info(control_conversations)')->fetchAll(), 'name'); return array_values(array_diff(self::CONVERSATION_COLUMNS, $columns)); }
    private static function ready(PDO $pdo): bool
    {
        foreach (self::INDEXES as $index) if ($pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = '" . $index . "'")->fetchColumn() === false) return false;
        return self::presentTables($pdo) === self::TABLES && self::missingConversationColumns($pdo) === [] && $pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_control_conversations_user_project'")->fetchColumn() === false;
    }
}
