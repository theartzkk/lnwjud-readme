<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubEnrollmentApiMigration.php';

if ($argc !== 2 || $argv[1] === '' || str_starts_with($argv[1], '-')) {
    fwrite(STDERR, "Usage: php hub/bin/migrate-m3e2.php /absolute/path/to/awh.sqlite\n");
    exit(2);
}

try {
    $result = HubEnrollmentApiMigration::apply($argv[1], dirname(__DIR__) . '/migrations/002_m3e2_enrollment_api.sql');
    fwrite(STDOUT, json_encode(['ok' => true, 'migration' => HubEnrollmentApiMigration::MIGRATION_ID, 'result' => $result], JSON_UNESCAPED_SLASHES) . "\n");
} catch (Throwable) {
    fwrite(STDERR, "AWH M3E.2 enrollment API migration failed closed\n");
    exit(1);
}
