<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubEnrollmentService.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentRouter.php';

function api_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function api_json(array $value): string { return json_encode($value === [] ? (object) [] : $value, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR); }
function api_server(array $extra = []): array { return array_merge(['CONTENT_TYPE' => 'application/json'], $extra); }
function api_response(HubEnrollmentService $service, string $method, string $uri, array $server, array $body): array { return HubEnrollmentRouter::dispatch($method, $uri, $server, $service, api_json($body)); }

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { fwrite(STDOUT, "AWH enrollment API tests: SKIP pdo_sqlite extension unavailable\n"); exit(77); }

$root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'awh-enrollment-api-' . bin2hex(random_bytes(6));
mkdir($root, 0700, true);
$database = $root . DIRECTORY_SEPARATOR . 'awh.sqlite';
$schema = dirname(__DIR__) . '/schema.sql';
$projectId = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
$ownerId = '223b45c0-23e1-408d-ae0f-ac5eca7f6900';

try {
    $pdo = new PDO('sqlite:' . $database, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec(file_get_contents($schema));
    $pdo->exec("INSERT INTO projects VALUES('$projectId', 'Art’s Workspace Hub', 'node', '2026-01-01T00:00:00.000Z', NULL, '2026-08-20T00:00:00.000Z', 'api-test')");
    $service = HubEnrollmentService::open($database, $schema);
    putenv('AWH_ENROLLMENT_BOOTSTRAP_NONCE_HASH=' . hash('sha256', 'bootstrap-test-only'));

    $origin = api_response($service, 'POST', '/api/v1/enrollment/bootstrap', api_server(['HTTP_ORIGIN' => 'https://evil.example', 'HTTP_X_AWH_BOOTSTRAP_NONCE' => 'bootstrap-test-only']), ['schemaVersion' => 1, 'userId' => $ownerId, 'displayName' => 'Art', 'projectIds' => [$projectId]]);
    api_assert($origin['status'] === 403, 'browser Origin must not reach enrollment bootstrap');
    $unauthenticated = api_response($service, 'POST', '/api/v1/enrollment/bootstrap', api_server(), ['schemaVersion' => 1, 'userId' => $ownerId, 'displayName' => 'Art', 'projectIds' => [$projectId]]);
    api_assert($unauthenticated['status'] === 503, 'bootstrap without configured approval must fail closed');
    $bootstrap = api_response($service, 'POST', '/api/v1/enrollment/bootstrap', api_server(['HTTP_X_AWH_BOOTSTRAP_NONCE' => 'bootstrap-test-only']), ['schemaVersion' => 1, 'userId' => $ownerId, 'displayName' => 'Art', 'projectIds' => [$projectId]]);
    api_assert($bootstrap['status'] === 200 && !str_contains($bootstrap['body'], 'accessToken'), 'bootstrap must not issue a browser token');
    $reopen = api_response($service, 'POST', '/api/v1/enrollment/bootstrap', api_server(['HTTP_X_AWH_BOOTSTRAP_NONCE' => 'bootstrap-test-only']), ['schemaVersion' => 1, 'userId' => '323b45c0-23e1-408d-ae0f-ac5eca7f6900', 'displayName' => 'Other', 'projectIds' => []]);
    api_assert($reopen['status'] === 409, 'bootstrap reopening must fail closed');

    $ownerPairing = $service->issuePairingCode($ownerId, [$projectId]);
    $ownerDevice = $service->enrollDevice(['schemaVersion' => 1, 'pairingCode' => $ownerPairing['pairingCode'], 'deviceId' => '423b45c0-23e1-408d-ae0f-ac5eca7f6900', 'displayName' => 'Owner Device', 'platform' => 'darwin', 'arch' => 'arm64', 'appVersion' => '0.4.0']);
    $pairing = api_response($service, 'POST', '/api/v1/enrollment/pairing-codes', api_server(['HTTP_AUTHORIZATION' => 'Bearer ' . $ownerDevice['accessToken']]), ['schemaVersion' => 1, 'projectIds' => [$projectId], 'ttlSeconds' => 600]);
    api_assert($pairing['status'] === 200 && str_contains($pairing['body'], 'pairingCode'), 'owner must be able to create a bounded pairing code');
    $pairingPayload = json_decode($pairing['body'], true, 32, JSON_THROW_ON_ERROR);
    $targetId = '523b45c0-23e1-408d-ae0f-ac5eca7f6900';
    $consume = api_response($service, 'POST', '/api/v1/enrollment/devices', api_server(), ['schemaVersion' => 1, 'pairingCode' => $pairingPayload['pairingCode'], 'deviceId' => $targetId, 'displayName' => 'Windows PC', 'platform' => 'win32', 'arch' => 'x64', 'appVersion' => '0.4.0']);
    api_assert($consume['status'] === 200 && str_contains($consume['body'], 'accessToken'), 'device consume must issue a credential only on the enrollment API');
    $target = json_decode($consume['body'], true, 32, JSON_THROW_ON_ERROR);
    api_assert(!str_contains($pairing['body'], $target['accessToken']), 'pairing response must not contain the device credential');
    $replay = api_response($service, 'POST', '/api/v1/enrollment/devices', api_server(), ['schemaVersion' => 1, 'pairingCode' => $pairingPayload['pairingCode'], 'deviceId' => '623b45c0-23e1-408d-ae0f-ac5eca7f6900', 'displayName' => 'Replay', 'platform' => 'win32', 'arch' => 'x64', 'appVersion' => '0.4.0']);
    api_assert($replay['status'] === 409, 'pairing replay must be rejected');
    $forgedRotate = api_response($service, 'POST', '/api/v1/enrollment/token/rotate', api_server(['HTTP_AUTHORIZATION' => 'Bearer ' . $target['accessToken']]), ['schemaVersion' => 1, 'deviceId' => '623b45c0-23e1-408d-ae0f-ac5eca7f6900']);
    api_assert($forgedRotate['status'] === 401, 'forged device identity must be rejected');
    $rotated = api_response($service, 'POST', '/api/v1/enrollment/token/rotate', api_server(['HTTP_AUTHORIZATION' => 'Bearer ' . $target['accessToken']]), ['schemaVersion' => 1, 'deviceId' => $targetId]);
    api_assert($rotated['status'] === 200, 'device credential rotation must work');
    $revoked = api_response($service, 'POST', '/api/v1/enrollment/devices/' . $targetId . '/revoke', api_server(['HTTP_AUTHORIZATION' => 'Bearer ' . $ownerDevice['accessToken']]), []);
    api_assert($revoked['status'] === 200, 'owner must be able to revoke a device');
    $afterRevoke = api_response($service, 'POST', '/api/v1/enrollment/token/rotate', api_server(['HTTP_AUTHORIZATION' => 'Bearer ' . json_decode($rotated['body'], true)['accessToken']]), ['schemaVersion' => 1, 'deviceId' => $targetId]);
    api_assert($afterRevoke['status'] === 401, 'revoked device credential must fail closed');
    for ($i = 0; $i < 5; $i++) api_response($service, 'POST', '/api/v1/enrollment/devices', api_server(), ['schemaVersion' => 1, 'pairingCode' => 'B'.str_repeat('x', 31), 'deviceId' => '723b45c0-23e1-408d-ae0f-ac5eca7f6900', 'displayName' => 'Rate Test', 'platform' => 'win32', 'arch' => 'x64', 'appVersion' => '0.4.0']);
    $limited = api_response($service, 'POST', '/api/v1/enrollment/devices', api_server(), ['schemaVersion' => 1, 'pairingCode' => 'B'.str_repeat('x', 31), 'deviceId' => '723b45c0-23e1-408d-ae0f-ac5eca7f6900', 'displayName' => 'Rate Test', 'platform' => 'win32', 'arch' => 'x64', 'appVersion' => '0.4.0']);
    api_assert($limited['status'] === 429, 'pairing attempts must be throttled');
    $rows = $pdo->query('SELECT code_hash FROM pairing_codes')->fetchAll(PDO::FETCH_COLUMN);
    $tokens = $pdo->query('SELECT token_hash FROM device_tokens')->fetchAll(PDO::FETCH_COLUMN);
    api_assert(!in_array($pairingPayload['pairingCode'], $rows, true) && !in_array($target['accessToken'], $tokens, true), 'plaintext code/token must not be stored');
    fwrite(STDOUT, "AWH enrollment API tests: PASS\n");
} finally {
    putenv('AWH_ENROLLMENT_BOOTSTRAP_NONCE_HASH');
    @unlink($database); @rmdir($root);
}
