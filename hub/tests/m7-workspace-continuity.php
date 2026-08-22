<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubSchemaMigration.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentApiMigration.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneMigration.php';
require_once dirname(__DIR__) . '/src/HubOwnerAuthMigration.php';
require_once dirname(__DIR__) . '/src/HubAssistantWorkstreamMigration.php';
require_once dirname(__DIR__) . '/src/HubWorkspaceContinuityMigration.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneRouter.php';

function m7_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function m7_json(array $value): string { return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR); }
function m7_response(HubControlPlaneService $service, string $method, string $uri, array $server, array $body = []): array { return HubControlPlaneRouter::dispatch($method, $uri, $server, $service, m7_json($body)); }
function m7_cookie(array $response, string $name): string { foreach (($response['headers']['Set-Cookie'] ?? []) as $line) if (str_starts_with($line, $name . '=')) return explode(';', substr($line, strlen($name) + 1), 2)[0]; throw new RuntimeException('missing cookie'); }
function m7_server(array $extra = []): array { return array_merge(['CONTENT_TYPE' => 'application/json', 'HTTP_ORIGIN' => 'https://awh.test'], $extra); }

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { fwrite(STDOUT, "AWH M7 workspace continuity: SKIP pdo_sqlite extension unavailable\n"); exit(77); }

$root = sys_get_temp_dir() . '/awh-m7-' . bin2hex(random_bytes(6)); mkdir($root, 0700, true);
$db = $root . '/awh.sqlite'; $base = dirname(__DIR__);
$project = '113b45c0-23e1-408d-ae0f-ac5eca7f6900'; $owner = '223b45c0-23e1-408d-ae0f-ac5eca7f6900'; $mac = '423b45c0-23e1-408d-ae0f-ac5eca7f6900'; $windows = '523b45c0-23e1-408d-ae0f-ac5eca7f6900'; $checkpoint = '623b45c0-23e1-408d-ae0f-ac5eca7f6900'; $now = gmdate('c'); $baseRevision = str_repeat('a', 40); $wipRevision = str_repeat('b', 40); $treeRevision = str_repeat('c', 40);
putenv('AWH_CONTROL_ORIGIN=https://awh.test');
try {
    $pdo = new PDO('sqlite:' . $db, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec(file_get_contents($base . '/schema.sql'));
    foreach (['enrollment_rate_limits', 'device_project_memberships', 'device_tokens', 'pairing_projects', 'pairing_codes', 'user_project_memberships', 'device_enrollments', 'owner_bootstrap', 'hub_users'] as $table) $pdo->exec('DROP TABLE IF EXISTS ' . $table);
    $pdo->exec("INSERT INTO projects VALUES('$project', 'Continuity Project', 'node', '$now', NULL, '$now', 'm7-test')");
    m7_assert(HubSchemaMigration::apply($db, $base . '/migrations/001_m3e_enrollment.sql', $now, false, $base . '/schema.sql') === 'applied', 'M3E.1 migration');
    m7_assert(HubEnrollmentApiMigration::apply($db, $base . '/migrations/002_m3e2_enrollment_api.sql', $now) === 'applied', 'M3E.2 migration');
    $enrollment = HubEnrollmentService::openExisting($db); $initial = $enrollment->initializeOwner($owner, 'Art Owner', [$project], $now);
    $macDevice = $enrollment->enrollDevice(['schemaVersion' => 1, 'pairingCode' => $initial['initialPairingCode'], 'deviceId' => $mac, 'displayName' => 'Mac', 'platform' => 'darwin', 'arch' => 'arm64', 'appVersion' => '1.0.0'], $now);
    m7_assert(HubControlPlaneMigration::apply($db, $base . '/migrations/003_m4_control_plane.sql', $now) === 'applied', 'M4 migration');
    m7_assert(HubOwnerAuthMigration::apply($db, $base . '/migrations/004_owner_auth.sql', $now) === 'applied', 'M5 migration');
    m7_assert(HubAssistantWorkstreamMigration::apply($db, $base . '/migrations/005_assistant_workstream.sql', $now) === 'applied', 'M6 migration');
    m7_assert(HubWorkspaceContinuityMigration::apply($db, $base . '/migrations/006_workspace_continuity.sql', $now) === 'applied', 'M7 migration');
    m7_assert(HubWorkspaceContinuityMigration::apply($db, $base . '/migrations/006_workspace_continuity.sql', $now) === 'already-applied', 'M7 migration idempotence');
    m7_assert((int) $pdo->query('PRAGMA user_version')->fetchColumn() === 7, 'M7 global version must be monotonic');
    m7_assert((int) $pdo->query("SELECT COUNT(*) FROM awh_schema_migrations WHERE migration_id IN ('m3e.1-enrollment', 'm3e.2-enrollment-api', 'm4-control-plane', 'm5-owner-auth', 'm6-assistant-workstream', 'm7-workspace-continuity')")->fetchColumn() === 6, 'M7 ledger must preserve all active capabilities');

    $windowsPair = $enrollment->issuePairingCode($owner, [$project], $now);
    $windowsDevice = $enrollment->enrollDevice(['schemaVersion' => 1, 'pairingCode' => $windowsPair['pairingCode'], 'deviceId' => $windows, 'displayName' => 'Windows', 'platform' => 'win32', 'arch' => 'x64', 'appVersion' => '1.0.0'], $now);
    $control = HubControlPlaneService::openExisting($db);
    $macAuth = ['HTTP_AUTHORIZATION' => 'Bearer ' . $macDevice['accessToken'], 'CONTENT_TYPE' => 'application/json'];
    $windowsAuth = ['HTTP_AUTHORIZATION' => 'Bearer ' . $windowsDevice['accessToken'], 'CONTENT_TYPE' => 'application/json'];
    $payload = ['schemaVersion' => 1, 'checkpointId' => $checkpoint, 'deviceId' => $mac, 'projectId' => $project, 'taskId' => null, 'baseRevision' => $baseRevision, 'wipRevision' => $wipRevision, 'wipRef' => 'refs/awh/wip/' . $project . '/' . $checkpoint, 'treeRevision' => $treeRevision, 'files' => [['path' => 'src/app.ts', 'state' => 'modified', 'sha256' => str_repeat('d', 64), 'sizeBytes' => 16]], 'artifactRefs' => ['artifacts/qa.json'], 'syncState' => 'SYNCED'];
    $published = m7_response($control, 'POST', '/api/v1/control/worker/workspaces/checkpoints', $macAuth, $payload);
    m7_assert($published['status'] === 201, 'source device publishes a durable WIP checkpoint');
    $again = m7_response($control, 'POST', '/api/v1/control/worker/workspaces/checkpoints', $macAuth, $payload);
    m7_assert($again['status'] === 201 && (int) $pdo->query('SELECT COUNT(*) FROM control_workspace_checkpoints')->fetchColumn() === 1, 'checkpoint retry is idempotent');
    $conflict = $payload; $conflict['baseRevision'] = str_repeat('e', 40);
    m7_assert(m7_response($control, 'POST', '/api/v1/control/worker/workspaces/checkpoints', $macAuth, $conflict)['status'] === 409, 'conflicting checkpoint identity fails closed');
    m7_assert(m7_response($control, 'POST', '/api/v1/control/worker/workspaces/leases/claim', $windowsAuth, ['schemaVersion' => 1, 'deviceId' => $windows, 'projectId' => $project, 'checkpointId' => $checkpoint])['status'] === 409, 'active writer lease prevents concurrent Windows writer');

    $browserPair = $enrollment->issuePairingCode($owner, [$project], $now);
    $session = m7_response($control, 'POST', '/api/v1/control/session', m7_server(), ['schemaVersion' => 1, 'pairingCode' => $browserPair['pairingCode'], 'displayName' => 'iPhone', 'appVersion' => '1.0.0']);
    m7_assert($session['status'] === 200, 'browser session'); $cookie = m7_cookie($session, '__Host-awh_control_session');
    $browserState = m7_response($control, 'GET', '/api/v1/control/workspaces/' . $project, ['HTTP_COOKIE' => '__Host-awh_control_session=' . $cookie, 'HTTP_SEC_FETCH_SITE' => 'same-origin']);
    m7_assert($browserState['status'] === 200 && !str_contains($browserState['body'], 'wipRef') && !str_contains($browserState['body'], 'sourceDeviceId'), 'phone receives sanitized continuity state only');

    m7_assert(m7_response($control, 'POST', '/api/v1/control/worker/workspaces/leases/release', $macAuth, ['schemaVersion' => 1, 'deviceId' => $mac, 'projectId' => $project])['status'] === 200, 'source releases after durable handoff');
    $takeover = m7_response($control, 'POST', '/api/v1/control/worker/workspaces/leases/claim', $windowsAuth, ['schemaVersion' => 1, 'deviceId' => $windows, 'projectId' => $project, 'checkpointId' => $checkpoint]);
    m7_assert($takeover['status'] === 200 && str_contains($takeover['body'], $windows), 'Windows claims exactly the durable checkpoint');
    m7_assert(m7_response($control, 'POST', '/api/v1/control/worker/workspaces/leases/renew', $windowsAuth, ['schemaVersion' => 1, 'deviceId' => $windows, 'projectId' => $project])['status'] === 200, 'owner can renew workspace lease');
    $pdo->exec("UPDATE control_workspace_leases SET lease_expires_at = '2000-01-01T00:00:00Z' WHERE project_id = '$project'");
    $offline = m7_response($control, 'GET', '/api/v1/control/worker/workspaces/' . $windows . '/' . $project, ['HTTP_AUTHORIZATION' => 'Bearer ' . $windowsDevice['accessToken']]);
    m7_assert($offline['status'] === 200 && str_contains($offline['body'], 'SOURCE_OFFLINE'), 'expired source lease is truthful rather than silently synchronized');
    m7_assert($pdo->query('PRAGMA integrity_check')->fetchColumn() === 'ok' && $pdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'M7 integrity and foreign keys');
    fwrite(STDOUT, "AWH M7 workspace continuity: PASS\n");
} finally { putenv('AWH_CONTROL_ORIGIN'); @unlink($db); @rmdir($root); }
