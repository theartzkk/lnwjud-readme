<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubAssessmentReleaseOperator.php';

$db=getenv('AWH_HUB_DB_PATH');
if(!is_string($db)||$db==='')$db='/var/lib/awh-hub/awh.sqlite';
$execution=$argv[1]??'';
if(!is_string($execution)||preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',$execution)!==1){
    fwrite(STDERR,"ASSESSMENT_RELEASE_EXECUTION_INVALID\n");exit(2);
}
try{
    $pdo=new PDO('sqlite:'.$db,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys=ON');$pdo->exec('PRAGMA busy_timeout=7500');$pdo->exec('PRAGMA journal_mode=WAL');
    $result=HubAssessmentReleaseOperator::fromEnvironment($pdo)->runExecution(strtolower($execution));
    fwrite(STDOUT,json_encode($result,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)."\n");
}catch(HubAssessmentReleaseOperatorException|HubAssessmentReleaseException $error){
    fwrite(STDERR,$error->codeName."\n");exit(1);
}catch(Throwable){
    fwrite(STDERR,"ASSESSMENT_RELEASE_RUN_FAILED\n");exit(1);
}
