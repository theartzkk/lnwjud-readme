<?php

declare(strict_types=1);

final class HubSchemaMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'MIGRATION_FAILED')
    {
        parent::__construct($message);
    }
}

final class HubSchemaMigration
{
    public const MIGRATION_ID = 'm3e.1-enrollment';
    public const TARGET_USER_VERSION = 2;
    private const BASE_USER_VERSION = 0;
    private const BASE_TABLES = ['projects', 'project_memory', 'devices', 'builds', 'releases'];
    private const ENROLLMENT_TABLES = ['hub_users', 'owner_bootstrap', 'device_enrollments', 'user_project_memberships', 'pairing_codes', 'pairing_projects', 'device_tokens', 'device_project_memberships'];

    public static function apply(string $databasePath, string $migrationSqlPath, ?string $now = null, bool $failAfterDdlForTest = false, ?string $emptyBaseSchemaPath = null): string
    {
        $pdo = self::open($databasePath);
        $empty = self::isEmptyDatabase($pdo);
        if (!$empty) self::preflight($pdo);
        $checksum = hash_file('sha256', $migrationSqlPath);
        $sql = @file_get_contents($migrationSqlPath);
        if (!is_string($checksum) || !is_string($sql) || $sql === '') throw new HubSchemaMigrationException('Migration file is unavailable', 'MIGRATION_FILE_INVALID');
        $userVersion = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
        if ($userVersion !== self::BASE_USER_VERSION && $userVersion !== self::TARGET_USER_VERSION) throw new HubSchemaMigrationException('SQLite schema version is not supported', 'SCHEMA_VERSION_MISMATCH');
        if ($empty) {
            if (!is_string($emptyBaseSchemaPath) || $emptyBaseSchemaPath === '') throw new HubSchemaMigrationException('Empty database requires an explicit baseline bootstrap path', 'BASE_SCHEMA_REQUIRED');
        }
        $applied = null;
        if (self::tableExists($pdo, 'awh_schema_migrations')) {
            self::ensureLedger($pdo);
            $row = $pdo->prepare('SELECT migration_id, schema_version, checksum FROM awh_schema_migrations WHERE migration_id = :id');
            $row->execute(['id' => self::MIGRATION_ID]);
            $applied = $row->fetch();
        }
        if (is_array($applied)) {
            if ((int) $applied['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals((string) $applied['checksum'], $checksum) || !self::enrollmentSchemaPresent($pdo)) throw new HubSchemaMigrationException('Applied migration record does not match the schema', 'MIGRATION_RECORD_INVALID');
            self::verify($pdo);
            return 'already-applied';
        }
        $present = array_values(array_filter(self::ENROLLMENT_TABLES, fn (string $table): bool => self::tableExists($pdo, $table)));
        if ($userVersion === self::TARGET_USER_VERSION || ($present !== [] && count($present) !== count(self::ENROLLMENT_TABLES))) throw new HubSchemaMigrationException('Partial or untracked M3E schema detected; recovery review is required', 'MIGRATION_PARTIAL');
        $now = $now ?? gmdate('c');
        if (strtotime($now) === false) throw new HubSchemaMigrationException('Migration timestamp is invalid', 'MIGRATION_TIME_INVALID');
        try {
            $pdo->beginTransaction();
            if ($empty) {
                $base = @file_get_contents($emptyBaseSchemaPath);
                if (!is_string($base) || $base === '') throw new RuntimeException('baseline unavailable');
                $pdo->exec($base);
            }
            $pdo->exec($sql);
            if ($failAfterDdlForTest) throw new RuntimeException('test interruption');
            if (!self::enrollmentSchemaPresent($pdo)) throw new RuntimeException('schema verification failed');
            self::ensureLedger($pdo);
            $insert = $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id, schema_version, checksum, applied_at) VALUES(:id, :version, :checksum, :at)');
            $insert->execute(['id' => self::MIGRATION_ID, 'version' => self::TARGET_USER_VERSION, 'checksum' => $checksum, 'at' => $now]);
            $pdo->exec('PRAGMA user_version = ' . self::TARGET_USER_VERSION);
            self::verify($pdo);
            $pdo->commit();
        } catch (HubSchemaMigrationException $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        } catch (Throwable) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw new HubSchemaMigrationException('M3E migration rolled back and requires review', 'MIGRATION_ROLLED_BACK');
        }
        return 'applied';
    }

    public static function verifyDatabase(string $databasePath): void
    {
        $pdo = self::open($databasePath);
        self::preflight($pdo);
        $row = $pdo->query("SELECT schema_version FROM awh_schema_migrations WHERE migration_id = '" . self::MIGRATION_ID . "'")->fetch();
        if (!is_array($row) || (int) $row['schema_version'] !== self::TARGET_USER_VERSION) throw new HubSchemaMigrationException('M3E migration is not recorded', 'MIGRATION_NOT_APPLIED');
        self::verify($pdo);
    }

    private static function open(string $path): PDO
    {
        if ($path === '' || str_contains($path, "\0")) throw new HubSchemaMigrationException('Database path is invalid', 'DATABASE_CONFIG_INVALID');
        try {
            $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
            $pdo->exec('PRAGMA foreign_keys = ON');
            if ((int) $pdo->query('PRAGMA foreign_keys')->fetchColumn() !== 1) throw new RuntimeException('foreign keys disabled');
            return $pdo;
        } catch (HubSchemaMigrationException $error) {
            throw $error;
        } catch (Throwable) {
            throw new HubSchemaMigrationException('Database cannot be opened safely', 'DATABASE_UNAVAILABLE');
        }
    }

    private static function preflight(PDO $pdo): void
    {
        foreach (self::BASE_TABLES as $table) if (!self::tableExists($pdo, $table)) throw new HubSchemaMigrationException('M3D base schema is incomplete', 'BASE_SCHEMA_INVALID');
        if ((int) $pdo->query('PRAGMA foreign_keys')->fetchColumn() !== 1) throw new HubSchemaMigrationException('Foreign keys are not enabled', 'FOREIGN_KEYS_DISABLED');
    }

    private static function isEmptyDatabase(PDO $pdo): bool
    {
        return (int) $pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type IN ('table', 'index', 'trigger', 'view') AND name NOT LIKE 'sqlite_%'")->fetchColumn() === 0;
    }

    private static function ensureLedger(PDO $pdo): void
    {
        $pdo->exec('CREATE TABLE IF NOT EXISTS awh_schema_migrations (migration_id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)');
        $columns = array_column($pdo->query('PRAGMA table_info(awh_schema_migrations)')->fetchAll(), 'name');
        if (array_diff(['migration_id', 'schema_version', 'checksum', 'applied_at'], $columns) !== []) throw new HubSchemaMigrationException('Migration ledger schema is invalid', 'LEDGER_INVALID');
    }

    private static function enrollmentSchemaPresent(PDO $pdo): bool
    {
        foreach (self::ENROLLMENT_TABLES as $table) if (!self::tableExists($pdo, $table)) return false;
        return self::indexExists($pdo, 'idx_device_tokens_device') && self::indexExists($pdo, 'idx_device_memberships_project') && self::indexExists($pdo, 'idx_user_memberships_project');
    }

    private static function verify(PDO $pdo): void
    {
        if (!self::enrollmentSchemaPresent($pdo)) throw new HubSchemaMigrationException('M3E tables or indexes are incomplete', 'SCHEMA_VERIFY_FAILED');
        $expected = [
            'owner_bootstrap' => ['singleton_id', 'owner_user_id', 'initialized_at', 'bootstrap_closed'],
            'pairing_codes' => ['pairing_code_id', 'user_id', 'code_hash', 'issued_at', 'expires_at', 'consumed_at', 'revoked_at'],
            'device_tokens' => ['token_id', 'user_id', 'device_id', 'token_hash', 'created_at', 'expires_at', 'revoked_at', 'last_used_at', 'rotated_from_token_id', 'replaced_by_token_id'],
        ];
        foreach ($expected as $table => $columns) {
            $actual = array_column($pdo->query('PRAGMA table_info(' . $table . ')')->fetchAll(), 'name');
            if (array_diff($columns, $actual) !== []) throw new HubSchemaMigrationException('Required enrollment columns are missing', 'SCHEMA_VERIFY_FAILED');
        }
        if ((int) $pdo->query('PRAGMA user_version')->fetchColumn() !== self::TARGET_USER_VERSION) throw new HubSchemaMigrationException('SQLite user_version is incorrect', 'SCHEMA_VERSION_MISMATCH');
        $foreign = $pdo->query('PRAGMA foreign_key_check')->fetchAll();
        if ($foreign !== []) throw new HubSchemaMigrationException('Foreign-key integrity check failed', 'FOREIGN_KEY_CHECK_FAILED');
    }

    private static function tableExists(PDO $pdo, string $table): bool
    {
        $query = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = :name");
        $query->execute(['name' => $table]);
        return $query->fetchColumn() !== false;
    }

    private static function indexExists(PDO $pdo, string $index): bool
    {
        $query = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = :name");
        $query->execute(['name' => $index]);
        return $query->fetchColumn() !== false;
    }
}
