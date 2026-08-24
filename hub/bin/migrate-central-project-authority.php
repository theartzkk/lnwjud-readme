<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubCentralProjectAuthorityMigration.php';

if ($argc !== 2 || !is_string($argv[1]) || $argv[1] === '' || str_contains($argv[1], "\0")) { fwrite(STDERR, "Usage: migrate-central-project-authority.php DATABASE_PATH\n"); exit(2); }
try { fwrite(STDOUT, HubCentralProjectAuthorityMigration::apply($argv[1], dirname(__DIR__) . '/migrations/011_central_project_authority.sql') . "\n"); }
catch (HubCentralProjectAuthorityMigrationException $error) { fwrite(STDERR, $error->codeName . "\n"); exit(1); }
