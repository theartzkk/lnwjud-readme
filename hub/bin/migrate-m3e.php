<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubSchemaMigration.php';

if ($argc !== 2 || $argv[1] === '' || str_starts_with($argv[1], '-')) {
    fwrite(STDERR, "Usage: php hub/bin/migrate-m3e.php /absolute/path/to/awh.sqlite\n");
    exit(2);
}

try {
    $result = HubSchemaMigration::apply($argv[1], dirname(__DIR__) . '/migrations/001_m3e_enrollment.sql', null, false, dirname(__DIR__) . '/schema.sql');
    fwrite(STDOUT, json_encode(['ok' => true, 'migration' => HubSchemaMigration::MIGRATION_ID, 'result' => $result], JSON_UNESCAPED_SLASHES) . "\n");
} catch (Throwable) {
    fwrite(STDERR, "AWH M3E schema migration failed closed\n");
    exit(1);
}
