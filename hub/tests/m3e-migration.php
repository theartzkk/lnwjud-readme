<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubSchemaMigration.php';

function migration_assert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function migration_throws(callable $callback, string $message): void
{
    try { $callback(); } catch (Throwable) { return; }
    throw new RuntimeException($message);
}

function m3d_fixture(PDO $pdo): void
{
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

function migration_db(string $path): PDO
{
    $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    return $pdo;
}

function table_exists(PDO $pdo, string $name): bool
{
    $q = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = :name");
    $q->execute(['name' => $name]);
    return $q->fetchColumn() !== false;
}

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDOUT, "AWH M3E migration tests: SKIP pdo_sqlite extension unavailable\n");
    exit(77);
}

$root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'awh-m3e-migration-' . bin2hex(random_bytes(6));
mkdir($root, 0700, true);
$migration = dirname(__DIR__) . '/migrations/001_m3e_enrollment.sql';
$baseline = dirname(__DIR__) . '/schema.sql';
$projectId = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';

try {
    $db = $root . '/m3d.sqlite';
    $pdo = migration_db($db);
    m3d_fixture($pdo);
    $pdo->exec("INSERT INTO projects VALUES('$projectId', 'Art’s Workspace Hub', 'node', '2026-01-01T00:00:00.000Z', NULL, '2026-08-20T00:00:00.000Z', 'test-fixture')");
    $pdo->exec("INSERT INTO project_memory VALUES('$projectId', 'HANDOFF.md', 'present', '" . str_repeat('a', 64) . "', 42, '2026-08-20T00:00:00.000Z', 'test-fixture')");
    $beforeProject = $pdo->query('SELECT * FROM projects')->fetchAll();
    $beforeMemory = $pdo->query('SELECT * FROM project_memory')->fetchAll();
    migration_assert(HubSchemaMigration::apply($db, $migration, '2026-08-20T00:00:00.000Z', false, $baseline) === 'applied', 'M3D database must migrate');
    $after = migration_db($db);
    migration_assert($beforeProject === $after->query('SELECT * FROM projects')->fetchAll(), 'project metadata must be preserved exactly');
    migration_assert($beforeMemory === $after->query('SELECT * FROM project_memory')->fetchAll(), 'memory metadata must be preserved exactly');
    migration_assert((int) $after->query('PRAGMA user_version')->fetchColumn() === 2, 'target schema version must be recorded');
    migration_assert((int) $after->query('PRAGMA foreign_key_check')->fetchColumn() === 0, 'foreign-key check must be clean');
    migration_assert((int) $after->query("SELECT COUNT(*) FROM pairing_codes")->fetchColumn() === 0 && (int) $after->query("SELECT COUNT(*) FROM device_tokens")->fetchColumn() === 0, 'migration must not create plaintext or any secret rows');
    migration_assert(HubSchemaMigration::apply($db, $migration, '2026-08-20T00:00:01.000Z', false, $baseline) === 'already-applied', 'second invocation must be idempotent');
    migration_throws(fn () => $after->exec("INSERT INTO owner_bootstrap VALUES(1, '223b45c0-23e1-408d-ae0f-ac5eca7f6900', '2026-08-20T00:00:00.000Z', 1); INSERT INTO owner_bootstrap VALUES(1, '323b45c0-23e1-408d-ae0f-ac5eca7f6900', '2026-08-20T00:00:00.000Z', 1)"), 'owner singleton constraint must reject duplicates');
    $after->exec("INSERT INTO devices VALUES('223b45c0-23e1-408d-ae0f-ac5eca7f6900', 'Test Device', 'darwin', 'arm64', '0.4.0', '2026-08-20T00:00:00.000Z', NULL)");
    migration_throws(fn () => $after->exec("INSERT INTO devices VALUES('223b45c0-23e1-408d-ae0f-ac5eca7f6900', 'Duplicate', 'darwin', 'arm64', '0.4.0', '2026-08-20T00:00:00.000Z', NULL)"), 'duplicate device ID must remain rejected');

    $empty = $root . '/empty.sqlite';
    migration_assert(HubSchemaMigration::apply($empty, $migration, '2026-08-20T00:00:00.000Z', false, $baseline) === 'applied', 'empty database bootstrap migration must succeed');
    migration_assert(!table_exists(migration_db($empty), 'projects') === false, 'empty migration must create the baseline tables for local bootstrap only');

    $interrupted = $root . '/interrupted.sqlite';
    $p = migration_db($interrupted); m3d_fixture($p); unset($p);
    migration_throws(fn () => HubSchemaMigration::apply($interrupted, $migration, '2026-08-20T00:00:00.000Z', true, $baseline), 'interrupted migration must fail for recovery test');
    $recovery = migration_db($interrupted);
    migration_assert(!table_exists($recovery, 'device_tokens') && !table_exists($recovery, 'awh_schema_migrations'), 'interrupted migration must roll back all additive objects');
    migration_assert(HubSchemaMigration::apply($interrupted, $migration, '2026-08-20T00:00:01.000Z', false, $baseline) === 'applied', 'interrupted database must recover by rerun');

    $partial = $root . '/partial.sqlite';
    $p = migration_db($partial); m3d_fixture($p); $p->exec('CREATE TABLE device_tokens (token_id TEXT PRIMARY KEY)'); unset($p);
    migration_throws(fn () => HubSchemaMigration::apply($partial, $migration, null, false, $baseline), 'untracked partial schema must fail closed');

    $mismatch = $root . '/mismatch.sqlite';
    $p = migration_db($mismatch); m3d_fixture($p); $p->exec('PRAGMA user_version = 99'); unset($p);
    migration_throws(fn () => HubSchemaMigration::apply($mismatch, $migration, null, false, $baseline), 'unknown schema version must fail closed');

    fwrite(STDOUT, "AWH M3E migration tests: PASS\n");
} finally {
    foreach (glob($root . '/*.sqlite') ?: [] as $file) @unlink($file);
    @rmdir($root);
}
