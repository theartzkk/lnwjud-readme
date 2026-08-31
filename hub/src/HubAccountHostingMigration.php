<?php

declare(strict_types=1);

require_once __DIR__ . '/HubSelfSufficientAiMigration.php';

final class HubAccountHostingMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'MIGRATION_FAILED') { parent::__construct($message); }
}

final class HubAccountHostingMigration
{
    public const TARGET_USER_VERSION = 17;
    public const MIGRATION_ID = 'm17-account-hosting';
    private const TABLES = ['control_account_requests','control_managed_sites','control_site_bindings','control_site_releases','control_site_database_bindings','control_site_events'];
    private const INDEXES = ['idx_control_user_profiles_email','idx_control_account_requests_state','idx_control_account_requests_pending_username','idx_control_managed_sites_project','idx_control_managed_sites_state','idx_control_site_bindings_primary','idx_control_site_bindings_host','idx_control_site_releases_active','idx_control_site_releases_recent','idx_control_site_events_recent'];

    public static function apply(string $databasePath, string $sqlPath, ?string $now = null): string
    {
        $pdo = self::open($databasePath); $sql = @file_get_contents($sqlPath);
        if (!is_string($sql) || $sql === '') throw new HubAccountHostingMigrationException('M17 migration is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash('sha256', $sql); $version = (int)$pdo->query('PRAGMA user_version')->fetchColumn();
        if ($version < 16) throw new HubAccountHostingMigrationException('M16 authority is unavailable', 'BASE_SCHEMA_INVALID');
        try { HubSelfSufficientAiMigration::assertCapabilityReady($pdo, dirname(__DIR__) . '/migrations/015_self_sufficient_ai.sql'); }
        catch (Throwable) { throw new HubAccountHostingMigrationException('M16 authority is unavailable', 'BASE_SCHEMA_INVALID'); }
        $ledger = self::ledger($pdo);
        if (is_array($ledger)) {
            if ((int)$ledger['schema_version'] !== 17 || !hash_equals((string)$ledger['checksum'], $checksum) || $version < 17) throw new HubAccountHostingMigrationException('M17 migration record is invalid', 'MIGRATION_RECORD_INVALID');
            self::assertReady($pdo, $checksum); return 'already-applied';
        }
        if ($version > 16) throw new HubAccountHostingMigrationException('M17 migration order is not provable', 'MIGRATION_ORDER_UNCERTAIN');
        foreach (self::TABLES as $table) if (self::tablePresent($pdo, $table)) throw new HubAccountHostingMigrationException('M17 migration order is not provable', 'MIGRATION_ORDER_UNCERTAIN');
        $at = self::timestamp($now ?? gmdate('c'));
        try {
            $pdo->beginTransaction(); $pdo->exec($sql);
            $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id,schema_version,checksum,applied_at) VALUES(:id,17,:checksum,:at)')->execute(['id'=>self::MIGRATION_ID,'checksum'=>$checksum,'at'=>$at]);
            $pdo->exec('PRAGMA user_version = 17'); self::assertReady($pdo, $checksum); $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($error instanceof HubAccountHostingMigrationException) throw $error;
            throw new HubAccountHostingMigrationException('M17 migration rolled back', 'MIGRATION_ROLLED_BACK');
        }
        return 'applied';
    }

    public static function assertCapabilityReady(PDO $pdo, string $sqlPath): void
    {
        if (!is_file($sqlPath)) throw new HubAccountHostingMigrationException('M17 migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash_file('sha256', $sqlPath); if (!is_string($checksum) || $checksum === '') throw new HubAccountHostingMigrationException('M17 migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        self::assertReady($pdo, $checksum);
    }

    private static function assertReady(PDO $pdo, string $checksum): void
    {
        $ledger = self::ledger($pdo);
        foreach (self::TABLES as $table) if (!self::tablePresent($pdo, $table)) throw new HubAccountHostingMigrationException('M17 capability is not ready', 'ACCOUNT_HOSTING_SCHEMA_NOT_READY');
        foreach (self::INDEXES as $index) { $q=$pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=:name"); $q->execute(['name'=>$index]); if ($q->fetchColumn() === false) throw new HubAccountHostingMigrationException('M17 capability is not ready', 'ACCOUNT_HOSTING_SCHEMA_NOT_READY'); }
        $profileSql = (string)$pdo->query("SELECT sql FROM sqlite_master WHERE type='table' AND name='control_user_profiles'")->fetchColumn();
        if ((int)$pdo->query('PRAGMA user_version')->fetchColumn() < 17 || !is_array($ledger) || (int)$ledger['schema_version'] !== 17 || !hash_equals(strtolower($checksum), strtolower((string)($ledger['checksum'] ?? ''))) || !str_contains($profileSql, "'TEACHER'") || $pdo->query('PRAGMA foreign_key_check')->fetchAll() !== []) throw new HubAccountHostingMigrationException('M17 capability is not ready', 'ACCOUNT_HOSTING_SCHEMA_NOT_READY');
    }

    private static function ledger(PDO $pdo): array|false { $q=$pdo->prepare('SELECT schema_version,checksum FROM awh_schema_migrations WHERE migration_id=:id'); $q->execute(['id'=>self::MIGRATION_ID]); return $q->fetch(); }
    private static function tablePresent(PDO $pdo,string $table): bool { $q=$pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name");$q->execute(['name'=>$table]);return $q->fetchColumn()!==false; }
    private static function open(string $path): PDO { if ($path===''||str_contains($path,"\0")) throw new HubAccountHostingMigrationException('Database path is invalid','DATABASE_CONFIG_INVALID'); try{$pdo=new PDO('sqlite:'.$path,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);$pdo->exec('PRAGMA foreign_keys = ON');$pdo->exec('PRAGMA busy_timeout = 2500');return $pdo;}catch(Throwable){throw new HubAccountHostingMigrationException('Database is unavailable','DATABASE_UNAVAILABLE');} }
    private static function timestamp(string $value): string { if(strtotime($value)===false) throw new HubAccountHostingMigrationException('M17 migration time is invalid','MIGRATION_FAILED');return gmdate('c',strtotime($value)); }
}
