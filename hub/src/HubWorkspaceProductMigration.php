<?php

declare(strict_types=1);

require_once __DIR__ . '/HubCentralProjectAuthorityMigration.php';

/** M13 extends the existing human account authority with AWH workspace roles, feature overrides and quotas. */
final class HubWorkspaceProductMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'MIGRATION_FAILED') { parent::__construct($message); }
}

final class HubWorkspaceProductMigration
{
    public const TARGET_USER_VERSION = 13;
    public const MIGRATION_ID = 'm13-workspace-product';
    private const TABLES = ['control_user_feature_permissions', 'control_user_quotas'];
    private const INDEXES = ['idx_control_user_profiles_email_unique', 'idx_control_user_profiles_workspace_role', 'idx_control_user_feature_permissions_user', 'idx_control_user_quotas_updated'];
    private const PROFILE_COLUMNS = ['workspace_role', 'disabled_at', 'last_login_at'];
    private const PASSWORD_COLUMNS = ['must_change_password'];
    private const INVITATION_COLUMNS = ['workspace_role'];

    public static function apply(string $databasePath, string $sqlPath, ?string $now = null): string
    {
        $pdo = self::open($databasePath); $sql = @file_get_contents($sqlPath);
        if (!is_string($sql) || $sql === '') throw new HubWorkspaceProductMigrationException('Workspace Product migration is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash('sha256', $sql); $version = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
        if ($version < 12) throw new HubWorkspaceProductMigrationException('M12 Central Project Authority is unavailable', 'BASE_SCHEMA_INVALID');
        try { HubCentralProjectAuthorityMigration::assertCapabilityReady($pdo, dirname(__DIR__) . '/migrations/011_central_project_authority.sql'); }
        catch (Throwable) { throw new HubWorkspaceProductMigrationException('M12 Central Project Authority is unavailable', 'BASE_SCHEMA_INVALID'); }
        $q = $pdo->prepare('SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = :id'); $q->execute(['id' => self::MIGRATION_ID]); $ledger = $q->fetch();
        if (is_array($ledger)) {
            if ((int) $ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals((string) $ledger['checksum'], $checksum) || $version < self::TARGET_USER_VERSION || !self::ready($pdo)) throw new HubWorkspaceProductMigrationException('Workspace Product migration record is invalid', 'MIGRATION_RECORD_INVALID');
            return 'already-applied';
        }
        if ($version > 12 || self::presentTables($pdo) !== [] || self::hasAnyNewColumns($pdo)) throw new HubWorkspaceProductMigrationException('Workspace Product migration order is not provable', 'MIGRATION_ORDER_UNCERTAIN');
        $at = self::timestamp($now ?? gmdate('c'));
        try {
            $pdo->beginTransaction(); $pdo->exec($sql);
            $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id, schema_version, checksum, applied_at) VALUES(:id, :version, :checksum, :at)')->execute(['id' => self::MIGRATION_ID, 'version' => self::TARGET_USER_VERSION, 'checksum' => $checksum, 'at' => $at]);
            $pdo->exec('PRAGMA user_version = 13'); self::assertReady($pdo, $checksum); $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($error instanceof HubWorkspaceProductMigrationException) throw $error;
            throw new HubWorkspaceProductMigrationException('Workspace Product migration rolled back', 'MIGRATION_ROLLED_BACK');
        }
        return 'applied';
    }

    public static function assertCapabilityReady(PDO $pdo, string $sqlPath): void
    {
        if (!is_file($sqlPath)) throw new HubWorkspaceProductMigrationException('Workspace Product migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        self::assertReady($pdo, hash_file('sha256', $sqlPath));
    }

    private static function assertReady(PDO $pdo, string $checksum): void
    {
        $q = $pdo->prepare('SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = :id'); $q->execute(['id' => self::MIGRATION_ID]); $ledger = $q->fetch();
        if ((int) $pdo->query('PRAGMA user_version')->fetchColumn() < self::TARGET_USER_VERSION || !is_array($ledger) || (int) $ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals(strtolower($checksum), strtolower((string) ($ledger['checksum'] ?? ''))) || !self::ready($pdo) || $pdo->query('PRAGMA foreign_key_check')->fetchAll() !== []) throw new HubWorkspaceProductMigrationException('Workspace Product capability is not ready', 'WORKSPACE_PRODUCT_NOT_READY');
    }

    private static function open(string $path): PDO
    {
        if ($path === '' || str_contains($path, "\0")) throw new HubWorkspaceProductMigrationException('Database path is invalid', 'DATABASE_CONFIG_INVALID');
        try { $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]); $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec('PRAGMA busy_timeout = 2500'); return $pdo; }
        catch (Throwable) { throw new HubWorkspaceProductMigrationException('Database is unavailable', 'DATABASE_UNAVAILABLE'); }
    }

    /** @return list<string> */
    private static function presentTables(PDO $pdo): array { $out = []; foreach (self::TABLES as $table) if ($pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '" . $table . "'")->fetchColumn() !== false) $out[] = $table; return $out; }
    private static function ready(PDO $pdo): bool { foreach (self::INDEXES as $index) if ($pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = '" . $index . "'")->fetchColumn() === false) return false; return self::presentTables($pdo) === self::TABLES && self::hasColumns($pdo, 'control_user_profiles', self::PROFILE_COLUMNS) && self::hasColumns($pdo, 'owner_passwords', self::PASSWORD_COLUMNS) && self::hasColumns($pdo, 'control_user_invitations', self::INVITATION_COLUMNS) && self::identityNamespaceSafe($pdo); }
    private static function hasColumns(PDO $pdo, string $table, array $required): bool { $columns = array_column($pdo->query('PRAGMA table_info(' . $table . ')')->fetchAll(), 'name'); foreach ($required as $column) if (!in_array($column, $columns, true)) return false; return true; }
    private static function identityNamespaceSafe(PDO $pdo): bool { $q = $pdo->query("SELECT 1 FROM control_user_profiles p JOIN owner_passwords other ON lower(COALESCE(p.email,'')) = other.username AND p.user_id != other.user_id WHERE p.email IS NOT NULL LIMIT 1"); return $q->fetchColumn() === false; }
    private static function hasAnyNewColumns(PDO $pdo): bool { return self::hasAnyColumns($pdo, 'control_user_profiles', self::PROFILE_COLUMNS) || self::hasAnyColumns($pdo, 'owner_passwords', self::PASSWORD_COLUMNS) || self::hasAnyColumns($pdo, 'control_user_invitations', self::INVITATION_COLUMNS); }
    private static function hasAnyColumns(PDO $pdo, string $table, array $candidates): bool { $columns = array_column($pdo->query('PRAGMA table_info(' . $table . ')')->fetchAll(), 'name'); foreach ($candidates as $column) if (in_array($column, $columns, true)) return true; return false; }
    private static function columnsReady(PDO $pdo): bool { $profiles = array_column($pdo->query('PRAGMA table_info(control_user_profiles)')->fetchAll(), 'name'); $passwords = array_column($pdo->query('PRAGMA table_info(owner_passwords)')->fetchAll(), 'name'); $invites = array_column($pdo->query('PRAGMA table_info(control_user_invitations)')->fetchAll(), 'name'); foreach (['workspace_role','disabled_at','last_login_at'] as $name) if (!in_array($name, $profiles, true)) return false; return in_array('must_change_password', $passwords, true) && in_array('workspace_role', $invites, true); }
    private static function timestamp(string $value): string { if (strtotime($value) === false) throw new HubWorkspaceProductMigrationException('Workspace Product migration time is invalid', 'MIGRATION_FAILED'); return gmdate('c', strtotime($value)); }
}
