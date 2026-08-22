<?php

declare(strict_types=1);

/**
 * M6 adds a durable, ordered conversation view over M4 tasks.  Its readiness
 * is capability/ledger based: later shared-schema migrations are accepted,
 * while a missing or tampered M6 capability always fails closed.
 */
final class HubAssistantWorkstreamMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'MIGRATION_FAILED') { parent::__construct($message); }
}

final class HubAssistantWorkstreamMigration
{
    public const TARGET_USER_VERSION = 6;
    public const MIGRATION_ID = 'm6-assistant-workstream';
    private const TABLES = ['control_conversations', 'control_conversation_messages'];
    private const TASK_COLUMNS = ['conversation_id'];

    public static function apply(string $databasePath, string $sqlPath, ?string $now = null): string
    {
        $pdo = self::open($databasePath);
        $sql = @file_get_contents($sqlPath);
        if (!is_string($sql) || $sql === '') throw new HubAssistantWorkstreamMigrationException('Assistant workstream migration is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash('sha256', $sql);
        $version = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
        if ($version < 5 || $pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'control_tasks'")->fetchColumn() === false) throw new HubAssistantWorkstreamMigrationException('M5 control authority is unavailable', 'BASE_SCHEMA_INVALID');
        $q = $pdo->prepare('SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = :id');
        $q->execute(['id' => self::MIGRATION_ID]); $ledger = $q->fetch();
        if (is_array($ledger)) {
            if ((int) $ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals((string) $ledger['checksum'], $checksum) || $version < self::TARGET_USER_VERSION || !self::ready($pdo)) throw new HubAssistantWorkstreamMigrationException('Assistant workstream migration record is invalid', 'MIGRATION_RECORD_INVALID');
            return 'already-applied';
        }
        if ($version > 5 || self::presentTables($pdo) !== [] || self::missingTaskColumns($pdo) !== self::TASK_COLUMNS) throw new HubAssistantWorkstreamMigrationException('Assistant workstream migration order is not provable', 'MIGRATION_ORDER_UNCERTAIN');
        $now ??= gmdate('c');
        try {
            $pdo->beginTransaction();
            $pdo->exec($sql);
            $insert = $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id, schema_version, checksum, applied_at) VALUES(:id, :version, :checksum, :at)');
            $insert->execute(['id' => self::MIGRATION_ID, 'version' => self::TARGET_USER_VERSION, 'checksum' => $checksum, 'at' => $now]);
            $pdo->exec('PRAGMA user_version = 6');
            self::assertReady($pdo, $checksum);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($error instanceof HubAssistantWorkstreamMigrationException) throw $error;
            throw new HubAssistantWorkstreamMigrationException('Assistant workstream migration rolled back', 'MIGRATION_ROLLED_BACK');
        }
        return 'applied';
    }

    public static function assertCapabilityReady(PDO $pdo, string $sqlPath): void
    {
        if (!is_file($sqlPath)) throw new HubAssistantWorkstreamMigrationException('Assistant workstream migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        self::assertReady($pdo, hash_file('sha256', $sqlPath));
    }

    private static function assertReady(PDO $pdo, string $checksum): void
    {
        $q = $pdo->prepare('SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = :id');
        $q->execute(['id' => self::MIGRATION_ID]); $ledger = $q->fetch();
        if ((int) $pdo->query('PRAGMA user_version')->fetchColumn() < self::TARGET_USER_VERSION || !is_array($ledger) || (int) $ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals(strtolower($checksum), strtolower((string) ($ledger['checksum'] ?? ''))) || !self::ready($pdo) || $pdo->query('PRAGMA foreign_key_check')->fetchAll() !== []) throw new HubAssistantWorkstreamMigrationException('Assistant workstream capability is not ready', 'ASSISTANT_SCHEMA_NOT_READY');
    }

    private static function open(string $path): PDO
    {
        if ($path === '' || str_contains($path, "\0")) throw new HubAssistantWorkstreamMigrationException('Database path is invalid', 'DATABASE_CONFIG_INVALID');
        try { $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]); $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec('PRAGMA busy_timeout = 2500'); return $pdo; }
        catch (Throwable) { throw new HubAssistantWorkstreamMigrationException('Database is unavailable', 'DATABASE_UNAVAILABLE'); }
    }

    private static function presentTables(PDO $pdo): array { $out = []; foreach (self::TABLES as $table) { $q = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = :name"); $q->execute(['name' => $table]); if ($q->fetchColumn() !== false) $out[] = $table; } return $out; }
    private static function missingTaskColumns(PDO $pdo): array { $columns = array_column($pdo->query('PRAGMA table_info(control_tasks)')->fetchAll(), 'name'); return array_values(array_diff(self::TASK_COLUMNS, $columns)); }
    private static function ready(PDO $pdo): bool
    {
        $indexes = ['idx_control_conversations_user_project', 'idx_control_conversation_messages_order', 'idx_control_conversation_messages_idempotency', 'idx_control_conversation_messages_event', 'idx_control_tasks_conversation'];
        foreach ($indexes as $index) if ($pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = '" . $index . "'")->fetchColumn() === false) return false;
        return self::presentTables($pdo) === self::TABLES && self::missingTaskColumns($pdo) === [];
    }
}
