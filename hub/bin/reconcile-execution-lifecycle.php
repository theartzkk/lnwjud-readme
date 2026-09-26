<?php
declare(strict_types=1);
require_once dirname(__DIR__).'/src/HubExecutionLifecycleService.php';
$db=getenv('AWH_HUB_DB_PATH')?:'/var/lib/awh-hub/awh.sqlite';
try{
 $pdo=new PDO('sqlite:'.$db,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
 $result=(new HubExecutionLifecycleService($pdo))->reconcile();
 fwrite(STDOUT,json_encode(['schemaVersion'=>1,'state'=>'PASS']+$result,JSON_UNESCAPED_SLASHES).PHP_EOL);
}catch(Throwable $e){fwrite(STDERR,"AWH_EXECUTION_LIFECYCLE=FAIL\n");exit(1);}
