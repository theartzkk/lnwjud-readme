<?php

declare(strict_types=1);

require_once __DIR__ . '/HubAutomationMigration.php';

final class HubSelfSufficientAiMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'MIGRATION_FAILED') { parent::__construct($message); }
}

/** M16 adds provider/model governance evidence without replacing M15 authorities. */
final class HubSelfSufficientAiMigration
{
    public const TARGET_USER_VERSION = 16;
    public const MIGRATION_ID = 'm16-self-sufficient-ai';
    private const TABLES = [
        'control_ai_provider_profiles',
        'control_ai_models',
        'control_ai_model_qualifications',
        'control_ai_model_health',
        'control_ai_route_decisions',
        'control_ai_outcomes',
        'control_ai_budget_policies',
    ];
    private const INDEXES = [
        'idx_control_ai_models_route',
        'idx_control_ai_qualifications_lookup',
        'idx_control_ai_routes_execution',
        'idx_control_ai_routes_cost',
        'idx_control_ai_outcomes_execution',
        'idx_control_ai_budget_scope',
    ];

    public static function apply(string $databasePath, string $sqlPath, ?string $now = null): string
    {
        $pdo = self::open($databasePath);
        $sql = @file_get_contents($sqlPath);
        if (!is_string($sql) || $sql === '') throw new HubSelfSufficientAiMigrationException('M16 migration is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash('sha256', $sql);
        $version = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
        if ($version < 15) throw new HubSelfSufficientAiMigrationException('M15 Automation is unavailable', 'BASE_SCHEMA_INVALID');
        try { HubAutomationMigration::assertCapabilityReady($pdo, dirname(__DIR__) . '/migrations/014_automations.sql'); }
        catch (Throwable) { throw new HubSelfSufficientAiMigrationException('M15 Automation is unavailable', 'BASE_SCHEMA_INVALID'); }
        $ledger = self::ledger($pdo);
        if (is_array($ledger)) {
            if ((int)$ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals((string)$ledger['checksum'], $checksum) || $version < self::TARGET_USER_VERSION) throw new HubSelfSufficientAiMigrationException('M16 migration record is invalid', 'MIGRATION_RECORD_INVALID');
            self::assertReady($pdo, $checksum); return 'already-applied';
        }
        if ($version > 15) throw new HubSelfSufficientAiMigrationException('M16 migration order is not provable', 'MIGRATION_ORDER_UNCERTAIN');
        foreach (self::TABLES as $table) if (self::tablePresent($pdo, $table)) throw new HubSelfSufficientAiMigrationException('M16 migration order is not provable', 'MIGRATION_ORDER_UNCERTAIN');
        $at = self::timestamp($now ?? gmdate('c'));
        try {
            $pdo->beginTransaction();
            $pdo->exec($sql);
            $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id,schema_version,checksum,applied_at) VALUES(:id,16,:checksum,:at)')->execute(['id'=>self::MIGRATION_ID,'checksum'=>$checksum,'at'=>$at]);
            $pdo->exec('PRAGMA user_version = 16');
            self::assertReady($pdo, $checksum);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($error instanceof HubSelfSufficientAiMigrationException) throw $error;
            throw new HubSelfSufficientAiMigrationException('M16 migration rolled back', 'MIGRATION_ROLLED_BACK');
        }
        return 'applied';
    }

    public static function assertCapabilityReady(PDO $pdo, string $sqlPath): void
    {
        if (!is_file($sqlPath)) throw new HubSelfSufficientAiMigrationException('M16 migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash_file('sha256', $sqlPath);
        if (!is_string($checksum) || $checksum === '') throw new HubSelfSufficientAiMigrationException('M16 migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        self::assertReady($pdo, $checksum);
    }
    private static function assertReady(PDO $pdo, string $checksum): void
    {
        $ledger = self::ledger($pdo);
        $tables = 0; foreach (self::TABLES as $table) if (self::tablePresent($pdo, $table)) $tables++;
        $indexes = 0; foreach (self::INDEXES as $index) {
            $q = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=:name"); $q->execute(['name'=>$index]); if ($q->fetchColumn() !== false) $indexes++;
        }
        $openAiProfile = self::tablePresent($pdo, 'control_ai_provider_profiles')
            ? (int)$pdo->query("SELECT COUNT(*) FROM control_ai_provider_profiles WHERE provider_id='openai' AND lifecycle='PRODUCTION'")->fetchColumn() : 0;
        $openAiModels = self::tablePresent($pdo, 'control_ai_models')
            ? (int)$pdo->query("SELECT COUNT(*) FROM control_ai_models WHERE provider_id='openai' AND lifecycle='PRODUCTION' AND enabled=1")->fetchColumn() : 0;
        if ((int)$pdo->query('PRAGMA user_version')->fetchColumn() < 16
            || !is_array($ledger) || (int)$ledger['schema_version'] !== 16
            || !hash_equals(strtolower($checksum), strtolower((string)($ledger['checksum'] ?? '')))
            || $tables !== count(self::TABLES) || $indexes !== count(self::INDEXES)
            || $openAiProfile !== 1 || $openAiModels < 1
            || $pdo->query('PRAGMA foreign_key_check')->fetchAll() !== []) {
            throw new HubSelfSufficientAiMigrationException('M16 AI governance capability is not ready', 'SELF_SUFFICIENT_AI_SCHEMA_NOT_READY');
        }
    }
    /** @return array<string,mixed>|false */
    private static function ledger(PDO $pdo): array|false
    {
        $q = $pdo->prepare('SELECT schema_version,checksum FROM awh_schema_migrations WHERE migration_id=:id');
        $q->execute(['id'=>self::MIGRATION_ID]); return $q->fetch();
    }
    private static function tablePresent(PDO $pdo, string $table): bool
    {
        $q=$pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name"); $q->execute(['name'=>$table]); return $q->fetchColumn() !== false;
    }
    private static function open(string $path): PDO
    {
        if ($path === '' || str_contains($path, "\0")) throw new HubSelfSufficientAiMigrationException('Database path is invalid','DATABASE_CONFIG_INVALID');
        try {
            $pdo=new PDO('sqlite:'.$path,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
            $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec('PRAGMA busy_timeout = 2500'); return $pdo;
        } catch (Throwable) { throw new HubSelfSufficientAiMigrationException('Database is unavailable','DATABASE_UNAVAILABLE'); }
    }
    private static function timestamp(string $value): string
    {
        if (strtotime($value) === false) throw new HubSelfSufficientAiMigrationException('M16 migration time is invalid','MIGRATION_FAILED');
        return gmdate('c', strtotime($value));
    }
}
