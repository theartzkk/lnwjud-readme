<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubReadModel.php';
require_once dirname(__DIR__) . '/src/HubReadRouter.php';

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
    @rmdir($root);
}
