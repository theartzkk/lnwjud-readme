<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubProjectVault.php';
require_once dirname(__DIR__) . '/src/HubManagedHostingOperator.php';
require_once dirname(__DIR__) . '/src/HubCoreReleaseOperator.php';
require_once dirname(__DIR__) . '/src/HubLearnLabReleaseOperator.php';
require_once dirname(__DIR__) . '/src/HubAssessmentReleaseOperator.php';
require_once dirname(__DIR__) . '/src/HubEcosystemHealthCollector.php';

$db=getenv('AWH_HUB_DB_PATH');
if(!is_string($db)||$db===''||str_contains($db,"\0")){fwrite(STDERR,"DATABASE_CONFIG_INVALID\n");exit(2);}

try{
    $pdo=new PDO('sqlite:'.$db,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys=ON');
    $pdo->exec('PRAGMA busy_timeout=7500');
    $pdo->exec('PRAGMA journal_mode=WAL');

    $core=HubCoreReleaseOperator::fromEnvironment($pdo)->tick();
    if(($core['state']??'IDLE')!=='IDLE'){
        fwrite(STDOUT,json_encode(['schemaVersion'=>1,'coreRelease'=>$core,'hosting'=>['state'=>'PAUSED_FOR_CORE_RELEASE']],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)."\n");
        exit(0);
    }

    $learnlab=HubLearnLabReleaseOperator::fromEnvironment($pdo)->tick();
    if(($learnlab['state']??'IDLE')!=='IDLE'){
        fwrite(STDOUT,json_encode(['schemaVersion'=>1,'learnLabRelease'=>$learnlab,'hosting'=>['state'=>'PAUSED_FOR_LEARNLAB_RELEASE']],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)."
");
        exit(0);
    }

    $assessment=HubAssessmentReleaseOperator::fromEnvironment($pdo)->tick();
    if(($assessment['state']??'IDLE')!=='IDLE'){
        fwrite(STDOUT,json_encode(['schemaVersion'=>1,'assessmentRelease'=>$assessment,'hosting'=>['state'=>'PAUSED_FOR_ASSESSMENT_RELEASE']],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)."
");
        exit(0);
    }

    $ecosystem=['status'=>'UNAVAILABLE'];
    try{$ecosystem=HubEcosystemHealthCollector::fromEnvironment()->refreshIfStale(300);}catch(Throwable){$ecosystem=['status'=>'DEGRADED'];}
    $result=HubManagedHostingOperator::fromEnvironment($pdo)->tick();
    $result['ecosystemHealth']=$ecosystem;
    $state=(string)($result['state']??'UNKNOWN');$health=(string)($ecosystem['status']??'UNKNOWN');
    if($state!=='IDLE'||!in_array($health,['FRESH','REFRESHED'],true))fwrite(STDOUT,json_encode($result,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)."\n");
}catch(HubCoreReleaseOperatorException|HubCoreReleaseException|HubLearnLabReleaseOperatorException|HubLearnLabReleaseException|HubAssessmentReleaseOperatorException|HubAssessmentReleaseException $e){
    fwrite(STDERR,$e->codeName."\n");exit(1);
}catch(HubManagedHostingOperatorException|HubProjectVaultException|HubAccountHostingMigrationException $e){
    fwrite(STDERR,$e->codeName."\n");exit(1);
}catch(Throwable){
    fwrite(STDERR,"HOSTING_OPERATOR_FAILED\n");exit(1);
}
