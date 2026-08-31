<?php

declare(strict_types=1);

require_once __DIR__ . '/HubAccountHostingMigration.php';

final class HubCloudFirstMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'MIGRATION_FAILED') { parent::__construct($message); }
}

/** M18 adds cloud execution capabilities after canonical M17 Account/Hosting. */
final class HubCloudFirstMigration
{
    public const TARGET_USER_VERSION = 18;
    public const MIGRATION_ID = 'm18-cloud-first-control';
    private const REQUIRED_CAPABILITIES = ['qa.cloud', 'review.visual'];

    public static function apply(string $databasePath, string $sqlPath, ?string $now = null): string
    {
        $pdo = self::open($databasePath);
        $sql = @file_get_contents($sqlPath);
        if (!is_string($sql) || $sql === '') throw new HubCloudFirstMigrationException('M18 migration is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash('sha256', $sql);
        $version = (int)$pdo->query('PRAGMA user_version')->fetchColumn();
        if ($version < 17) throw new HubCloudFirstMigrationException('M17 Account/Hosting authority is unavailable', 'BASE_SCHEMA_INVALID');
        try { HubAccountHostingMigration::assertCapabilityReady($pdo, dirname(__DIR__) . '/migrations/016_account_hosting.sql'); }
        catch (Throwable) { throw new HubCloudFirstMigrationException('M17 Account/Hosting authority is unavailable', 'BASE_SCHEMA_INVALID'); }

        $ledger = self::ledger($pdo);
        if (is_array($ledger)) {
            if ((int)$ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals((string)$ledger['checksum'], $checksum) || $version < self::TARGET_USER_VERSION) throw new HubCloudFirstMigrationException('M18 migration record is invalid', 'MIGRATION_RECORD_INVALID');
            self::assertReady($pdo, $checksum);
            return 'already-applied';
        }
        if ($version > 17) throw new HubCloudFirstMigrationException('M18 migration order is not provable', 'MIGRATION_ORDER_UNCERTAIN');
        foreach (self::REQUIRED_CAPABILITIES as $capability) {
            $q = $pdo->prepare('SELECT 1 FROM control_capability_catalog WHERE capability=:cap');
            $q->execute(['cap' => $capability]);
            if ($q->fetchColumn() !== false) throw new HubCloudFirstMigrationException('M18 migration order is not provable', 'MIGRATION_ORDER_UNCERTAIN');
        }
        $at = self::timestamp($now ?? gmdate('c'));
        try {
            $pdo->beginTransaction();
            $pdo->exec($sql);
            $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id,schema_version,checksum,applied_at) VALUES(:id,18,:checksum,:at)')->execute(['id'=>self::MIGRATION_ID,'checksum'=>$checksum,'at'=>$at]);
            $pdo->exec('PRAGMA user_version = 18');
            self::assertReady($pdo, $checksum);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($error instanceof HubCloudFirstMigrationException) throw $error;
            throw new HubCloudFirstMigrationException('M18 migration rolled back', 'MIGRATION_ROLLED_BACK');
        }
        return 'applied';
    }

    public static function assertCapabilityReady(PDO $pdo, string $sqlPath): void
    {
        if (!is_file($sqlPath)) throw new HubCloudFirstMigrationException('M18 migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash_file('sha256', $sqlPath);
        if (!is_string($checksum) || $checksum === '') throw new HubCloudFirstMigrationException('M18 migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        self::assertReady($pdo, $checksum);
    }

    private static function assertReady(PDO $pdo, string $checksum): void
    {
        $ledger = self::ledger($pdo);
        $ready = 0;
        foreach (self::REQUIRED_CAPABILITIES as $capability) {
            $q = $pdo->prepare("SELECT 1 FROM control_capability_catalog WHERE capability=:cap AND source_id='awh-core' AND maturity='AVAILABLE' AND enabled=1");
            $q->execute(['cap' => $capability]);
            if ($q->fetchColumn() !== false) $ready++;
        }
        if ((int)$pdo->query('PRAGMA user_version')->fetchColumn() < self::TARGET_USER_VERSION
            || !is_array($ledger) || (int)$ledger['schema_version'] !== self::TARGET_USER_VERSION
            || !hash_equals(strtolower($checksum), strtolower((string)($ledger['checksum'] ?? '')))
            || $ready !== count(self::REQUIRED_CAPABILITIES)
            || $pdo->query('PRAGMA foreign_key_check')->fetchAll() !== []) {
            throw new HubCloudFirstMigrationException('M18 cloud-first capability is not ready', 'CLOUD_FIRST_SCHEMA_NOT_READY');
        }
    }

    /** @return array<string,mixed>|false */
    private static function ledger(PDO $pdo): array|false
    {
        $q = $pdo->prepare('SELECT schema_version,checksum FROM awh_schema_migrations WHERE migration_id=:id');
        $q->execute(['id'=>self::MIGRATION_ID]);
        return $q->fetch();
    }

    private static function open(string $path): PDO
    {
        if ($path === '' || str_contains($path, "\0")) throw new HubCloudFirstMigrationException('Database path is invalid','DATABASE_CONFIG_INVALID');
        try {
            $pdo = new PDO('sqlite:'.$path,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
            $pdo->exec('PRAGMA foreign_keys = ON');
            $pdo->exec('PRAGMA busy_timeout = 2500');
            return $pdo;
        } catch (Throwable) {
            throw new HubCloudFirstMigrationException('Database is unavailable','DATABASE_UNAVAILABLE');
        }
    }

    private static function timestamp(string $value): string
    {
        if (strtotime($value) === false) throw new HubCloudFirstMigrationException('M18 migration time is invalid','MIGRATION_FAILED');
        return gmdate('c', strtotime($value));
    }
}
