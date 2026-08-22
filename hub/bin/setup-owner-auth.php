<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubOwnerAuthService.php';

$database = getenv('AWH_HUB_DB_PATH') ?: '/var/lib/awh-hub/awh.sqlite';
$input = file_get_contents('php://stdin');
try {
    $payload = json_decode(is_string($input) ? $input : '', true, 32, JSON_THROW_ON_ERROR);
    if (!is_array($payload) || array_keys($payload) !== ['username', 'password']) throw new RuntimeException('invalid input');
    $service = HubOwnerAuthService::openExisting($database);
    $result = $service->provisionInitial((string) $payload['username'], (string) $payload['password']);
    // Recovery codes are intentionally not printed by the remote helper. A
    // reviewed local operator wrapper may display them once through /dev/tty.
    fwrite(STDOUT, "OWNER_AUTH_PROVISIONED=PASS\nOWNER_AUTH_USERNAME=" . $result['username'] . "\nRECOVERY_CODES=LOCAL_OPERATOR_BOUNDARY\n");
} catch (Throwable $error) { fwrite(STDERR, "OWNER_AUTH_PROVISIONED=FAIL\n"); exit(2); }
