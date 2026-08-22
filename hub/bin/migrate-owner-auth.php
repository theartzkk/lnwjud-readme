<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubOwnerAuthMigration.php';

$database = getenv('AWH_HUB_DB_PATH') ?: '/var/lib/awh-hub/awh.sqlite';
$migration = dirname(__DIR__) . '/migrations/004_owner_auth.sql';
try { $result = HubOwnerAuthMigration::apply($database, $migration); fwrite(STDOUT, "OWNER_AUTH_MIGRATION=" . $result . "\n"); }
catch (HubOwnerAuthMigrationException $error) { fwrite(STDERR, "OWNER_AUTH_MIGRATION_FAILED=" . $error->codeName . "\n"); exit(2); }
