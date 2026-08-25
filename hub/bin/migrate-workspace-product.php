<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubWorkspaceProductMigration.php';

if ($argc !== 2 || !is_string($argv[1]) || $argv[1] === '' || str_contains($argv[1], "\0")) { fwrite(STDERR, "Usage: migrate-workspace-product.php DATABASE_PATH\n"); exit(2); }
try { fwrite(STDOUT, HubWorkspaceProductMigration::apply($argv[1], dirname(__DIR__) . '/migrations/012_workspace_product.sql') . "\n"); }
catch (HubWorkspaceProductMigrationException $error) { fwrite(STDERR, $error->codeName . "\n"); exit(1); }
