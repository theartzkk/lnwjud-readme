<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/src/HubVaultSourceAuthorityMigration.php';
if ($argc !== 2) { fwrite(STDERR, "usage: migrate-vault-source-authority.php <database>\n"); exit(2); }
try {
    $result=HubVaultSourceAuthorityMigration::apply($argv[1],dirname(__DIR__).'/migrations/020_vault_source_authority.sql');
    fwrite(STDOUT,"M21_VAULT_SOURCE_AUTHORITY=".$result."\n");
} catch(Throwable $error){$code=property_exists($error,'codeName')?$error->codeName:'MIGRATION_FAILED';fwrite(STDERR,"M21_VAULT_SOURCE_AUTHORITY_FAILED=".$code."\n");exit(1);}
