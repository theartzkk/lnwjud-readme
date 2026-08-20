<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubEnrollmentService.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentRouter.php';

$service = null;
try {
    $service = HubEnrollmentService::openExisting(getenv('AWH_HUB_DB_PATH') ?: '/var/lib/awh-hub/awh.sqlite');
} catch (Throwable) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo "{\"schemaVersion\":1,\"error\":\"ERROR\",\"code\":\"ENROLLMENT_UNAVAILABLE\",\"message\":\"Enrollment is unavailable\"}\n";
    exit;
}

$body = file_get_contents('php://input', false, null, 0, 16385);
$response = HubEnrollmentRouter::dispatch(
    (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'),
    (string) ($_SERVER['REQUEST_URI'] ?? '/'),
    $_SERVER,
    $service,
    is_string($body) ? $body : '',
);
http_response_code($response['status']);
foreach ($response['headers'] as $name => $value) header($name . ': ' . $value);
echo $response['body'];
