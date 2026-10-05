<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubCentralProjectAuthorityMigration.php';
require_once dirname(__DIR__) . '/src/HubProjectVault.php';
require_once dirname(__DIR__) . '/src/HubProjectVaultService.php';
require_once dirname(__DIR__) . '/src/HubDurableExecutionService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneService.php';

$database=getenv('AWH_HUB_DB_PATH');
if(!is_string($database)||$database===''||str_contains($database,"\0")){fwrite(STDERR,"DATABASE_CONFIG_INVALID\n");exit(2);}
$mode=$argv[1]??'';
if(!in_array($mode,['candidates','execute'],true)){fwrite(STDERR,"HATCHET_BRIDGE_MODE_INVALID\n");exit(2);}

try{
    $pdo=new PDO('sqlite:'.$database,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys = ON');$pdo->exec('PRAGMA busy_timeout = 7500');$pdo->exec('PRAGMA journal_mode = WAL');$pdo->exec('PRAGMA synchronous = NORMAL');
    $control=HubControlPlaneService::openExisting($database);
    $execution=HubDurableExecutionService::fromEnvironment($pdo,static fn(array $request):array=>$control->materializeContinuationSubmission($request));
    if($mode==='candidates'){
        $raw=$argv[2]??'8';
        if(!is_string($raw)||preg_match('/^[0-9]{1,2}$/',$raw)!==1){fwrite(STDERR,"HATCHET_BRIDGE_LIMIT_INVALID\n");exit(2);}
        $items=$execution->hatchetCandidates((int)$raw);
        fwrite(STDOUT,json_encode(['schemaVersion'=>1,'items'=>$items],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)."\n");
        exit(0);
    }
    $executionId=$argv[2]??'';
    if(!is_string($executionId)){fwrite(STDERR,"HATCHET_BRIDGE_EXECUTION_INVALID\n");exit(2);}
    $result=$execution->runExact($executionId);
    fwrite(STDOUT,json_encode(['schemaVersion'=>1,'executionId'=>strtolower($executionId),'result'=>$result],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)."\n");
}catch(HubDurableExecutionException|HubProjectVaultException|HubCentralProjectAuthorityMigrationException $error){
    fwrite(STDERR,$error->codeName."\n");exit(1);
}catch(Throwable){
    fwrite(STDERR,"HATCHET_BRIDGE_UNAVAILABLE\n");exit(1);
}
