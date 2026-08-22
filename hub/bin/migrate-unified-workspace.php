<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubUnifiedWorkspaceMigration.php';

$database = $argv[1] ?? getenv('AWH_HUB_DB_PATH') ?: '/var/lib/awh-hub/awh.sqlite';
$migration = $argv[2] ?? dirname(__DIR__) . '/migrations/007_unified_workspace.sql';
try { fwrite(STDOUT, 'UNIFIED_WORKSPACE_MIGRATION=' . HubUnifiedWorkspaceMigration::apply($database, $migration) . "\n"); }
catch (HubUnifiedWorkspaceMigrationException $error) { fwrite(STDERR, 'UNIFIED_WORKSPACE_MIGRATION_FAILED=' . $error->codeName . "\n"); exit(2); }
