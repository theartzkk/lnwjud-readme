<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubSchemaMigration.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentApiMigration.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneMigration.php';
require_once dirname(__DIR__) . '/src/HubOwnerAuthMigration.php';
require_once dirname(__DIR__) . '/src/HubAssistantWorkstreamMigration.php';
require_once dirname(__DIR__) . '/src/HubWorkspaceContinuityMigration.php';
require_once dirname(__DIR__) . '/src/HubUnifiedWorkspaceMigration.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneRouter.php';

function m8_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function m8_json(array $value): string { return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR); }
function m8_response(HubControlPlaneService $service, string $method, string $uri, array $server, array $body = []): array { return HubControlPlaneRouter::dispatch($method, $uri, $server, $service, m8_json($body)); }
function m8_cookie(array $response, string $name): string { foreach (($response['headers']['Set-Cookie'] ?? []) as $line) if (str_starts_with($line, $name . '=')) return explode(';', substr($line, strlen($name) + 1), 2)[0]; throw new RuntimeException('missing cookie'); }
function m8_browser(string $session, string $csrf): array { return ['CONTENT_TYPE' => 'application/json', 'HTTP_ORIGIN' => 'https://awh.test', 'HTTP_COOKIE' => '__Host-awh_control_session=' . $session . '; awh_csrf=' . $csrf, 'HTTP_X_AWH_CSRF' => $csrf]; }

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { fwrite(STDOUT, "AWH M8 unified workspace: SKIP pdo_sqlite extension unavailable\n"); exit(77); }

$root = sys_get_temp_dir() . '/awh-m8-' . bin2hex(random_bytes(6)); mkdir($root, 0700, true);
$db = $root . '/awh.sqlite'; $base = dirname(__DIR__); $now = gmdate('c');
$project = '113b45c0-23e1-408d-ae0f-ac5eca7f6900'; $added = '723b45c0-23e1-408d-ae0f-ac5eca7f6900'; $owner = '223b45c0-23e1-408d-ae0f-ac5eca7f6900'; $device = '423b45c0-23e1-408d-ae0f-ac5eca7f6900';
putenv('AWH_CONTROL_ORIGIN=https://awh.test');
try {
    $pdo = new PDO('sqlite:' . $db, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec(file_get_contents($base . '/schema.sql'));
    foreach (['enrollment_rate_limits', 'device_project_memberships', 'device_tokens', 'pairing_projects', 'pairing_codes', 'user_project_memberships', 'device_enrollments', 'owner_bootstrap', 'hub_users'] as $table) $pdo->exec('DROP TABLE IF EXISTS ' . $table);
    $pdo->exec("INSERT INTO projects VALUES('$project', 'Unified Project', 'node', '$now', NULL, '$now', 'm8-test')");
    m8_assert(HubSchemaMigration::apply($db, $base . '/migrations/001_m3e_enrollment.sql', $now, false, $base . '/schema.sql') === 'applied', 'M3E.1');
    m8_assert(HubEnrollmentApiMigration::apply($db, $base . '/migrations/002_m3e2_enrollment_api.sql', $now) === 'applied', 'M3E.2');
    $enrollment = HubEnrollmentService::openExisting($db); $initial = $enrollment->initializeOwner($owner, 'Art Owner', [$project], $now);
    $enrolled = $enrollment->enrollDevice(['schemaVersion' => 1, 'pairingCode' => $initial['initialPairingCode'], 'deviceId' => $device, 'displayName' => 'Mac', 'platform' => 'darwin', 'arch' => 'arm64', 'appVersion' => '1.0.0'], $now);
    foreach ([[HubControlPlaneMigration::class, '003_m4_control_plane.sql'], [HubOwnerAuthMigration::class, '004_owner_auth.sql'], [HubAssistantWorkstreamMigration::class, '005_assistant_workstream.sql'], [HubWorkspaceContinuityMigration::class, '006_workspace_continuity.sql']] as [$migration, $sql]) m8_assert($migration::apply($db, $base . '/migrations/' . $sql, $now) === 'applied', $sql);
    m8_assert(HubUnifiedWorkspaceMigration::apply($db, $base . '/migrations/007_unified_workspace.sql', $now) === 'applied', 'M8 migration');
    m8_assert(HubUnifiedWorkspaceMigration::apply($db, $base . '/migrations/007_unified_workspace.sql', $now) === 'already-applied', 'M8 idempotence');
    m8_assert((int) $pdo->query('PRAGMA user_version')->fetchColumn() === 8, 'version is monotonic');
    m8_assert((int) $pdo->query("SELECT count(*) FROM awh_schema_migrations WHERE migration_id IN ('m3e.1-enrollment','m3e.2-enrollment-api','m4-control-plane','m5-owner-auth','m6-assistant-workstream','m7-workspace-continuity','m8-unified-workspace')")->fetchColumn() === 7, 'all capability ledgers remain');
    $control = HubControlPlaneService::openExisting($db);
    $pair = $enrollment->issuePairingCode($owner, [$project], $now);
    $session = m8_response($control, 'POST', '/api/v1/control/session', ['CONTENT_TYPE' => 'application/json', 'HTTP_ORIGIN' => 'https://awh.test'], ['schemaVersion' => 1, 'pairingCode' => $pair['pairingCode'], 'displayName' => 'iPhone', 'appVersion' => '1.0.0']);
    m8_assert($session['status'] === 200, 'browser session'); $cookie = m8_cookie($session, '__Host-awh_control_session'); $csrf = m8_cookie($session, 'awh_csrf'); $browser = m8_browser($cookie, $csrf);
    $created = m8_response($control, 'POST', '/api/v1/control/conversations/new', $browser, ['schemaVersion' => 2, 'projectId' => $project, 'title' => 'ตรวจโปรเจกต์']);
    m8_assert($created['status'] === 201, 'create bounded thread'); $createdBody = json_decode($created['body'], true, 32, JSON_THROW_ON_ERROR); $conversation = $createdBody['conversation']['conversationId'];
    $message = ['schemaVersion' => 2, 'projectId' => $project, 'conversationId' => $conversation, 'message' => 'สถานะ', 'idempotencyKey' => 'm8-status-0001'];
    $first = m8_response($control, 'POST', '/api/v1/control/conversations', $browser, $message); $again = m8_response($control, 'POST', '/api/v1/control/conversations', $browser, $message);
    $firstBody = json_decode($first['body'], true, 32, JSON_THROW_ON_ERROR); $againBody = json_decode($again['body'], true, 32, JSON_THROW_ON_ERROR);
    m8_assert($first['status'] === 201, 'first conversation-only request is accepted (status ' . $first['status'] . ', code ' . (string) ($firstBody['code'] ?? 'none') . ')');
    m8_assert($again['status'] === 201, 'duplicate conversation request is idempotent (status ' . $again['status'] . ', code ' . (string) ($againBody['code'] ?? 'none') . ')');
    m8_assert((int) $pdo->query("SELECT count(*) FROM control_conversation_messages WHERE conversation_id = '$conversation'")->fetchColumn() === 2, 'one submit has one canonical user/assistant sequence');
    m8_assert(str_contains($first['body'], 'สถานะโปรเจกต์') || str_contains($first['body'], 'ยังไม่มีงาน'), 'conversation-only result is human readable');
    m8_assert(m8_response($control, 'POST', '/api/v1/control/contexts', $browser, ['schemaVersion' => 2, 'projectId' => $project, 'conversationId' => $conversation, 'viewKind' => 'work', 'selectedRef' => 'task-summary', 'sourceRevision' => null])['status'] === 200, 'current view is project bound');
    m8_assert(m8_response($control, 'GET', '/api/v1/control/conversations?projectId=' . $project, ['HTTP_COOKIE' => '__Host-awh_control_session=' . $cookie, 'HTTP_SEC_FETCH_SITE' => 'same-origin'])['status'] === 200, 'thread index is authenticated');
    m8_assert(m8_response($control, 'POST', '/api/v1/control/settings', $browser, ['schemaVersion' => 2, 'settingKey' => 'tagline', 'value' => 'One Workspace. Any Trusted Device.'])['status'] === 200, 'validated owner configuration');
    m8_assert(m8_response($control, 'GET', '/api/v1/control/settings/history?settingKey=tagline', ['HTTP_COOKIE' => '__Host-awh_control_session=' . $cookie, 'HTTP_SEC_FETCH_SITE' => 'same-origin'])['status'] === 200, 'settings revision is readable');
    m8_assert(m8_response($control, 'POST', '/api/v1/control/settings/reset', $browser, ['schemaVersion' => 2, 'settingKey' => 'tagline'])['status'] === 200, 'settings reset is reversible');
    $deviceAuth = ['HTTP_AUTHORIZATION' => 'Bearer ' . $enrolled['accessToken'], 'CONTENT_TYPE' => 'application/json'];
    m8_assert(m8_response($control, 'POST', '/api/v1/control/worker/projects/bindings', $deviceAuth, ['schemaVersion' => 2, 'deviceId' => $device, 'projectId' => $project, 'workspaceLabel' => 'Unified Project', 'sourceFingerprint' => null, 'capabilities' => ['project:context', 'git:read']])['status'] === 200, 'device binding has no path');
    m8_assert(m8_response($control, 'POST', '/api/v1/control/worker/projects/register', $deviceAuth, ['schemaVersion' => 2, 'deviceId' => $device, 'project' => ['projectId' => $added, 'name' => 'Second Project', 'type' => 'node', 'sourceRevision' => null]])['status'] === 201, 'owner adds one portable project');
    $export = m8_response($control, 'GET', '/api/v1/control/export', ['HTTP_COOKIE' => '__Host-awh_control_session=' . $cookie, 'HTTP_SEC_FETCH_SITE' => 'same-origin']);
    m8_assert($export['status'] === 200 && str_contains($export['body'], 'secretsIncluded') && !str_contains($export['body'], 'accessToken') && !str_contains($export['body'], 'workspacePath'), 'safe logical export');
    m8_assert($pdo->query('PRAGMA integrity_check')->fetchColumn() === 'ok' && $pdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'integrity');
    fwrite(STDOUT, "AWH M8 unified workspace: PASS\n");
} finally { putenv('AWH_CONTROL_ORIGIN'); @unlink($db); @rmdir($root); }
