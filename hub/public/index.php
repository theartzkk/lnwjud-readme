<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubReadModel.php';
require_once dirname(__DIR__) . '/src/HubReadRouter.php';

$model = null;
try {
    $model = HubReadModel::openFromEnvironment(true);
} catch (Throwable) {
    // The router returns a bounded 503 without exposing filesystem or PDO details.
}

$response = HubReadRouter::dispatch(
    (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'),
    (string) ($_SERVER['REQUEST_URI'] ?? '/'),
    $_SERVER,
    $model,
);

http_response_code($response['status']);
foreach ($response['headers'] as $name => $value) {
    header($name . ': ' . $value);
}
echo $response['body'];
