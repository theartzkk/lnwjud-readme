<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubReadModel.php';

if ($argc !== 2 || $argv[1] === '' || str_starts_with($argv[1], '-')) {
    fwrite(STDERR, "Usage: php hub/bin/index-project.php /absolute/project/workspace\n");
    exit(2);
}

try {
    $model = HubReadModel::openFromEnvironment(false);
    $model->initializeSchema(dirname(__DIR__) . '/schema.sql');
    $manifest = $model->indexLocalProject($argv[1]);
    fwrite(STDOUT, json_encode(['ok' => true, 'projectId' => $manifest['projectId'], 'name' => $manifest['name'], 'type' => $manifest['type']], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
} catch (Throwable) {
    fwrite(STDERR, "AWH Hub project metadata indexing failed\n");
    exit(1);
}
