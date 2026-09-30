<?php
declare(strict_types=1);
require_once dirname(__DIR__).'/src/HubOpenRouterFreeMigration.php';
if($argc!==2){fwrite(STDERR,"Usage: php migrate-openrouter-free.php <database-path>\n");exit(2);}
try{
    $result=HubOpenRouterFreeMigration::apply($argv[1],dirname(__DIR__).'/migrations/024_openrouter_free.sql');
    fwrite(STDOUT,$result."\n");
}catch(Throwable $error){
    fwrite(STDERR,(property_exists($error,'codeName')?$error->codeName:'MIGRATION_FAILED').": ".$error->getMessage()."\n");
    exit(1);
}
