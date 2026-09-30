#!/usr/bin/php
<?php
declare(strict_types=1);
require_once dirname(__DIR__).'/src/HubPlatformMaintenanceMigration.php';
if($argc!==2){fwrite(STDERR,"usage: migrate-platform-maintenance.php <database>\n");exit(64);}
try{
    $result=HubPlatformMaintenanceMigration::apply($argv[1],dirname(__DIR__).'/migrations/024_platform_maintenance.sql');
    fwrite(STDOUT,$result."\n");
}catch(Throwable $error){
    fwrite(STDERR,($error instanceof HubPlatformMaintenanceMigrationException?$error->codeName:'MIGRATION_FAILED')."\n");
    exit(1);
}
