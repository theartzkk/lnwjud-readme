<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubReadModel.php';
require_once dirname(__DIR__) . '/src/HubReadRouter.php';
require_once dirname(__DIR__) . '/src/HubWebGateway.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentService.php';

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDOUT, "AWH PHP Hub read foundation: SKIP pdo_sqlite extension unavailable\n");
    exit(77);
}

function test_assert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function test_throws(callable $callback, string $message): void
{
    try {
        $callback();
    } catch (Throwable) {
        return;
    }
    throw new RuntimeException($message);
}

$root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'awh-hub-test-' . bin2hex(random_bytes(6));
$workspace = $root . DIRECTORY_SEPARATOR . 'project';
$outside = $root . DIRECTORY_SEPARATOR . 'outside-secret.txt';
$database = $root . DIRECTORY_SEPARATOR . 'awh.sqlite';
mkdir($workspace . DIRECTORY_SEPARATOR . '.awh', 0700, true);
file_put_contents($outside, 'outside-only');
file_put_contents($workspace . DIRECTORY_SEPARATOR . '.awh' . DIRECTORY_SEPARATOR . 'project.json', json_encode([
    'schemaVersion' => 1,
    'projectId' => '113b45c0-23e1-408d-ae0f-ac5eca7f6900',
    'name' => 'Art’s Workspace Hub',
    'type' => 'node',
    'createdAt' => '2026-01-01T00:00:00.000Z',
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
foreach (HubReadModel::MEMORY_FILES as $file) {
    file_put_contents($workspace . DIRECTORY_SEPARATOR . $file, '# ' . $file . "\n");
}

try {
    $model = HubReadModel::open($database);
    $model->initializeSchema(dirname(__DIR__) . '/schema.sql');
    $manifest = $model->indexLocalProject($workspace);
    test_assert($manifest['projectId'] === '113b45c0-23e1-408d-ae0f-ac5eca7f6900', 'current project ID must remain stable');
    test_assert($model->projects()['projects'][0]['name'] === 'Art’s Workspace Hub', 'portable project name must be indexed');
    $memory = $model->memory($manifest['projectId']);
    test_assert(array_key_first($memory['files']) === 'CURRENT_STATE.md' && $memory['files']['CURRENT_STATE.md']['status'] === 'present', 'CURRENT_STATE metadata must be first and present');
    test_assert($memory['files']['HANDOFF.md']['status'] === 'present', 'HANDOFF metadata must be present');
    test_assert(!array_key_exists('content', $memory) && $memory['handoffSummary'] === null, 'Hub read foundation must not duplicate memory content');
    $encoded = json_encode([$model->projects(), $memory], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    test_assert(!str_contains($encoded, $workspace) && !str_contains($encoded, 'outside-secret'), 'responses must not contain local paths');

    $schema = file_get_contents(dirname(__DIR__) . '/schema.sql');
    test_assert(is_string($schema) && !preg_match('/workspace_path|content\s+TEXT/i', $schema), 'Hub schema must not store workspace paths or content');

    $token = 'test-only-read-token';
    putenv('AWH_HUB_READ_TOKEN_HASH=' . hash('sha256', $token));
    $readModel = HubReadModel::open($database, true);
    $health = HubReadRouter::dispatch('GET', '/api/v1/health', [], $readModel);
    test_assert($health['status'] === 200, 'health must be readable without bearer auth');
    $unauthorized = HubReadRouter::dispatch('GET', '/api/v1/projects', [], $readModel);
    test_assert($unauthorized['status'] === 401, 'domain reads must require bearer auth');
    $authorized = HubReadRouter::dispatch('GET', '/api/v1/projects', ['HTTP_AUTHORIZATION' => 'Bearer ' . $token], $readModel);
    test_assert($authorized['status'] === 200 && !str_contains($authorized['body'], $workspace), 'authorized project read must be sanitized');
    $method = HubReadRouter::dispatch('POST', '/api/v1/projects', ['HTTP_AUTHORIZATION' => 'Bearer ' . $token], $readModel);
    test_assert($method['status'] === 405, 'write methods must be rejected');
    $queryCredential = HubReadRouter::dispatch('GET', '/api/v1/projects?access_token=secret', ['HTTP_AUTHORIZATION' => 'Bearer ' . $token], $readModel);
    test_assert($queryCredential['status'] === 400, 'credentials in URLs must be rejected');
    $unknown = HubReadRouter::dispatch('GET', '/api/v1/projects/' . $manifest['projectId'] . '/../../etc/passwd', ['HTTP_AUTHORIZATION' => 'Bearer ' . $token], $readModel);
    test_assert($unknown['status'] === 404, 'arbitrary path access must be rejected');
    test_assert(!HubWebGateway::isTrusted([]), 'web gateway must fail closed without the server perimeter');
    test_assert(!HubWebGateway::isTrusted(['HTTP_X_AWH_WEB_GATEWAY_TRUSTED_PERIMETER' => 'nginx']), 'client HTTP headers must not establish gateway trust');
    test_assert(HubWebGateway::isTrusted(['AWH_WEB_GATEWAY_TRUSTED_PERIMETER' => 'nginx']), 'reviewed Nginx FastCGI perimeter must establish gateway trust');
    $gatewayRead = HubReadRouter::dispatch('GET', '/api/v1/projects', ['AWH_WEB_GATEWAY_TRUSTED_PERIMETER' => 'nginx'], $readModel, false);
    test_assert($gatewayRead['status'] === 200 && !str_contains($gatewayRead['body'], $workspace), 'trusted web gateway must expose only sanitized read data');

    $otherWorkspace = $root . DIRECTORY_SEPARATOR . 'other-project';
    mkdir($otherWorkspace . DIRECTORY_SEPARATOR . '.awh', 0700, true);
    file_put_contents($otherWorkspace . DIRECTORY_SEPARATOR . '.awh' . DIRECTORY_SEPARATOR . 'project.json', json_encode([
        'schemaVersion' => 1,
        'projectId' => '523b45c0-23e1-408d-ae0f-ac5eca7f6900',
        'name' => 'Other Project',
        'type' => 'node',
        'createdAt' => '2026-01-01T00:00:00.000Z',
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    $model->indexLocalProject($otherWorkspace);
    $enrollment = HubEnrollmentService::open($database, dirname(__DIR__) . '/schema.sql');
    $ownerId = '623b45c0-23e1-408d-ae0f-ac5eca7f6900';
    $enrollment->initializeOwner($ownerId, 'Art', [$manifest['projectId']], '2026-08-19T00:00:00.000Z');
    test_throws(fn () => $enrollment->initializeOwner('723b45c0-23e1-408d-ae0f-ac5eca7f6900', 'Second Owner', [], '2026-08-19T00:00:00.000Z'), 'owner bootstrap must not reopen');
    $expired = $enrollment->issuePairingCode($ownerId, [$manifest['projectId']], '2026-08-19T00:00:00.000Z', 1);
    test_throws(fn () => $enrollment->enrollDevice([
        'schemaVersion' => 1, 'pairingCode' => $expired['pairingCode'], 'deviceId' => '823b45c0-23e1-408d-ae0f-ac5eca7f6900', 'displayName' => 'Expired', 'platform' => 'darwin', 'arch' => 'arm64', 'appVersion' => '0.4.0',
    ], '2026-08-19T00:00:02.000Z'), 'expired pairing code must fail closed');
    test_throws(fn () => $enrollment->enrollDevice([
        'schemaVersion' => 1, 'pairingCode' => 'malformed', 'deviceId' => '823b45c0-23e1-408d-ae0f-ac5eca7f6900', 'displayName' => 'Malformed', 'platform' => 'darwin', 'arch' => 'arm64', 'appVersion' => '0.4.0',
    ], '2026-08-19T00:00:00.000Z'), 'malformed pairing code must fail closed');
    $pairing = $enrollment->issuePairingCode($ownerId, [$manifest['projectId']], '2026-08-19T00:00:00.000Z');
    $enrolled = $enrollment->enrollDevice([
        'schemaVersion' => 1, 'pairingCode' => $pairing['pairingCode'], 'deviceId' => '823b45c0-23e1-408d-ae0f-ac5eca7f6900', 'displayName' => 'School Mac', 'platform' => 'darwin', 'arch' => 'arm64', 'appVersion' => '0.4.0',
    ], '2026-08-19T00:00:01.000Z');
    test_assert(isset($enrolled['accessToken']) && !str_contains(json_encode($model->devices()), $enrolled['accessToken']), 'device token must never appear in sanitized device metadata');
    test_throws(fn () => $enrollment->enrollDevice([
        'schemaVersion' => 1, 'pairingCode' => $pairing['pairingCode'], 'deviceId' => '923b45c0-23e1-408d-ae0f-ac5eca7f6900', 'displayName' => 'Replay', 'platform' => 'win32', 'arch' => 'x64', 'appVersion' => '0.4.0',
    ], '2026-08-19T00:00:02.000Z'), 'pairing code replay must fail closed');
    $duplicatePairing = $enrollment->issuePairingCode($ownerId, [$manifest['projectId']], '2026-08-19T00:00:03.000Z');
    test_throws(fn () => $enrollment->enrollDevice([
        'schemaVersion' => 1, 'pairingCode' => $duplicatePairing['pairingCode'], 'deviceId' => '823b45c0-23e1-408d-ae0f-ac5eca7f6900', 'displayName' => 'Duplicate', 'platform' => 'win32', 'arch' => 'x64', 'appVersion' => '0.4.0',
    ], '2026-08-19T00:00:04.000Z'), 'duplicate device enrollment must fail closed');
    test_throws(fn () => $enrollment->rotateToken($enrolled['accessToken'], '923b45c0-23e1-408d-ae0f-ac5eca7f6900', '2026-08-19T00:00:05.000Z'), 'forged device ID must fail closed');
    $rotated = $enrollment->rotateToken($enrolled['accessToken'], $enrolled['deviceId'], '2026-08-19T00:00:05.000Z');
    test_throws(fn () => $enrollment->assertProjectAccess($enrolled['accessToken'], $manifest['projectId'], '2026-08-19T00:00:06.000Z'), 'rotated credential must reject the old token');
    test_assert($enrollment->assertProjectAccess($rotated['accessToken'], $manifest['projectId'], '2026-08-19T00:00:06.000Z')['projectId'] === $manifest['projectId'], 'active rotated credential must authorize its permitted project');
    test_throws(fn () => $enrollment->assertProjectAccess($rotated['accessToken'], '523b45c0-23e1-408d-ae0f-ac5eca7f6900', '2026-08-19T00:00:06.000Z'), 'cross-project authorization must fail closed');
    $enrollment->revokeToken($rotated['accessToken'], $enrolled['deviceId'], '2026-08-19T00:00:07.000Z');
    test_throws(fn () => $enrollment->assertProjectAccess($rotated['accessToken'], $manifest['projectId'], '2026-08-19T00:00:08.000Z'), 'revoked credential must fail closed');
    $deviceJson = json_encode($model->devices(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    test_assert(is_string($deviceJson) && !preg_match('/accessToken|tokenHash|pairingCode|password|secret|workspacePath|\/Users\/|[A-Za-z]:\\\\/i', $deviceJson), 'device read metadata must not leak secrets or local paths');

    $before = count($model->projects()['projects']);
    $badWorkspace = $root . DIRECTORY_SEPARATOR . 'bad';
    mkdir($badWorkspace . DIRECTORY_SEPARATOR . '.awh', 0700, true);
    file_put_contents($badWorkspace . DIRECTORY_SEPARATOR . '.awh' . DIRECTORY_SEPARATOR . 'project.json', '{"schemaVersion":1,"projectId":"not-valid"}');
    test_throws(fn () => $model->indexLocalProject($badWorkspace), 'malformed manifest must fail closed');
    test_assert(count($model->projects()['projects']) === $before, 'failed indexing must not partially mutate the read index');

    unlink($workspace . DIRECTORY_SEPARATOR . 'HANDOFF.md');
    if (function_exists('symlink') && @symlink($outside, $workspace . DIRECTORY_SEPARATOR . 'HANDOFF.md')) {
        test_throws(fn () => $model->indexLocalProject($workspace), 'memory symlink escape must fail closed');
    }
    fwrite(STDOUT, "AWH PHP Hub read foundation: PASS\n");
} finally {
    putenv('AWH_HUB_READ_TOKEN_HASH');
    foreach (HubReadModel::MEMORY_FILES as $file) {
        $path = $workspace . DIRECTORY_SEPARATOR . $file;
        if (is_link($path) || is_file($path)) @unlink($path);
    }
    @unlink($workspace . DIRECTORY_SEPARATOR . '.awh' . DIRECTORY_SEPARATOR . 'project.json');
    @rmdir($workspace . DIRECTORY_SEPARATOR . '.awh');
    @rmdir($workspace);
    @unlink($outside);
    @unlink($database);
    @rmdir($badWorkspace ?? '');
    @rmdir(($badWorkspace ?? '') . DIRECTORY_SEPARATOR . '.awh');
    @unlink(($otherWorkspace ?? '') . DIRECTORY_SEPARATOR . '.awh' . DIRECTORY_SEPARATOR . 'project.json');
    @rmdir(($otherWorkspace ?? '') . DIRECTORY_SEPARATOR . '.awh');
    @rmdir($otherWorkspace ?? '');
    @rmdir($root);
}
