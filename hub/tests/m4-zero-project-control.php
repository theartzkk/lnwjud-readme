<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubSchemaMigration.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentApiMigration.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneMigration.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneRouter.php';

function m4_empty_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function m4_empty_json(array $value): string { return json_encode($value === [] ? (object) [] : $value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR); }
function m4_empty_server(array $extra = []): array { return array_merge(['CONTENT_TYPE' => 'application/json'], $extra); }
function m4_empty_response(HubControlPlaneService $service, string $method, string $uri, array $server, array $body): array { return HubControlPlaneRouter::dispatch($method, $uri, $server, $service, m4_empty_json($body)); }
function m4_empty_cookie(array $response, string $name): string { foreach (($response['headers']['Set-Cookie'] ?? []) as $line) if (str_starts_with($line, $name . '=')) return explode(';', substr($line, strlen($name) + 1), 2)[0]; throw new RuntimeException('cookie missing'); }

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { fwrite(STDOUT, "AWH M4 zero-project control tests: SKIP pdo_sqlite extension unavailable\n"); exit(77); }

$root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'awh-m4-empty-control-' . bin2hex(random_bytes(6));
mkdir($root, 0700, true);
$db = $root . '/awh.sqlite';
$schema = dirname(__DIR__) . '/schema.sql';
$ownerId = '723b45c0-23e1-408d-ae0f-ac5eca7f6900';
$now = gmdate('c');

try {
    $pdo = new PDO('sqlite:' . $db, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec(<<<'SQL'
CREATE TABLE projects (project_id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, created_at TEXT NOT NULL, source_revision TEXT, observed_at TEXT NOT NULL, provenance TEXT NOT NULL);
CREATE TABLE project_memory (project_id TEXT NOT NULL, memory_file TEXT NOT NULL, status TEXT NOT NULL, sha256 TEXT, size_bytes INTEGER, observed_at TEXT NOT NULL, provenance TEXT NOT NULL, PRIMARY KEY (project_id, memory_file), FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE);
CREATE TABLE devices (device_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, platform TEXT NOT NULL, arch TEXT NOT NULL, app_version TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked_at TEXT);
CREATE TABLE builds (build_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, revision_id TEXT NOT NULL, status TEXT NOT NULL, version TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT, FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE);
CREATE TABLE releases (release_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, released_at TEXT, FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE);
SQL);
    m4_empty_assert(HubSchemaMigration::apply($db, dirname(__DIR__) . '/migrations/001_m3e_enrollment.sql', $now, false, $schema) === 'applied', 'M3E.1 migration failed');
    m4_empty_assert(HubEnrollmentApiMigration::apply($db, dirname(__DIR__) . '/migrations/002_m3e2_enrollment_api.sql', $now) === 'applied', 'M3E.2 migration failed');
    $enrollment = HubEnrollmentService::openExisting($db);
    $enrollment->initializeOwner($ownerId, 'Empty Owner', [], $now);
    m4_empty_assert(HubControlPlaneMigration::apply($db, dirname(__DIR__) . '/migrations/003_m4_control_plane.sql', $now) === 'applied', 'M4 migration failed');
    $pairing = $enrollment->issuePairingCode($ownerId, [], $now);
    m4_empty_assert($pairing['projectCount'] === 0, 'zero-project pairing must have no project scope');

    putenv('AWH_CONTROL_ORIGIN=https://awh.test');
    $control = HubControlPlaneService::openExisting($db);
    $session = m4_empty_response($control, 'POST', '/api/v1/control/session', m4_empty_server(['HTTP_ORIGIN' => 'https://awh.test']), ['schemaVersion' => 1, 'pairingCode' => $pairing['pairingCode'], 'displayName' => 'AWH iPhone', 'appVersion' => '1.0.0']);
    m4_empty_assert($session['status'] === 200, 'zero-project pairing must open a control session');
    m4_empty_assert(!str_contains($session['body'], 'sessionToken'), 'control session must not expose its token');
    $sessionCookie = m4_empty_cookie($session, '__Host-awh_control_session');
    $state = m4_empty_response($control, 'GET', '/api/v1/control/session', ['HTTP_COOKIE' => '__Host-awh_control_session=' . $sessionCookie, 'HTTP_ORIGIN' => 'https://awh.test'], []);
    $statePayload = json_decode($state['body'], true, 32, JSON_THROW_ON_ERROR);
    m4_empty_assert($state['status'] === 200 && ($statePayload['projects'] ?? null) === [], 'zero-project control session must return projects=[]');
    $csrf = (string) ($statePayload['csrfToken'] ?? '');
    $task = m4_empty_response($control, 'POST', '/api/v1/control/tasks', m4_empty_server(['HTTP_ORIGIN' => 'https://awh.test', 'HTTP_COOKIE' => '__Host-awh_control_session=' . $sessionCookie, 'HTTP_X_AWH_CSRF' => $csrf]), ['schemaVersion' => 1, 'projectId' => '823b45c0-23e1-408d-ae0f-ac5eca7f6900', 'goal' => 'must not queue without a project', 'idempotencyKey' => 'empty-project-0001']);
    m4_empty_assert($task['status'] === 403, 'zero-project session must reject task submission');
    m4_empty_assert((int) $pdo->query('SELECT COUNT(*) FROM control_tasks')->fetchColumn() === 0, 'zero-project session must not create a task');
    fwrite(STDOUT, "AWH M4 zero-project control tests: PASS\n");
} finally {
    putenv('AWH_CONTROL_ORIGIN');
    @unlink($db);
    @rmdir($root);
}
