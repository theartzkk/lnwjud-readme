<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubCostAwareAiMigration.php';

if ($argc !== 2) { fwrite(STDERR, "usage: migrate-cost-aware-ai.php <database>\n"); exit(2); }
try { fwrite(STDOUT, HubCostAwareAiMigration::apply($argv[1], dirname(__DIR__) . '/migrations/013_cost_aware_ai.sql') . "\n"); }
catch (HubCostAwareAiMigrationException $error) { fwrite(STDERR, $error->codeName . "\n"); exit(1); }
