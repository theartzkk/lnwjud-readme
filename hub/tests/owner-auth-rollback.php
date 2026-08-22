<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubSchemaMigration.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentApiMigration.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneMigration.php';
require_once dirname(__DIR__) . '/src/HubOwnerAuthMigration.php';

function owner_rollback_assert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDOUT, "AWH owner-auth v4 rollback: SKIP pdo_sqlite unavailable\n");
    exit(77);
}

$root = sys_get_temp_dir() . '/awh-owner-auth-rollback-' . bin2hex(random_bytes(5));
mkdir($root, 0700, true);
$database = $root . '/awh.sqlite';
$backup = $root . '/awh.v4.backup.sqlite';
$restored = $root . '/awh.restored.sqlite';
$schema = dirname(__DIR__) . '/schema.sql';
$m3e1 = dirname(__DIR__) . '/migrations/001_m3e_enrollment.sql';
$m3e2 = dirname(__DIR__) . '/migrations/002_m3e2_enrollment_api.sql';
$m4 = dirname(__DIR__) . '/migrations/003_m4_control_plane.sql';
$m5 = dirname(__DIR__) . '/migrations/004_owner_auth.sql';
$now = '2026-08-22T00:00:00.000Z';

try {
    $pdo = new PDO('sqlite:' . $database, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec(file_get_contents($schema));
    foreach (['enrollment_rate_limits', 'device_project_memberships', 'device_tokens', 'pairing_projects', 'pairing_codes', 'user_project_memberships', 'device_enrollments', 'owner_bootstrap', 'hub_users'] as $table) {
        $pdo->exec('DROP TABLE IF EXISTS ' . $table);
    }
    owner_rollback_assert(HubSchemaMigration::apply($database, $m3e1, $now, false, $schema) === 'applied', 'M3E.1 must apply');
    owner_rollback_assert(HubEnrollmentApiMigration::apply($database, $m3e2, $now) === 'applied', 'M3E.2 must apply');
    owner_rollback_assert(HubControlPlaneMigration::apply($database, $m4, $now) === 'applied', 'M4 must apply');
    owner_rollback_assert((int) $pdo->query('PRAGMA user_version')->fetchColumn() === 4, 'pre-migration baseline must be v4');
    $pdo = null;

    // The fixture models the verified SQLite-aware production backup boundary:
    // capture the complete v4 file before applying the v5 migration.
    owner_rollback_assert(copy($database, $backup), 'v4 backup must be captured');
    $backupPdo = new PDO('sqlite:' . $backup, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    owner_rollback_assert((int) $backupPdo->query('PRAGMA user_version')->fetchColumn() === 4, 'backup must record v4');
    owner_rollback_assert($backupPdo->query('PRAGMA integrity_check')->fetchColumn() === 'ok', 'backup integrity');
    owner_rollback_assert($backupPdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'backup foreign keys');
    owner_rollback_assert((int) $backupPdo->query("SELECT COUNT(*) FROM awh_schema_migrations WHERE migration_id = 'm5-owner-auth'")->fetchColumn() === 0, 'backup must not contain v5 ledger');
    $backupPdo = null;

    owner_rollback_assert(HubOwnerAuthMigration::apply($database, $m5, $now) === 'applied', 'v5 first pass');
    owner_rollback_assert(HubOwnerAuthMigration::apply($database, $m5, $now) === 'already-applied', 'v5 idempotence');
    $v5 = new PDO('sqlite:' . $database, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    owner_rollback_assert((int) $v5->query('PRAGMA user_version')->fetchColumn() === 5, 'post-migration database must be v5');
    owner_rollback_assert((int) $v5->query("SELECT COUNT(*) FROM awh_schema_migrations WHERE migration_id = 'm5-owner-auth'")->fetchColumn() === 1, 'v5 ledger must exist');
    $v5 = null;

    // Restore the exact verified pre-migration artifact and prove the old
    // capability boundary is restored without replaying or downgrading SQL.
    owner_rollback_assert(copy($backup, $restored), 'rollback must restore the verified v4 backup');
    $restoredPdo = new PDO('sqlite:' . $restored, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    owner_rollback_assert((int) $restoredPdo->query('PRAGMA user_version')->fetchColumn() === 4, 'restored database must be v4');
    owner_rollback_assert((int) $restoredPdo->query("SELECT COUNT(*) FROM awh_schema_migrations WHERE migration_id = 'm5-owner-auth'")->fetchColumn() === 0, 'restored database must not contain v5 ledger');
    owner_rollback_assert((int) $restoredPdo->query("SELECT COUNT(*) FROM awh_schema_migrations WHERE migration_id = 'm4-control-plane'")->fetchColumn() === 1, 'M4 ledger must remain after rollback');
    owner_rollback_assert($restoredPdo->query('PRAGMA integrity_check')->fetchColumn() === 'ok', 'restored integrity');
    owner_rollback_assert($restoredPdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'restored foreign keys');
    fwrite(STDOUT, "AWH owner-auth v4 rollback: PASS\n");
} finally {
    @unlink($database);
    @unlink($backup);
    @unlink($restored);
    @rmdir($root);
}
