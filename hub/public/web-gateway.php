<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubReadModel.php';
require_once dirname(__DIR__) . '/src/HubReadRouter.php';
require_once dirname(__DIR__) . '/src/HubWebGateway.php';

// This is intentionally not an HTTP header. Nginx sets the FastCGI parameter
// in the reviewed server template, and PHP-FPM is reachable only by Unix
// socket. Direct invocation fails closed.
if (!HubWebGateway::isTrusted($_SERVER)) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo "{\"schemaVersion\":1,\"error\":\"ERROR\",\"code\":\"WEB_GATEWAY_NOT_TRUSTED\",\"message\":\"Web gateway perimeter is not configured\"}\n";
    exit;
}

$model = null;
try {
    $model = HubReadModel::openFromEnvironment(true);
} catch (Throwable) {
    // The router returns a bounded 503 without exposing path or database details.
}

$response = HubReadRouter::dispatch(
    (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'),
    (string) ($_SERVER['REQUEST_URI'] ?? '/'),
    $_SERVER,
    $model,
    false,
);

http_response_code($response['status']);
foreach ($response['headers'] as $name => $value) {
    header($name . ': ' . $value);
}
echo $response['body'];
