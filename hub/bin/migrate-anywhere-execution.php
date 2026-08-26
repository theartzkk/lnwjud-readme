<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubAnywhereExecutionMigration.php';

if ($argc !== 2) { fwrite(STDERR, "usage: migrate-anywhere-execution.php <database>\n"); exit(2); }
try { fwrite(STDOUT, HubAnywhereExecutionMigration::apply($argv[1], dirname(__DIR__) . '/migrations/012_anywhere_execution_fabric.sql') . "\n"); }
catch (HubAnywhereExecutionMigrationException $error) { fwrite(STDERR, $error->codeName . "\n"); exit(1); }
