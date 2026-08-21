<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubEnrollmentService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneRouter.php';

try {
    $control = HubControlPlaneService::openExisting(getenv('AWH_HUB_DB_PATH') ?: '/var/lib/awh-hub/awh.sqlite');
    $body = file_get_contents('php://input', false, null, 0, 16385);
    $response = HubControlPlaneRouter::dispatch((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'), (string) ($_SERVER['REQUEST_URI'] ?? '/'), $_SERVER, $control, is_string($body) ? $body : '');
} catch (Throwable) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo "{\"schemaVersion\":1,\"error\":\"ERROR\",\"code\":\"CONTROL_PLANE_UNAVAILABLE\",\"message\":\"AWH control plane is unavailable\"}\n";
    exit;
}
http_response_code($response['status']);
foreach ($response['headers'] as $name => $value) {
    if (is_array($value)) foreach ($value as $line) header($name . ': ' . $line, false);
    else header($name . ': ' . $value);
}
echo $response['body'];
