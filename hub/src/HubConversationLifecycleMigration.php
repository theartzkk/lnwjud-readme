<?php

declare(strict_types=1);

require_once __DIR__ . '/HubCloudFirstMigration.php';

final class HubConversationLifecycleMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'MIGRATION_FAILED') { parent::__construct($message); }
}

final class HubConversationLifecycleMigration
{
    public const TARGET_USER_VERSION = 19;
    public const MIGRATION_ID = 'm19-conversation-lifecycle';

    public static function apply(string $databasePath, string $sqlPath, ?string $now = null): string
    {
        $pdo = self::open($databasePath); $sql = @file_get_contents($sqlPath);
        if (!is_string($sql) || $sql === '') throw new HubConversationLifecycleMigrationException('M19 migration is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash('sha256', $sql); $version = (int)$pdo->query('PRAGMA user_version')->fetchColumn();
        if ($version < 18) throw new HubConversationLifecycleMigrationException('M18 authority is unavailable', 'BASE_SCHEMA_INVALID');
        try { HubCloudFirstMigration::assertCapabilityReady($pdo, dirname(__DIR__) . '/migrations/017_cloud_first_control.sql'); }
        catch (Throwable) { throw new HubConversationLifecycleMigrationException('M18 authority is unavailable', 'BASE_SCHEMA_INVALID'); }
        $ledger = self::ledger($pdo);
        if (is_array($ledger)) {
            if ((int)$ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals((string)$ledger['checksum'], $checksum) || $version < self::TARGET_USER_VERSION) throw new HubConversationLifecycleMigrationException('M19 migration record is invalid', 'MIGRATION_RECORD_INVALID');
            self::assertReady($pdo, $checksum); return 'already-applied';
        }
        if ($version > 18 || self::columnPresent($pdo, 'deleted_at') || self::columnPresent($pdo, 'deleted_by_user_id')) throw new HubConversationLifecycleMigrationException('M19 migration order is not provable', 'MIGRATION_ORDER_UNCERTAIN');
        $at = self::timestamp($now ?? gmdate('c'));
        try {
            $pdo->beginTransaction(); $pdo->exec($sql);
            $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id,schema_version,checksum,applied_at) VALUES(:id,19,:checksum,:at)')->execute(['id'=>self::MIGRATION_ID,'checksum'=>$checksum,'at'=>$at]);
            $pdo->exec('PRAGMA user_version = 19'); self::assertReady($pdo, $checksum); $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($error instanceof HubConversationLifecycleMigrationException) throw $error;
            throw new HubConversationLifecycleMigrationException('M19 migration rolled back', 'MIGRATION_ROLLED_BACK');
        }
        return 'applied';
    }

    public static function assertCapabilityReady(PDO $pdo, string $sqlPath): void
    {
        if (!is_file($sqlPath)) throw new HubConversationLifecycleMigrationException('M19 migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash_file('sha256', $sqlPath); if (!is_string($checksum) || $checksum === '') throw new HubConversationLifecycleMigrationException('M19 migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        self::assertReady($pdo, $checksum);
    }

    private static function assertReady(PDO $pdo, string $checksum): void
    {
        $ledger = self::ledger($pdo); $index = $pdo->query("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_control_conversations_deleted'")->fetchColumn();
        if ((int)$pdo->query('PRAGMA user_version')->fetchColumn() < self::TARGET_USER_VERSION || !is_array($ledger) || (int)$ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals(strtolower($checksum), strtolower((string)($ledger['checksum'] ?? ''))) || !self::columnPresent($pdo, 'deleted_at') || !self::columnPresent($pdo, 'deleted_by_user_id') || $index === false || $pdo->query('PRAGMA foreign_key_check')->fetchAll() !== []) throw new HubConversationLifecycleMigrationException('M19 conversation lifecycle is not ready', 'CONVERSATION_LIFECYCLE_SCHEMA_NOT_READY');
    }

    private static function columnPresent(PDO $pdo, string $name): bool { foreach ($pdo->query("PRAGMA table_info('control_conversations')")->fetchAll() as $row) if (($row['name'] ?? null) === $name) return true; return false; }
    private static function ledger(PDO $pdo): array|false { $q=$pdo->prepare('SELECT schema_version,checksum FROM awh_schema_migrations WHERE migration_id=:id'); $q->execute(['id'=>self::MIGRATION_ID]); return $q->fetch(); }
    private static function open(string $path): PDO { if ($path===''||str_contains($path,"\0")) throw new HubConversationLifecycleMigrationException('Database path is invalid','DATABASE_CONFIG_INVALID'); try{$pdo=new PDO('sqlite:'.$path,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);$pdo->exec('PRAGMA foreign_keys = ON');$pdo->exec('PRAGMA busy_timeout = 2500');return $pdo;}catch(Throwable){throw new HubConversationLifecycleMigrationException('Database is unavailable','DATABASE_UNAVAILABLE');} }
    private static function timestamp(string $value): string { if(strtotime($value)===false) throw new HubConversationLifecycleMigrationException('M19 migration time is invalid','MIGRATION_FAILED');return gmdate('c',strtotime($value)); }
}
