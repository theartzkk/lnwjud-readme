<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubSchemaMigration.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentApiMigration.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneMigration.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneService.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentRouter.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneRouter.php';

function compatibility_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function compatibility_json(array $value): string { return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR); }
function compatibility_response(HubEnrollmentService $service, string $method, string $uri, array $server, array $body): array { return HubEnrollmentRouter::dispatch($method, $uri, $server, $service, compatibility_json($body)); }
function compatibility_control(HubControlPlaneService $service, string $method, string $uri, array $server, array $body): array { return HubControlPlaneRouter::dispatch($method, $uri, $server, $service, compatibility_json($body)); }
function compatibility_cookie(array $response, string $name): string { foreach (($response['headers']['Set-Cookie'] ?? []) as $line) if (str_starts_with($line, $name . '=')) return explode(';', substr($line, strlen($name) + 1), 2)[0]; throw new RuntimeException('session cookie missing'); }

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { fwrite(STDOUT, "AWH M3E-after-M4 compatibility: SKIP pdo_sqlite extension unavailable\n"); exit(77); }

$root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'awh-m3e-m4-' . bin2hex(random_bytes(6));
mkdir($root, 0700, true);
$database = $root . '/awh.sqlite';
$zeroDatabase = $root . '/awh-zero.sqlite';
$schema = dirname(__DIR__) . '/schema.sql';
$m3e1 = dirname(__DIR__) . '/migrations/001_m3e_enrollment.sql';
$m3e2 = dirname(__DIR__) . '/migrations/002_m3e2_enrollment_api.sql';
$m4 = dirname(__DIR__) . '/migrations/003_m4_control_plane.sql';
$projectId = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
$ownerId = '223b45c0-23e1-408d-ae0f-ac5eca7f6900';
$macId = '423b45c0-23e1-408d-ae0f-ac5eca7f6900';
$now = '2026-08-22T00:00:00.000Z';

try {
    $pdo = new PDO('sqlite:' . $database, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec(file_get_contents($schema));
    foreach (['enrollment_rate_limits', 'device_project_memberships', 'device_tokens', 'pairing_projects', 'pairing_codes', 'user_project_memberships', 'device_enrollments', 'owner_bootstrap', 'hub_users'] as $table) $pdo->exec('DROP TABLE IF EXISTS ' . $table);
    $pdo->exec("INSERT INTO projects VALUES('$projectId', 'Compatibility Project', 'node', '$now', NULL, '$now', 'compatibility-test')");
    compatibility_assert(HubSchemaMigration::apply($database, $m3e1, $now, false, $schema) === 'applied', 'M3E.1 must apply');
    compatibility_assert(HubEnrollmentApiMigration::apply($database, $m3e2, $now) === 'applied', 'M3E.2 must apply');
    $enrollment = HubEnrollmentService::openExisting($database);
    $bootstrap = $enrollment->initializeOwner($ownerId, 'Owner', [$projectId], $now);
    $device = $enrollment->enrollDevice(['schemaVersion' => 1, 'pairingCode' => $bootstrap['initialPairingCode'], 'deviceId' => $macId, 'displayName' => 'Mac owner', 'platform' => 'darwin', 'arch' => 'arm64', 'appVersion' => '1.0.0'], $now);
    compatibility_assert(HubControlPlaneMigration::apply($database, $m4, $now) === 'applied', 'M4 must apply after enrollment data exists');
    compatibility_assert((int) $pdo->query('PRAGMA user_version')->fetchColumn() === 4, 'shared database must remain at v4');
    try {
        HubEnrollmentApiMigration::apply($database, $m3e2, $now);
        throw new RuntimeException('historical M3E.2 migration must not replay on v4');
    } catch (HubEnrollmentApiMigrationException $error) {
        compatibility_assert($error->codeName === 'SCHEMA_VERSION_MISMATCH', 'v4 must be rejected by the historical apply path');
    }
    compatibility_assert((int) $pdo->query('PRAGMA user_version')->fetchColumn() === 4, 'historical migration must never downgrade v4');

    $invalid = compatibility_response($enrollment, 'POST', '/api/v1/enrollment/pairing-codes', ['CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => 'Bearer invalid-regression-token'], ['schemaVersion' => 1, 'projectIds' => [], 'ttlSeconds' => 600]);
    compatibility_assert($invalid['status'] === 401, 'v4 invalid bearer must be an auth failure, not schema-not-ready');
    compatibility_assert(!str_contains($invalid['body'], 'ENROLLMENT_SCHEMA_NOT_READY'), 'v4 auth probe must not report stale schema readiness');
    $projectPairing = compatibility_response($enrollment, 'POST', '/api/v1/enrollment/pairing-codes', ['CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => 'Bearer ' . $device['accessToken']], ['schemaVersion' => 1, 'projectIds' => [$projectId], 'ttlSeconds' => 600]);
    compatibility_assert($projectPairing['status'] === 200, 'project-scoped pairing must work at v4');
    $projectPayload = json_decode($projectPairing['body'], true, 32, JSON_THROW_ON_ERROR);
    compatibility_assert(($projectPayload['projectCount'] ?? null) === 1, 'project scope must remain bound');
    compatibility_assert((int) $pdo->query('SELECT COUNT(*) FROM pairing_codes')->fetchColumn() === 2, 'bootstrap and project pairing must be the only codes in the project fixture');

    putenv('AWH_CONTROL_ORIGIN=https://awh.test');
    $projectSession = compatibility_control(HubControlPlaneService::openExisting($database), 'POST', '/api/v1/control/session', ['CONTENT_TYPE' => 'application/json', 'HTTP_ORIGIN' => 'https://awh.test'], ['schemaVersion' => 1, 'pairingCode' => $projectPayload['pairingCode'], 'displayName' => 'iPhone', 'appVersion' => '1.0.0']);
    compatibility_assert($projectSession['status'] === 200 && !str_contains($projectSession['body'], 'sessionToken'), 'project pairing must become an HTTP-only control session');
    $projectCookie = compatibility_cookie($projectSession, '__Host-awh_control_session');
    $projectState = compatibility_control(HubControlPlaneService::openExisting($database), 'GET', '/api/v1/control/projects', ['HTTP_ORIGIN' => 'https://awh.test', 'HTTP_COOKIE' => '__Host-awh_control_session=' . $projectCookie], []);
    compatibility_assert($projectState['status'] === 200 && str_contains($projectState['body'], $projectId), 'project session must consume project scope');
    // A zero-project pairing is proven on a separate fresh owner fixture. This
    // reflects the real product rule: a scope-less owner pairing grants no
    // projects, while a project-scoped owner pairing keeps its explicit scope.
    $zeroPdo = new PDO('sqlite:' . $zeroDatabase, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $zeroPdo->exec(file_get_contents($schema));
    foreach (['enrollment_rate_limits', 'device_project_memberships', 'device_tokens', 'pairing_projects', 'pairing_codes', 'user_project_memberships', 'device_enrollments', 'owner_bootstrap', 'hub_users'] as $table) $zeroPdo->exec('DROP TABLE IF EXISTS ' . $table);
    compatibility_assert(HubSchemaMigration::apply($zeroDatabase, $m3e1, $now, false, $schema) === 'applied', 'zero-project M3E.1 must apply');
    compatibility_assert(HubEnrollmentApiMigration::apply($zeroDatabase, $m3e2, $now) === 'applied', 'zero-project M3E.2 must apply');
    $zeroEnrollment = HubEnrollmentService::openExisting($zeroDatabase);
    $zeroBootstrap = $zeroEnrollment->initializeOwner('623b45c0-23e1-408d-ae0f-ac5eca7f6900', 'Empty Owner', [], $now);
    $zeroDevice = $zeroEnrollment->enrollDevice(['schemaVersion' => 1, 'pairingCode' => $zeroBootstrap['initialPairingCode'], 'deviceId' => '723b45c0-23e1-408d-ae0f-ac5eca7f6900', 'displayName' => 'Mac empty', 'platform' => 'darwin', 'arch' => 'arm64', 'appVersion' => '1.0.0'], $now);
    compatibility_assert(HubControlPlaneMigration::apply($zeroDatabase, $m4, $now) === 'applied', 'zero-project M4 must apply');
    $zeroPairing = compatibility_response($zeroEnrollment, 'POST', '/api/v1/enrollment/pairing-codes', ['CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => 'Bearer ' . $zeroDevice['accessToken']], ['schemaVersion' => 1, 'projectIds' => [], 'ttlSeconds' => 600]);
    compatibility_assert($zeroPairing['status'] === 200, 'zero-project pairing must work at v4');
    $zeroPayload = json_decode($zeroPairing['body'], true, 32, JSON_THROW_ON_ERROR);
    compatibility_assert(($zeroPayload['projectCount'] ?? null) === 0, 'zero-project scope must remain empty');
    $zeroSession = compatibility_control(HubControlPlaneService::openExisting($zeroDatabase), 'POST', '/api/v1/control/session', ['CONTENT_TYPE' => 'application/json', 'HTTP_ORIGIN' => 'https://awh.test'], ['schemaVersion' => 1, 'pairingCode' => $zeroPayload['pairingCode'], 'displayName' => 'iPhone empty', 'appVersion' => '1.0.0']);
    compatibility_assert($zeroSession['status'] === 200 && !str_contains($zeroSession['body'], 'sessionToken'), 'zero-project pairing must become a control session');
    $zeroCookie = compatibility_cookie($zeroSession, '__Host-awh_control_session');
    $zeroState = compatibility_control(HubControlPlaneService::openExisting($zeroDatabase), 'GET', '/api/v1/control/projects', ['HTTP_ORIGIN' => 'https://awh.test', 'HTTP_COOKIE' => '__Host-awh_control_session=' . $zeroCookie], []);
    compatibility_assert($zeroState['status'] === 200 && json_decode($zeroState['body'], true, 32, JSON_THROW_ON_ERROR)['projects'] === [], 'zero-project session must expose an empty project list');
    $zeroCsrfState = compatibility_control(HubControlPlaneService::openExisting($zeroDatabase), 'GET', '/api/v1/control/session', ['HTTP_ORIGIN' => 'https://awh.test', 'HTTP_COOKIE' => '__Host-awh_control_session=' . $zeroCookie], []);
    $zeroCsrf = json_decode($zeroCsrfState['body'], true, 32, JSON_THROW_ON_ERROR)['csrfToken'];
    $noTask = compatibility_control(HubControlPlaneService::openExisting($zeroDatabase), 'POST', '/api/v1/control/tasks', ['CONTENT_TYPE' => 'application/json', 'HTTP_ORIGIN' => 'https://awh.test', 'HTTP_COOKIE' => '__Host-awh_control_session=' . $zeroCookie, 'HTTP_X_AWH_CSRF' => $zeroCsrf], ['schemaVersion' => 1, 'projectId' => $projectId, 'goal' => 'must not submit', 'idempotencyKey' => 'empty-project-0001']);
    compatibility_assert($noTask['status'] === 403, 'zero-project session must not submit a task');
    $replay = compatibility_control(HubControlPlaneService::openExisting($database), 'POST', '/api/v1/control/session', ['CONTENT_TYPE' => 'application/json', 'HTTP_ORIGIN' => 'https://awh.test'], ['schemaVersion' => 1, 'pairingCode' => $projectPayload['pairingCode'], 'displayName' => 'Replay', 'appVersion' => '1.0.0']);
    compatibility_assert($replay['status'] === 409, 'pairing replay must fail after v4');

    $hashes = $pdo->query('SELECT code_hash FROM pairing_codes')->fetchAll(PDO::FETCH_COLUMN);
    $tokenHashes = $pdo->query('SELECT token_hash FROM device_tokens')->fetchAll(PDO::FETCH_COLUMN);
    compatibility_assert(!in_array($projectPayload['pairingCode'], $hashes, true) && !in_array($zeroPayload['pairingCode'], $hashes, true), 'plaintext pairing codes must not be stored');
    compatibility_assert(!in_array($device['accessToken'], $tokenHashes, true), 'plaintext device token must not be stored');
    compatibility_assert((int) $pdo->query("SELECT COUNT(*) FROM hub_users WHERE user_id = '$ownerId'")->fetchColumn() === 1, 'owner must survive M4');
    compatibility_assert((int) $pdo->query("SELECT COUNT(*) FROM device_enrollments WHERE device_id = '$macId' AND revoked_at IS NULL")->fetchColumn() === 1, 'device enrollment must survive M4');
    compatibility_assert((int) $pdo->query("SELECT COUNT(*) FROM user_project_memberships WHERE user_id = '$ownerId' AND project_id = '$projectId' AND revoked_at IS NULL")->fetchColumn() === 1, 'project membership must survive M4');
    compatibility_assert($pdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'M3E/M4 foreign keys must remain clean');

    $corruptDatabase = $root . '/awh-corrupt.sqlite';
    copy($database, $corruptDatabase);
    $corrupt = new PDO('sqlite:' . $corruptDatabase, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $corrupt->exec('DROP TABLE enrollment_rate_limits');
    try {
        HubEnrollmentService::openExisting($corruptDatabase)->assertApiSchemaReady();
        throw new RuntimeException('corrupt enrollment schema must fail closed');
    } catch (HubEnrollmentException $error) {
        compatibility_assert($error->codeName === 'ENROLLMENT_SCHEMA_NOT_READY', 'corrupt enrollment schema must use the sanitized readiness error');
    }
    $corrupt->exec("UPDATE awh_schema_migrations SET checksum = '" . str_repeat('0', 64) . "' WHERE migration_id = 'm3e.2-enrollment-api'");
    try {
        HubEnrollmentApiMigration::verifyDatabase($corruptDatabase, $m3e2);
        throw new RuntimeException('corrupt M3E.2 ledger must fail closed');
    } catch (HubEnrollmentApiMigrationException $error) {
        compatibility_assert($error->codeName === 'MIGRATION_RECORD_INVALID' || $error->codeName === 'SCHEMA_VERIFY_FAILED', 'corrupt M3E.2 ledger must be rejected');
    }
    fwrite(STDOUT, "AWH M3E-after-M4 compatibility: PASS\n");
} finally {
    putenv('AWH_CONTROL_ORIGIN');
    @unlink($database);
    @unlink($zeroDatabase);
    @unlink($root . '/awh-corrupt.sqlite');
    @rmdir($root);
}
