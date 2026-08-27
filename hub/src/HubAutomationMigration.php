<?php

declare(strict_types=1);

require_once __DIR__ . '/HubCostAwareAiMigration.php';

final class HubAutomationMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'MIGRATION_FAILED') { parent::__construct($message); }
}

/** M15 stores automation definitions only; canonical work still materializes through control_tasks. */
final class HubAutomationMigration
{
    public const TARGET_USER_VERSION = 15;
    public const MIGRATION_ID = 'm15-automation-registry';
    private const TABLE = 'control_automations';
    private const INDEXES = [
        'idx_control_automations_user_active',
        'idx_control_automations_project',
        'idx_control_automations_conversation',
    ];

    public static function apply(string $databasePath, string $sqlPath, ?string $now = null): string
    {
        $pdo = self::open($databasePath);
        $sql = @file_get_contents($sqlPath);
        if (!is_string($sql) || $sql === '') throw new HubAutomationMigrationException('Automation migration is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash('sha256', $sql);
        $version = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
        if ($version < 14) throw new HubAutomationMigrationException('M14 Cost-Aware AI is unavailable', 'BASE_SCHEMA_INVALID');
        try { HubCostAwareAiMigration::assertCapabilityReady($pdo, dirname(__DIR__) . '/migrations/013_cost_aware_ai.sql'); }
        catch (Throwable) { throw new HubAutomationMigrationException('M14 Cost-Aware AI is unavailable', 'BASE_SCHEMA_INVALID'); }

        $q = $pdo->prepare('SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id=:id');
        $q->execute(['id' => self::MIGRATION_ID]);
        $ledger = $q->fetch();
        if (is_array($ledger)) {
            if ((int) $ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals((string) $ledger['checksum'], $checksum) || $version < self::TARGET_USER_VERSION) {
                throw new HubAutomationMigrationException('Automation migration record is invalid', 'MIGRATION_RECORD_INVALID');
            }
            self::assertReady($pdo, $checksum);
            return 'already-applied';
        }
        if ($version > 14 || self::tablePresent($pdo, self::TABLE)) throw new HubAutomationMigrationException('Automation migration order is not provable', 'MIGRATION_ORDER_UNCERTAIN');

        $at = self::timestamp($now ?? gmdate('c'));
        try {
            $pdo->beginTransaction();
            $pdo->exec($sql);
            $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id,schema_version,checksum,applied_at) VALUES(:id,15,:checksum,:at)')
                ->execute(['id' => self::MIGRATION_ID, 'checksum' => $checksum, 'at' => $at]);
            $pdo->exec('PRAGMA user_version = 15');
            self::assertReady($pdo, $checksum);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($error instanceof HubAutomationMigrationException) throw $error;
            throw new HubAutomationMigrationException('Automation migration rolled back', 'MIGRATION_ROLLED_BACK');
        }
        return 'applied';
    }

    public static function assertCapabilityReady(PDO $pdo, string $sqlPath): void
    {
        if (!is_file($sqlPath)) throw new HubAutomationMigrationException('Automation migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash_file('sha256', $sqlPath);
        if (!is_string($checksum) || $checksum === '') throw new HubAutomationMigrationException('Automation migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        self::assertReady($pdo, $checksum);
    }

    private static function assertReady(PDO $pdo, string $checksum): void
    {
        $q = $pdo->prepare('SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id=:id');
        $q->execute(['id' => self::MIGRATION_ID]);
        $ledger = $q->fetch();
        $indexes = 0;
        foreach (self::INDEXES as $index) {
            $check = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=:name");
            $check->execute(['name' => $index]);
            if ($check->fetchColumn() !== false) $indexes += 1;
        }
        $columns = self::tablePresent($pdo, self::TABLE) ? array_column($pdo->query("PRAGMA table_info('control_automations')")->fetchAll(), 'name') : [];
        $required = ['automation_id','user_id','project_id','conversation_id','name','goal','timing_mode','schedule_ical','condition_key','condition_description','enabled','created_at','updated_at','archived_at'];
        if ((int) $pdo->query('PRAGMA user_version')->fetchColumn() < self::TARGET_USER_VERSION
            || !is_array($ledger)
            || (int) $ledger['schema_version'] !== self::TARGET_USER_VERSION
            || !hash_equals(strtolower($checksum), strtolower((string) ($ledger['checksum'] ?? '')))
            || !self::tablePresent($pdo, self::TABLE)
            || array_diff($required, $columns) !== []
            || $indexes !== count(self::INDEXES)
            || $pdo->query('PRAGMA foreign_key_check')->fetchAll() !== []) {
            throw new HubAutomationMigrationException('Automation registry capability is not ready', 'AUTOMATION_SCHEMA_NOT_READY');
        }
    }

    private static function tablePresent(PDO $pdo, string $table): bool
    {
        $q = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name");
        $q->execute(['name' => $table]);
        return $q->fetchColumn() !== false;
    }

    private static function open(string $path): PDO
    {
        if ($path === '' || str_contains($path, "\0")) throw new HubAutomationMigrationException('Database path is invalid', 'DATABASE_CONFIG_INVALID');
        try {
            $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
            $pdo->exec('PRAGMA foreign_keys = ON');
            $pdo->exec('PRAGMA busy_timeout = 2500');
            return $pdo;
        } catch (Throwable) {
            throw new HubAutomationMigrationException('Database is unavailable', 'DATABASE_UNAVAILABLE');
        }
    }

    private static function timestamp(string $value): string
    {
        if (strtotime($value) === false) throw new HubAutomationMigrationException('Automation migration time is invalid', 'MIGRATION_FAILED');
        return gmdate('c', strtotime($value));
    }
}
