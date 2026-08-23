<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubSelfServiceMigration.php';

if ($argc !== 2 || !is_string($argv[1]) || $argv[1] === '' || str_contains($argv[1], "\0")) { fwrite(STDERR, "Usage: migrate-self-service.php DATABASE_PATH\n"); exit(2); }
try { fwrite(STDOUT, HubSelfServiceMigration::apply($argv[1], dirname(__DIR__) . '/migrations/010_self_service.sql') . "\n"); }
catch (HubSelfServiceMigrationException $error) { fwrite(STDERR, $error->codeName . "\n"); exit(1); }
