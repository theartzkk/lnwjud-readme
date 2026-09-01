<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubProjectSourceAuthorityMigration.php';

if ($argc !== 2) { fwrite(STDERR, "usage: migrate-project-source-authority.php <database>\n"); exit(2); }
try {
    $result = HubProjectSourceAuthorityMigration::apply($argv[1], dirname(__DIR__) . '/migrations/019_project_source_authority.sql');
    fwrite(STDOUT, "M20_PROJECT_SOURCE_AUTHORITY=" . strtoupper(str_replace('-', '_', $result)) . "\n");
} catch (Throwable $error) {
    $code = property_exists($error, 'codeName') ? $error->codeName : 'MIGRATION_FAILED';
    fwrite(STDERR, "M20_PROJECT_SOURCE_AUTHORITY_FAILED=" . $code . "\n"); exit(1);
}
