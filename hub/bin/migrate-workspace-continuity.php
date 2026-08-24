<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubWorkspaceContinuityMigration.php';

$database = $argv[1] ?? getenv('AWH_HUB_DB_PATH') ?: '/var/lib/awh-hub/awh.sqlite';
$migration = $argv[2] ?? dirname(__DIR__) . '/migrations/006_workspace_continuity.sql';
try { fwrite(STDOUT, 'WORKSPACE_CONTINUITY_MIGRATION=' . HubWorkspaceContinuityMigration::apply($database, $migration) . "\n"); }
catch (HubWorkspaceContinuityMigrationException $error) { fwrite(STDERR, 'WORKSPACE_CONTINUITY_MIGRATION_FAILED=' . $error->codeName . "\n"); exit(2); }
