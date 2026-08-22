<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubOwnerAuthService.php';

$database = getenv('AWH_HUB_DB_PATH') ?: '/var/lib/awh-hub/awh.sqlite';
try {
    HubOwnerAuthService::openExisting($database);
    fwrite(STDOUT, "OWNER_AUTH_RUNTIME=PASS\n");
} catch (Throwable) {
    // Deployment uses this only as a capability gate. It must not disclose
    // database, schema or credential details through the release boundary.
    fwrite(STDERR, "OWNER_AUTH_RUNTIME=FAIL\n");
    exit(2);
}
