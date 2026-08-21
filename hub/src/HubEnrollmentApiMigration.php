<?php

declare(strict_types=1);

final class HubEnrollmentApiMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'MIGRATION_FAILED')
    {
        parent::__construct($message);
    }
}

final class HubEnrollmentApiMigration
{
    public const MIGRATION_ID = 'm3e.2-enrollment-api';
    public const TARGET_USER_VERSION = 3;
    private const REQUIRED_TABLES = [
        'projects', 'project_memory', 'devices', 'builds', 'releases',
        'hub_users', 'owner_bootstrap', 'device_enrollments', 'user_project_memberships',
        'pairing_codes', 'pairing_projects', 'device_tokens', 'device_project_memberships',
        'awh_schema_migrations',
    ];
    private const REQUIRED_COLUMNS = [
        'hub_users' => ['user_id', 'display_name', 'created_at', 'revoked_at'],
        'owner_bootstrap' => ['singleton_id', 'owner_user_id', 'initialized_at', 'bootstrap_closed'],
        'device_enrollments' => ['device_id', 'user_id', 'enrolled_at', 'revoked_at'],
        'user_project_memberships' => ['user_id', 'project_id', 'role', 'created_at', 'revoked_at'],
        'pairing_codes' => ['pairing_code_id', 'user_id', 'code_hash', 'issued_at', 'expires_at', 'consumed_at', 'revoked_at'],
        'pairing_projects' => ['pairing_code_id', 'project_id'],
        'device_tokens' => ['token_id', 'user_id', 'device_id', 'token_hash', 'created_at', 'expires_at', 'revoked_at', 'last_used_at', 'rotated_from_token_id', 'replaced_by_token_id'],
        'device_project_memberships' => ['device_id', 'project_id', 'role', 'created_at', 'revoked_at'],
        'enrollment_rate_limits' => ['rate_key', 'window_started_at', 'attempts', 'blocked_until'],
        'awh_schema_migrations' => ['migration_id', 'schema_version', 'checksum', 'applied_at'],
    ];
    private const REQUIRED_INDEXES = ['idx_device_tokens_device', 'idx_device_memberships_project', 'idx_user_memberships_project'];

    public static function apply(string $databasePath, string $migrationSqlPath, ?string $now = null): string
    {
        $pdo = self::open($databasePath);
        $checksum = hash_file('sha256', $migrationSqlPath);
        $sql = @file_get_contents($migrationSqlPath);
        if (!is_string($checksum) || !is_string($sql) || $sql === '') throw new HubEnrollmentApiMigrationException('Migration file is unavailable', 'MIGRATION_FILE_INVALID');
        self::preflight($pdo);
        $userVersion = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
        if ($userVersion !== 2 && $userVersion !== self::TARGET_USER_VERSION) throw new HubEnrollmentApiMigrationException('SQLite schema version is not M3E.1-compatible', 'SCHEMA_VERSION_MISMATCH');
        $row = $pdo->prepare('SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = :id');
        $row->execute(['id' => self::MIGRATION_ID]);
        $applied = $row->fetch();
        if (is_array($applied)) {
            if ((int) $applied['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals((string) $applied['checksum'], $checksum) || $userVersion !== self::TARGET_USER_VERSION || !self::rateLimitTablePresent($pdo)) {
                throw new HubEnrollmentApiMigrationException('Applied enrollment API migration record is invalid', 'MIGRATION_RECORD_INVALID');
            }
            self::verify($pdo);
            return 'already-applied';
        }
        if ($userVersion === self::TARGET_USER_VERSION || self::tableExists($pdo, 'enrollment_rate_limits')) throw new HubEnrollmentApiMigrationException('Partial or untracked enrollment API migration detected', 'MIGRATION_PARTIAL');
        $now = $now ?? gmdate('c');
        if (strtotime($now) === false) throw new HubEnrollmentApiMigrationException('Migration timestamp is invalid', 'MIGRATION_TIME_INVALID');
        try {
            $pdo->beginTransaction();
            $pdo->exec($sql);
            if (!self::rateLimitTablePresent($pdo)) throw new RuntimeException('rate limit schema verification failed');
            $insert = $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id, schema_version, checksum, applied_at) VALUES(:id, :version, :checksum, :at)');
            $insert->execute(['id' => self::MIGRATION_ID, 'version' => self::TARGET_USER_VERSION, 'checksum' => $checksum, 'at' => $now]);
            $pdo->exec('PRAGMA user_version = ' . self::TARGET_USER_VERSION);
            self::verify($pdo);
            $pdo->commit();
        } catch (HubEnrollmentApiMigrationException $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        } catch (Throwable) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw new HubEnrollmentApiMigrationException('Enrollment API migration rolled back and requires review', 'MIGRATION_ROLLED_BACK');
        }
        return 'applied';
    }

    /**
     * Verify the enrollment capability on the shared Hub database. The global
     * SQLite version is a monotonic database version, not the version of this
     * subsystem; M4 (version 4) must remain a valid enrollment database.
     */
    public static function assertCapabilityReady(PDO $pdo, string $migrationSqlPath): void
    {
        if ($migrationSqlPath === '' || str_contains($migrationSqlPath, "\0") || !is_file($migrationSqlPath)) {
            throw new HubEnrollmentApiMigrationException('Enrollment migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        }
        $checksum = hash_file('sha256', $migrationSqlPath);
        if (!is_string($checksum) || !preg_match('/^[a-f0-9]{64}$/', $checksum)) {
            throw new HubEnrollmentApiMigrationException('Enrollment migration authority is invalid', 'MIGRATION_FILE_INVALID');
        }
        if ((int) $pdo->query('PRAGMA user_version')->fetchColumn() < self::TARGET_USER_VERSION) {
            throw new HubEnrollmentApiMigrationException('SQLite schema is older than the enrollment capability', 'SCHEMA_VERSION_MISMATCH');
        }
        foreach (self::REQUIRED_TABLES as $table) {
            if (!self::tableExists($pdo, $table)) throw new HubEnrollmentApiMigrationException('Enrollment schema is incomplete', 'SCHEMA_VERIFY_FAILED');
        }
        foreach (self::REQUIRED_COLUMNS as $table => $columns) {
            $actual = array_column($pdo->query('PRAGMA table_info(' . $table . ')')->fetchAll(), 'name');
            if (array_diff($columns, $actual) !== []) throw new HubEnrollmentApiMigrationException('Enrollment schema columns are incomplete', 'SCHEMA_VERIFY_FAILED');
        }
        foreach (self::REQUIRED_INDEXES as $index) {
            if (!self::indexExists($pdo, $index)) throw new HubEnrollmentApiMigrationException('Enrollment schema indexes are incomplete', 'SCHEMA_VERIFY_FAILED');
        }
        $m3e1 = $pdo->query("SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = 'm3e.1-enrollment'")->fetch();
        if (!is_array($m3e1) || (int) $m3e1['schema_version'] !== 2 || !preg_match('/^[a-f0-9]{64}$/i', (string) $m3e1['checksum'])) {
            throw new HubEnrollmentApiMigrationException('M3E.1 migration ledger is invalid', 'BASE_SCHEMA_INVALID');
        }
        $m3e2 = $pdo->query("SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = '" . self::MIGRATION_ID . "'")->fetch();
        if (!is_array($m3e2) || (int) $m3e2['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals(strtolower($checksum), strtolower((string) $m3e2['checksum']))) {
            throw new HubEnrollmentApiMigrationException('M3E.2 migration ledger is invalid', 'MIGRATION_RECORD_INVALID');
        }
        if ($pdo->query('PRAGMA foreign_key_check')->fetchAll() !== []) throw new HubEnrollmentApiMigrationException('Foreign-key integrity check failed', 'FOREIGN_KEY_CHECK_FAILED');
    }

    public static function verifyDatabase(string $databasePath, string $migrationSqlPath): void
    {
        $pdo = self::open($databasePath);
        self::assertCapabilityReady($pdo, $migrationSqlPath);
    }

    private static function open(string $path): PDO
    {
        if ($path === '' || str_contains($path, "\0")) throw new HubEnrollmentApiMigrationException('Database path is invalid', 'DATABASE_CONFIG_INVALID');
        try {
            $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
            $pdo->exec('PRAGMA foreign_keys = ON');
            if ((int) $pdo->query('PRAGMA foreign_keys')->fetchColumn() !== 1) throw new RuntimeException('foreign keys disabled');
            return $pdo;
        } catch (HubEnrollmentApiMigrationException $error) {
            throw $error;
        } catch (Throwable) {
            throw new HubEnrollmentApiMigrationException('Database cannot be opened safely', 'DATABASE_UNAVAILABLE');
        }
    }

    private static function preflight(PDO $pdo): void
    {
        foreach (self::REQUIRED_TABLES as $table) {
            if ($table === 'enrollment_rate_limits') continue;
            if (!self::tableExists($pdo, $table)) throw new HubEnrollmentApiMigrationException('M3E.1 schema is incomplete', 'BASE_SCHEMA_INVALID');
        }
        $row = $pdo->prepare('SELECT schema_version FROM awh_schema_migrations WHERE migration_id = :id');
        $row->execute(['id' => 'm3e.1-enrollment']);
        if ((int) $row->fetchColumn() !== 2) throw new HubEnrollmentApiMigrationException('M3E.1 migration ledger is not valid', 'BASE_SCHEMA_INVALID');
    }

    private static function verify(PDO $pdo): void
    {
        if (!self::rateLimitTablePresent($pdo)) throw new HubEnrollmentApiMigrationException('Enrollment rate limit schema is incomplete', 'SCHEMA_VERIFY_FAILED');
        if ((int) $pdo->query('PRAGMA user_version')->fetchColumn() !== self::TARGET_USER_VERSION) throw new HubEnrollmentApiMigrationException('SQLite user_version is incorrect', 'SCHEMA_VERSION_MISMATCH');
        if ($pdo->query('PRAGMA foreign_key_check')->fetchAll() !== []) throw new HubEnrollmentApiMigrationException('Foreign-key integrity check failed', 'FOREIGN_KEY_CHECK_FAILED');
    }

    private static function rateLimitTablePresent(PDO $pdo): bool
    {
        if (!self::tableExists($pdo, 'enrollment_rate_limits')) return false;
        $columns = array_column($pdo->query('PRAGMA table_info(enrollment_rate_limits)')->fetchAll(), 'name');
        return array_diff(['rate_key', 'window_started_at', 'attempts', 'blocked_until'], $columns) === [];
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
