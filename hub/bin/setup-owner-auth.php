<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubOwnerAuthService.php';

$database = getenv('AWH_HUB_DB_PATH') ?: '/var/lib/awh-hub/awh.sqlite';
if ($argc !== 2 || preg_match('/^[a-z][a-z0-9._-]{2,63}$/', $argv[1]) !== 1) {
    fwrite(STDERR, "Usage: setup-owner-auth.php INPUT_USERNAME\n");
    fwrite(STDERR, "OWNER_AUTH_PROVISIONED=FAIL\n");
    exit(2);
}
$input = file_get_contents('php://stdin');
try {
    $password = is_string($input) ? preg_replace('/\r?\n\z/', '', $input) : null;
    if (!is_string($password) || $password === '' || preg_match('/[\x00-\x1F\x7F]/', $password) === 1) throw new RuntimeException('invalid input');
    $service = HubOwnerAuthService::openExisting($database);
    $result = $service->provisionInitial($argv[1], $password);
    // Recovery codes are intentionally not printed by the remote helper. A
    // reviewed local operator wrapper may display them once through /dev/tty.
    fwrite(STDOUT, "OWNER_AUTH_PROVISIONED=PASS\nOWNER_AUTH_USERNAME=" . $result['username'] . "\nRECOVERY_CODES=LOCAL_OPERATOR_BOUNDARY\n");
} catch (Throwable $error) { fwrite(STDERR, "OWNER_AUTH_PROVISIONED=FAIL\n"); exit(2); }
