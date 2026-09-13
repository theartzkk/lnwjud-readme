<?php

declare(strict_types=1);

require_once __DIR__ . '/HubProjectSourceAuthorityMigration.php';

final class HubVaultSourceAuthorityMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'MIGRATION_FAILED') { parent::__construct($message); }
}

/** M21 promotes AWH Project Vault from immutable cache to optional canonical source authority. */
final class HubVaultSourceAuthorityMigration
{
    public const TARGET_USER_VERSION = 21;
    public const MIGRATION_ID = 'm21-vault-source-authority';
    private const REQUIRED_COLUMNS = ['canonical_source_authority', 'canonical_source_content_sha256'];

    public static function apply(string $databasePath, string $sqlPath, ?string $now = null): string
    {
        $pdo = self::open($databasePath);
        $sql = @file_get_contents($sqlPath);
        if (!is_string($sql) || $sql === '') throw new HubVaultSourceAuthorityMigrationException('M21 migration is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash('sha256', $sql);
        $version = (int)$pdo->query('PRAGMA user_version')->fetchColumn();
        if ($version < 20) throw new HubVaultSourceAuthorityMigrationException('M20 Project Source Authority is unavailable', 'BASE_SCHEMA_INVALID');
        try { HubProjectSourceAuthorityMigration::assertCapabilityReady($pdo, dirname(__DIR__) . '/migrations/019_project_source_authority.sql'); }
        catch (Throwable) { throw new HubVaultSourceAuthorityMigrationException('M20 Project Source Authority is unavailable', 'BASE_SCHEMA_INVALID'); }

        $ledger = self::ledger($pdo);
        if (is_array($ledger)) {
            if ((int)$ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals((string)$ledger['checksum'], $checksum) || $version < self::TARGET_USER_VERSION) throw new HubVaultSourceAuthorityMigrationException('M21 migration record is invalid', 'MIGRATION_RECORD_INVALID');
            self::assertReady($pdo, $checksum);
            return 'already-applied';
        }
        if ($version !== 20) throw new HubVaultSourceAuthorityMigrationException('M21 migration order is not provable', 'MIGRATION_ORDER_UNCERTAIN');
        $existing = array_column($pdo->query('PRAGMA table_info(projects)')->fetchAll(), 'name');
        foreach (self::REQUIRED_COLUMNS as $column) if (in_array($column, $existing, true)) throw new HubVaultSourceAuthorityMigrationException('M21 migration order is not provable', 'MIGRATION_ORDER_UNCERTAIN');

        $at = self::timestamp($now ?? gmdate('c'));
        try {
            $pdo->beginTransaction();
            $pdo->exec($sql);
            $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id,schema_version,checksum,applied_at) VALUES(:id,21,:checksum,:at)')->execute(['id'=>self::MIGRATION_ID,'checksum'=>$checksum,'at'=>$at]);
            $pdo->exec('PRAGMA user_version = 21');
            self::assertReady($pdo, $checksum);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($error instanceof HubVaultSourceAuthorityMigrationException) throw $error;
            throw new HubVaultSourceAuthorityMigrationException('M21 migration rolled back', 'MIGRATION_ROLLED_BACK');
        }
        return 'applied';
    }

    public static function assertCapabilityReady(PDO $pdo, string $sqlPath): void
    {
        if (!is_file($sqlPath)) throw new HubVaultSourceAuthorityMigrationException('M21 migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash_file('sha256', $sqlPath);
        if (!is_string($checksum) || $checksum === '') throw new HubVaultSourceAuthorityMigrationException('M21 migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        self::assertReady($pdo, $checksum);
    }

    private static function assertReady(PDO $pdo, string $checksum): void
    {
        $ledger = self::ledger($pdo);
        $columns = array_column($pdo->query('PRAGMA table_info(projects)')->fetchAll(), 'name');
        foreach (self::REQUIRED_COLUMNS as $column) if (!in_array($column, $columns, true)) throw new HubVaultSourceAuthorityMigrationException('M21 Vault source authority is not ready', 'VAULT_SOURCE_SCHEMA_NOT_READY');
        if ((int)$pdo->query('PRAGMA user_version')->fetchColumn() < self::TARGET_USER_VERSION
            || !is_array($ledger) || (int)$ledger['schema_version'] !== self::TARGET_USER_VERSION
            || !hash_equals(strtolower($checksum), strtolower((string)($ledger['checksum'] ?? '')))
            || $pdo->query('PRAGMA foreign_key_check')->fetchAll() !== []) {
            throw new HubVaultSourceAuthorityMigrationException('M21 Vault source authority is not ready', 'VAULT_SOURCE_SCHEMA_NOT_READY');
        }
    }

    private static function ledger(PDO $pdo): array|false
    {
        $q=$pdo->prepare('SELECT schema_version,checksum FROM awh_schema_migrations WHERE migration_id=:id');
        $q->execute(['id'=>self::MIGRATION_ID]);
        return $q->fetch();
    }

    private static function open(string $path): PDO
    {
        if ($path === '' || str_contains($path, "\0")) throw new HubVaultSourceAuthorityMigrationException('Database path is invalid','DATABASE_CONFIG_INVALID');
        try {
            $pdo=new PDO('sqlite:'.$path,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
            $pdo->exec('PRAGMA foreign_keys = ON');
            $pdo->exec('PRAGMA busy_timeout = 2500');
            return $pdo;
        } catch (Throwable) { throw new HubVaultSourceAuthorityMigrationException('Database is unavailable','DATABASE_UNAVAILABLE'); }
    }

    private static function timestamp(string $value): string
    {
        if (strtotime($value)===false) throw new HubVaultSourceAuthorityMigrationException('M21 migration time is invalid','MIGRATION_FAILED');
        return gmdate('c',strtotime($value));
    }
}
