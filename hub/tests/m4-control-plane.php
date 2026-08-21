<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubSchemaMigration.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentApiMigration.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneMigration.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneRouter.php';

function m4_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function m4_json(array $value): string { return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR); }
function m4_server(array $extra = []): array { return array_merge(['CONTENT_TYPE' => 'application/json'], $extra); }
function m4_response(HubControlPlaneService $service, string $method, string $uri, array $server, array $body): array { return HubControlPlaneRouter::dispatch($method, $uri, $server, $service, m4_json($body)); }
function m4_cookie(array $response, string $name): string { foreach (($response['headers']['Set-Cookie'] ?? []) as $line) if (str_starts_with($line, $name . '=')) return explode(';', substr($line, strlen($name) + 1), 2)[0]; throw new RuntimeException('cookie missing'); }

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { fwrite(STDOUT, "AWH M4 control-plane tests: SKIP pdo_sqlite extension unavailable\n"); exit(77); }

$root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'awh-m4-' . bin2hex(random_bytes(6)); mkdir($root, 0700, true); $db = $root . '/awh.sqlite'; $schema = dirname(__DIR__) . '/schema.sql'; $projectId = '113b45c0-23e1-408d-ae0f-ac5eca7f6900'; $ownerId = '223b45c0-23e1-408d-ae0f-ac5eca7f6900'; $macId = '423b45c0-23e1-408d-ae0f-ac5eca7f6900';
try {
    $pdo = new PDO('sqlite:' . $db, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec("CREATE TABLE projects (project_id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, created_at TEXT NOT NULL, source_revision TEXT, observed_at TEXT NOT NULL, provenance TEXT NOT NULL); CREATE TABLE project_memory (project_id TEXT NOT NULL, memory_file TEXT NOT NULL, status TEXT NOT NULL, sha256 TEXT, size_bytes INTEGER, observed_at TEXT NOT NULL, provenance TEXT NOT NULL, PRIMARY KEY(project_id, memory_file), FOREIGN KEY(project_id) REFERENCES projects(project_id)); CREATE TABLE devices (device_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, platform TEXT NOT NULL, arch TEXT NOT NULL, app_version TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked_at TEXT); CREATE TABLE builds (build_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, revision_id TEXT NOT NULL, status TEXT NOT NULL, version TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT, FOREIGN KEY(project_id) REFERENCES projects(project_id)); CREATE TABLE releases (release_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, released_at TEXT, FOREIGN KEY(project_id) REFERENCES projects(project_id));");
    $pdo->exec("INSERT INTO projects VALUES('$projectId', 'Art’s Workspace Hub', 'node', '2026-01-01T00:00:00.000Z', NULL, '2026-08-20T00:00:00.000Z', 'm4-test')");
    m4_assert(HubSchemaMigration::apply($db, dirname(__DIR__) . '/migrations/001_m3e_enrollment.sql', '2026-08-21T00:00:00.000Z', false, $schema) === 'applied', 'M3E.1 fixture migration failed');
    m4_assert(HubEnrollmentApiMigration::apply($db, dirname(__DIR__) . '/migrations/002_m3e2_enrollment_api.sql', '2026-08-21T00:00:01.000Z') === 'applied', 'M3E.2 fixture migration failed');
    m4_assert(HubControlPlaneMigration::apply($db, dirname(__DIR__) . '/migrations/003_m4_control_plane.sql', '2026-08-21T00:00:02.000Z') === 'applied', 'M4 migration failed');
    m4_assert(HubControlPlaneMigration::apply($db, dirname(__DIR__) . '/migrations/003_m4_control_plane.sql', '2026-08-21T00:00:03.000Z') === 'already-applied', 'M4 migration must be idempotent');
    m4_assert((int) $pdo->query('PRAGMA user_version')->fetchColumn() === 4, 'M4 schema version must be 4');
    m4_assert($pdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'M4 foreign keys must be clean');
    $testNow = gmdate('c');
    $enrollment = HubEnrollmentService::openExisting($db); $enrollment->initializeOwner($ownerId, 'Art', [$projectId], $testNow);
    $initial = $pdo->query('SELECT code_hash FROM pairing_codes LIMIT 1')->fetchColumn(); m4_assert(is_string($initial) && strlen($initial) === 64, 'pairing hash must exist');
    // Use the domain service to obtain a real owner pairing code without exposing
    // it to assertions beyond the bounded test process.
    $pairing = $enrollment->issuePairingCode($ownerId, [$projectId], $testNow);
    putenv('AWH_CONTROL_ORIGIN=https://awh.test');
    $sessionResponse = m4_response(HubControlPlaneService::openExisting($db), 'POST', '/api/v1/control/session', m4_server(['HTTP_ORIGIN' => 'https://awh.test']), ['schemaVersion' => 1, 'pairingCode' => $pairing['pairingCode'], 'displayName' => 'Art iPhone', 'appVersion' => '0.5.0']);
    m4_assert($sessionResponse['status'] === 200 && !str_contains($sessionResponse['body'], 'sessionToken') && !str_contains($sessionResponse['body'], 'accessToken'), 'mobile session must not expose credentials');
    $sessionCookie = m4_cookie($sessionResponse, '__Host-awh_control_session'); $csrfCookie = m4_cookie($sessionResponse, 'awh_csrf');
    $sessionState = m4_response(HubControlPlaneService::openExisting($db), 'GET', '/api/v1/control/session', ['HTTP_COOKIE' => '__Host-awh_control_session=' . $sessionCookie, 'HTTP_ORIGIN' => 'https://awh.test'], []);
    $sessionPayload = json_decode($sessionState['body'], true, 32, JSON_THROW_ON_ERROR); m4_assert($sessionState['status'] === 200 && is_string($sessionPayload['csrfToken'] ?? null), 'session must return a short-lived CSRF value'); $csrf = $sessionPayload['csrfToken'];
    $control = HubControlPlaneService::openExisting($db);
    $task = m4_response($control, 'POST', '/api/v1/control/tasks', m4_server(['HTTP_ORIGIN' => 'https://awh.test', 'HTTP_COOKIE' => '__Host-awh_control_session=' . $sessionCookie, 'HTTP_X_AWH_CSRF' => $csrf]), ['schemaVersion' => 1, 'projectId' => $projectId, 'goal' => 'ตรวจสถานะโปรเจกต์แบบปลอดภัย', 'idempotencyKey' => 'iphone-demo-0001']);
    m4_assert($task['status'] === 201 && str_contains($task['body'], 'WAITING_FOR_WORKER'), 'goal must create a truthful waiting task');
    $taskPayload = json_decode($task['body'], true, 32, JSON_THROW_ON_ERROR);
    $duplicate = m4_response($control, 'POST', '/api/v1/control/tasks', m4_server(['HTTP_ORIGIN' => 'https://awh.test', 'HTTP_COOKIE' => '__Host-awh_control_session=' . $sessionCookie, 'HTTP_X_AWH_CSRF' => $csrf]), ['schemaVersion' => 1, 'projectId' => $projectId, 'goal' => 'different text is ignored', 'idempotencyKey' => 'iphone-demo-0001']);
    m4_assert($duplicate['status'] === 201 && substr_count($duplicate['body'], 'iphone-demo-0001') === 0, 'duplicate submit must return the existing sanitized task');
    $workerPairing = $enrollment->issuePairingCode($ownerId, [$projectId], $testNow);
    $worker = $enrollment->enrollDevice(['schemaVersion' => 1, 'pairingCode' => $workerPairing['pairingCode'], 'deviceId' => $macId, 'displayName' => 'Mac Worker', 'platform' => 'darwin', 'arch' => 'arm64', 'appVersion' => '0.5.0'], $testNow);
    $heartbeat = m4_response($control, 'POST', '/api/v1/control/workers/heartbeat', m4_server(['HTTP_AUTHORIZATION' => 'Bearer ' . $worker['accessToken']]), ['schemaVersion' => 1, 'deviceId' => $macId, 'state' => 'READY', 'capabilities' => ['project-memory:read', 'artifact:write']]);
    m4_assert($heartbeat['status'] === 200, 'enrolled worker heartbeat must be accepted');
    $claim = m4_response($control, 'POST', '/api/v1/control/workers/claim', m4_server(['HTTP_AUTHORIZATION' => 'Bearer ' . $worker['accessToken']]), ['schemaVersion' => 1, 'deviceId' => $macId]);
    $claimPayload = json_decode($claim['body'], true, 32, JSON_THROW_ON_ERROR);
    $claimCode = json_decode($claim['body'], true)['code'] ?? 'unknown';
    m4_assert($claim['status'] === 200 && is_array($claimPayload['task'] ?? null), 'eligible worker must claim the waiting task: ' . $claimCode);
    $updated = m4_response($control, 'POST', '/api/v1/control/tasks/' . $claimPayload['task']['taskId'] . '/update', m4_server(['HTTP_AUTHORIZATION' => 'Bearer ' . $worker['accessToken']]), ['schemaVersion' => 1, 'deviceId' => $macId, 'state' => 'COMPLETED', 'progress' => 100, 'message' => 'bounded QA complete', 'resultSummary' => 'Safe inspection completed']);
    m4_assert($updated['status'] === 200 && str_contains($updated['body'], 'COMPLETED'), 'worker completion must update the canonical task');
    $forbidden = m4_response($control, 'POST', '/api/v1/control/tasks', m4_server(['HTTP_ORIGIN' => 'https://evil.test', 'HTTP_COOKIE' => '__Host-awh_control_session=' . $sessionCookie, 'HTTP_X_AWH_CSRF' => $csrf]), ['schemaVersion' => 1, 'projectId' => $projectId, 'goal' => 'safe', 'idempotencyKey' => 'iphone-demo-0002']);
    m4_assert($forbidden['status'] === 403, 'wrong browser origin must fail closed');
    $replay = m4_response(HubControlPlaneService::openExisting($db), 'POST', '/api/v1/control/session', m4_server(['HTTP_ORIGIN' => 'https://awh.test']), ['schemaVersion' => 1, 'pairingCode' => $pairing['pairingCode'], 'displayName' => 'Replay', 'appVersion' => '0.5.0']);
    m4_assert($replay['status'] === 409, 'control pairing must be single-use');
    $rateResponses = [];
    for ($i = 0; $i < 4; $i++) { $rateResponses[] = m4_response(HubControlPlaneService::openExisting($db), 'POST', '/api/v1/control/session', m4_server(['HTTP_ORIGIN' => 'https://awh.test']), ['schemaVersion' => 1, 'pairingCode' => rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '='), 'displayName' => 'Rate Test', 'appVersion' => '0.5.0']); }
    m4_assert(end($rateResponses)['status'] === 429, 'control pairing attempts must be rate limited');
    $secrets = json_encode([$sessionResponse, $sessionState, $task], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); m4_assert(is_string($secrets) && !preg_match('/password|tokenHash|workspacePath|\/Users\/|[A-Za-z]:\\\\/i', $secrets), 'control responses must not leak secret or local-path fields');
    fwrite(STDOUT, "AWH M4 control-plane tests: PASS\n");
} finally { putenv('AWH_CONTROL_ORIGIN'); @unlink($db); @rmdir($root); }
