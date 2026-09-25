<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubIdentityConvergenceMigration.php';

if ($argc !== 2) {
    fwrite(STDERR, "Usage: php migrate-identity-convergence.php <database-path>\n");
    exit(2);
}

try {
    $result = HubIdentityConvergenceMigration::apply($argv[1], dirname(__DIR__) . '/migrations/021_identity_convergence.sql');
    fwrite(STDOUT, "M22 Identity Convergence: {$result}\n");
} catch (Throwable $error) {
    fwrite(STDERR, "M22 Identity Convergence failed\n");
    exit(1);
}
