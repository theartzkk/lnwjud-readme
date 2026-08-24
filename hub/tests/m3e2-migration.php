<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubSchemaMigration.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentApiMigration.php';

function m3e2_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function m3e2_expect(string $code, callable $call): void {
    try { $call(); } catch (HubEnrollmentApiMigrationException $error) { m3e2_assert($error->codeName === $code, 'expected ' . $code . ', got ' . $error->codeName); return; }
    throw new RuntimeException('expected migration exception ' . $code);
}
function m3e2_m3d_fixture(PDO $pdo): void {
    $pdo->exec(<<<'SQL'
CREATE TABLE projects (project_id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, created_at TEXT NOT NULL, source_revision TEXT, observed_at TEXT NOT NULL, provenance TEXT NOT NULL);
CREATE TABLE project_memory (project_id TEXT NOT NULL, memory_file TEXT NOT NULL, status TEXT NOT NULL, sha256 TEXT, size_bytes INTEGER, observed_at TEXT NOT NULL, provenance TEXT NOT NULL, PRIMARY KEY (project_id, memory_file), FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE);
CREATE TABLE devices (device_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, platform TEXT NOT NULL, arch TEXT NOT NULL, app_version TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked_at TEXT);
CREATE TABLE builds (build_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, revision_id TEXT NOT NULL, status TEXT NOT NULL, version TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT, FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE);
CREATE TABLE releases (release_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, released_at TEXT, FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE);
CREATE INDEX idx_project_memory_project ON project_memory(project_id);
CREATE INDEX idx_builds_project ON builds(project_id);
CREATE INDEX idx_releases_project ON releases(project_id);
SQL);
}

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { fwrite(STDOUT, "AWH M3E.2 migration tests: SKIP pdo_sqlite extension unavailable\n"); exit(77); }

$root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'awh-m3e2-migration-' . bin2hex(random_bytes(6));
mkdir($root, 0700, true);
$database = $root . DIRECTORY_SEPARATOR . 'awh.sqlite';
$migration = dirname(__DIR__) . '/migrations/001_m3e_enrollment.sql';
$apiMigration = dirname(__DIR__) . '/migrations/002_m3e2_enrollment_api.sql';
$projectId = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';

try {
    $pdo = new PDO('sqlite:' . $database, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    m3e2_m3d_fixture($pdo);
    $pdo->exec("INSERT INTO projects VALUES('$projectId', 'Art’s Workspace Hub', 'node', '2026-01-01T00:00:00.000Z', NULL, '2026-08-20T00:00:00.000Z', 'm3e2-test')");
    m3e2_assert(HubSchemaMigration::apply($database, $migration, '2026-08-20T00:00:00.000Z', false, dirname(__DIR__) . '/schema.sql') === 'applied', 'M3D fixture must migrate to M3E.1');
    $before = $pdo->query("SELECT project_id, name, type, created_at, source_revision, observed_at, provenance FROM projects WHERE project_id = '$projectId'")->fetch(PDO::FETCH_ASSOC);
    m3e2_assert(HubEnrollmentApiMigration::apply($database, $apiMigration, '2026-08-20T00:01:00.000Z') === 'applied', 'M3E.2 migration should apply');
    m3e2_assert(HubEnrollmentApiMigration::apply($database, $apiMigration, '2026-08-20T00:02:00.000Z') === 'already-applied', 'M3E.2 migration should be idempotent');
    $after = $pdo->query("SELECT project_id, name, type, created_at, source_revision, observed_at, provenance FROM projects WHERE project_id = '$projectId'")->fetch(PDO::FETCH_ASSOC);
    m3e2_assert($before === $after, 'M3D project metadata must remain exact');
    m3e2_assert((int) $pdo->query('PRAGMA user_version')->fetchColumn() === 3, 'M3E.2 user_version must be 3');
    m3e2_assert($pdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'foreign-key check must be clean');
    m3e2_assert((int) $pdo->query('SELECT COUNT(*) FROM enrollment_rate_limits')->fetchColumn() === 0, 'migration must not create rate-limit rows');
    foreach (['code', 'pairing_code', 'token', 'secret'] as $forbidden) {
        $columns = $pdo->query('PRAGMA table_info(enrollment_rate_limits)')->fetchAll(PDO::FETCH_COLUMN, 1);
        m3e2_assert(!in_array($forbidden, $columns, true), 'rate-limit schema must not store plaintext secrets');
    }

    $partial = $root . DIRECTORY_SEPARATOR . 'partial.sqlite';
    copy($database, $partial);
    $partialPdo = new PDO('sqlite:' . $partial, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $partialPdo->exec('DROP TABLE enrollment_rate_limits');
    $partialPdo->exec('DELETE FROM awh_schema_migrations WHERE migration_id = ' . $partialPdo->quote(HubEnrollmentApiMigration::MIGRATION_ID));
    $partialPdo->exec('PRAGMA user_version = 2');
    $partialPdo->exec('CREATE TABLE enrollment_rate_limits (rate_key TEXT PRIMARY KEY)');
    m3e2_expect('MIGRATION_PARTIAL', fn () => HubEnrollmentApiMigration::apply($partial, $apiMigration));

    $mismatch = $root . DIRECTORY_SEPARATOR . 'mismatch.sqlite';
    copy($database, $mismatch);
    $mismatchPdo = new PDO('sqlite:' . $mismatch, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $mismatchPdo->exec('DELETE FROM awh_schema_migrations WHERE migration_id = ' . $mismatchPdo->quote(HubEnrollmentApiMigration::MIGRATION_ID));
    $mismatchPdo->exec('PRAGMA user_version = 1');
    m3e2_expect('SCHEMA_VERSION_MISMATCH', fn () => HubEnrollmentApiMigration::apply($mismatch, $apiMigration));
    fwrite(STDOUT, "AWH M3E.2 migration tests: PASS\n");
} finally {
    @unlink($database); @unlink($root . DIRECTORY_SEPARATOR . 'partial.sqlite'); @unlink($root . DIRECTORY_SEPARATOR . 'mismatch.sqlite'); @rmdir($root);
}
