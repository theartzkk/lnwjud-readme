<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/src/HubAccountHostingMigration.php';
try {
    if ($argc < 2) throw new RuntimeException('database path required');
    $sql = $argv[2] ?? dirname(__DIR__) . '/migrations/016_account_hosting.sql';
    $result = HubAccountHostingMigration::apply($argv[1], $sql);
    fwrite(STDOUT, $result . "\n");
} catch (HubAccountHostingMigrationException $error) { fwrite(STDERR, $error->codeName . "\n"); exit(1); }
catch (Throwable) { fwrite(STDERR, "MIGRATION_FAILED\n"); exit(1); }
