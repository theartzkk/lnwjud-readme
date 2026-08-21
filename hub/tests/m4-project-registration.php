<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubSchemaMigration.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentApiMigration.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneMigration.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneProjectRegistration.php';

function m4_project_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { fwrite(STDOUT, "AWH M4 project registration tests: SKIP pdo_sqlite extension unavailable\n"); exit(77); }
$root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'awh-m4-projects-' . bin2hex(random_bytes(6)); mkdir($root, 0700, true); $db = $root . '/awh.sqlite'; $projectId = '113b45c0-23e1-408d-ae0f-ac5eca7f6900'; $ownerId = '223b45c0-23e1-408d-ae0f-ac5eca7f6900'; $emptyDb = $root . '/empty.sqlite';
$createBaseSchema = static function (PDO $database): void {
    $database->exec("CREATE TABLE projects (project_id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, created_at TEXT NOT NULL, source_revision TEXT, observed_at TEXT NOT NULL, provenance TEXT NOT NULL); CREATE TABLE project_memory (project_id TEXT NOT NULL, memory_file TEXT NOT NULL, status TEXT NOT NULL, sha256 TEXT, size_bytes INTEGER, observed_at TEXT NOT NULL, provenance TEXT NOT NULL, PRIMARY KEY(project_id, memory_file), FOREIGN KEY(project_id) REFERENCES projects(project_id)); CREATE TABLE devices (device_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, platform TEXT NOT NULL, arch TEXT NOT NULL, app_version TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked_at TEXT); CREATE TABLE builds (build_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, revision_id TEXT NOT NULL, status TEXT NOT NULL, version TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT, FOREIGN KEY(project_id) REFERENCES projects(project_id)); CREATE TABLE releases (release_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, released_at TEXT, FOREIGN KEY(project_id) REFERENCES projects(project_id));");
};
try {
    $pdo = new PDO('sqlite:' . $db, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $createBaseSchema($pdo);
    $pdo->exec("INSERT INTO projects VALUES('$projectId', 'Art’s Workspace Hub', 'node', '2026-01-01T00:00:00.000Z', NULL, '2026-08-20T00:00:00.000Z', 'm4-test')");
    m4_project_assert(HubSchemaMigration::apply($db, dirname(__DIR__) . '/migrations/001_m3e_enrollment.sql', '2026-08-21T00:00:00.000Z', false, dirname(__DIR__) . '/schema.sql') === 'applied', 'M3E migration failed');
    m4_project_assert(HubEnrollmentApiMigration::apply($db, dirname(__DIR__) . '/migrations/002_m3e2_enrollment_api.sql', '2026-08-21T00:00:01.000Z') === 'applied', 'M3E.2 migration failed');
    m4_project_assert(HubControlPlaneMigration::apply($db, dirname(__DIR__) . '/migrations/003_m4_control_plane.sql', '2026-08-21T00:00:02.000Z') === 'applied', 'M4 migration failed');
    HubEnrollmentService::openExisting($db)->initializeOwner($ownerId, 'Art', [$projectId], '2026-08-21T00:00:03.000Z');
    $pdo->exec('PRAGMA user_version = 4');
    $optionalProjects = [
        ['projectId' => '423b45c0-23e1-408d-ae0f-ac5eca7f6900', 'name' => 'Example Web Project', 'type' => 'web'],
        ['projectId' => '523b45c0-23e1-408d-ae0f-ac5eca7f6900', 'name' => 'Example Media Project', 'type' => 'creative'],
    ];
    m4_project_assert(HubControlPlaneProjectRegistration::register($pdo, $optionalProjects, '2026-08-21T00:00:04.000Z') === 2, 'optional project registration failed');
    m4_project_assert(HubControlPlaneProjectRegistration::register($pdo, $optionalProjects, '2026-08-21T00:00:05.000Z') === 2, 'optional project registration must be idempotent');
    m4_project_assert((int) $pdo->query('SELECT COUNT(*) FROM projects')->fetchColumn() === 3, 'registration must preserve existing AWH project and add optional projects');
    m4_project_assert((int) $pdo->query('SELECT COUNT(*) FROM user_project_memberships')->fetchColumn() === 3, 'owner must be a member of all onboarded projects');

    $emptyPdo = new PDO('sqlite:' . $emptyDb, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $createBaseSchema($emptyPdo);
    m4_project_assert(HubSchemaMigration::apply($emptyDb, dirname(__DIR__) . '/migrations/001_m3e_enrollment.sql', '2026-08-21T00:01:00.000Z', false, dirname(__DIR__) . '/schema.sql') === 'applied', 'empty M3E migration failed');
    m4_project_assert(HubEnrollmentApiMigration::apply($emptyDb, dirname(__DIR__) . '/migrations/002_m3e2_enrollment_api.sql', '2026-08-21T00:01:01.000Z') === 'applied', 'empty M3E.2 migration failed');
    m4_project_assert(HubControlPlaneMigration::apply($emptyDb, dirname(__DIR__) . '/migrations/003_m4_control_plane.sql', '2026-08-21T00:01:02.000Z') === 'applied', 'empty M4 migration failed');
    HubEnrollmentService::openExisting($emptyDb)->initializeOwner('623b45c0-23e1-408d-ae0f-ac5eca7f6900', 'Empty Owner', [], '2026-08-21T00:01:03.000Z');
    $emptyPdo->exec('PRAGMA user_version = 4');
    m4_project_assert(HubControlPlaneProjectRegistration::register($emptyPdo, [], '2026-08-21T00:01:04.000Z') === 0, 'fresh Hub must accept an empty onboarding set');
    m4_project_assert(HubControlPlaneProjectRegistration::register($emptyPdo, [], '2026-08-21T00:01:05.000Z') === 0, 'empty onboarding must be idempotent');
    m4_project_assert((int) $emptyPdo->query('SELECT COUNT(*) FROM projects')->fetchColumn() === 0, 'fresh Hub must remain empty until a project is onboarded');
    m4_project_assert((int) $emptyPdo->query('SELECT COUNT(*) FROM user_project_memberships')->fetchColumn() === 0, 'fresh Hub must not create project memberships');
    fwrite(STDOUT, "AWH M4 project registration tests: PASS\n");
} finally { @unlink($db); @unlink($emptyDb); @rmdir($root); }
