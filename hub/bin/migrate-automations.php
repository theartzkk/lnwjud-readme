<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubAutomationMigration.php';

if ($argc !== 2) { fwrite(STDERR, "usage: migrate-automations.php <database>\n"); exit(2); }
try { fwrite(STDOUT, HubAutomationMigration::apply($argv[1], dirname(__DIR__) . '/migrations/014_automations.sql') . "\n"); }
catch (HubAutomationMigrationException $error) { fwrite(STDERR, $error->codeName . "\n"); exit(1); }
