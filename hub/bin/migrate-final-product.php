<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubFinalProductMigration.php';

if ($argc !== 2 || !is_string($argv[1]) || $argv[1] === '' || str_contains($argv[1], "\0")) { fwrite(STDERR, "Usage: migrate-final-product.php DATABASE_PATH\n"); exit(2); }
try { fwrite(STDOUT, HubFinalProductMigration::apply($argv[1], dirname(__DIR__) . '/migrations/008_final_product.sql') . "\n"); }
catch (HubFinalProductMigrationException $error) { fwrite(STDERR, $error->codeName . "\n"); exit(1); }
