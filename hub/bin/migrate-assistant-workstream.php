<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubAssistantWorkstreamMigration.php';

$database = $argv[1] ?? getenv('AWH_HUB_DB_PATH') ?: '/var/lib/awh-hub/awh.sqlite';
$migration = $argv[2] ?? dirname(__DIR__) . '/migrations/005_assistant_workstream.sql';
try { fwrite(STDOUT, 'ASSISTANT_WORKSTREAM_MIGRATION=' . HubAssistantWorkstreamMigration::apply($database, $migration) . "\n"); }
catch (HubAssistantWorkstreamMigrationException $error) { fwrite(STDERR, 'ASSISTANT_WORKSTREAM_MIGRATION_FAILED=' . $error->codeName . "\n"); exit(2); }
