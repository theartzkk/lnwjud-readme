<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubFoundingMemoryMigration.php';

if ($argc !== 2 || !is_string($argv[1]) || $argv[1] === '' || str_contains($argv[1], "\0")) { fwrite(STDERR, "Usage: migrate-founding-memory.php DATABASE_PATH\n"); exit(2); }
try {
    $migration = HubFoundingMemoryMigration::apply($argv[1], dirname(__DIR__) . '/migrations/009_founding_memory.sql');
    $report = HubFoundingMemoryMigration::importDefaultSeed($argv[1]);
    fwrite(STDOUT, 'FOUNDING_MEMORY_MIGRATION=' . $migration . "\n");
    fwrite(STDOUT, 'FOUNDING_MEMORY_IMPORT=' . $report['status'] . "\n");
} catch (HubFoundingMemoryMigrationException $error) { fwrite(STDERR, 'FOUNDING_MEMORY_MIGRATION_FAILED=' . $error->codeName . "\n"); exit(1); }
