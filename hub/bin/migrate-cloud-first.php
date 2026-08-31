<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubCloudFirstMigration.php';

if ($argc !== 2) { fwrite(STDERR, "usage: migrate-cloud-first.php <database>\n"); exit(2); }
try {
    $result = HubCloudFirstMigration::apply($argv[1], dirname(__DIR__) . '/migrations/017_cloud_first_control.sql');
    fwrite(STDOUT, "M18_CLOUD_FIRST=" . strtoupper(str_replace('-', '_', $result)) . "\n");
} catch (Throwable $error) {
    $code = property_exists($error, 'codeName') ? $error->codeName : 'MIGRATION_FAILED';
    fwrite(STDERR, "M18_CLOUD_FIRST_FAILED=" . $code . "\n"); exit(1);
}
