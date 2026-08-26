<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubDatabaseStudioService.php';
require_once dirname(__DIR__) . '/src/HubDatabaseStudioRouter.php';

try {
    $database = getenv('AWH_HUB_DB_PATH') ?: '/var/lib/awh-hub/awh.sqlite';
    $body = file_get_contents('php://input', false, null, 0, 16385);
    $studio = HubDatabaseStudioService::openExisting($database);
    $response = HubDatabaseStudioRouter::dispatch(
        (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'),
        (string) ($_SERVER['REQUEST_URI'] ?? '/database-studio.php'),
        $_SERVER,
        $studio,
        is_string($body) ? $body : '',
    );
} catch (Throwable) {
    $response = [
        'status' => 503,
        'headers' => ['Content-Type' => 'application/json; charset=utf-8', 'Cache-Control' => 'no-store', 'X-Content-Type-Options' => 'nosniff'],
        'body' => "{\"schemaVersion\":1,\"error\":\"ERROR\",\"code\":\"DATABASE_STUDIO_UNAVAILABLE\",\"message\":\"Database Studio is unavailable\"}\n",
    ];
}

http_response_code((int) $response['status']);
foreach ($response['headers'] as $name => $value) header($name . ': ' . $value);
echo $response['body'];
