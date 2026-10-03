<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/src/HubCapabilityRegistryService.php';
require_once dirname(__DIR__) . '/src/HubUpdateTargetRegistry.php';
function ep(bool $ok,string $m):void{if(!$ok)throw new RuntimeException($m);}
$p=HubCapabilityRegistryService::executionPolicy();
ep(($p['version']??null)==='2.3-project-admission','project-admission execution policy version');
ep(($p['mode']??null)==='CONTEXT_ONLY'&&($p['enforcement']??null)==='ADVISORY','context is non-prescriptive');
ep(($p['sourceAuthorityRequiredForMutation']??false)===true&&($p['singleWriterMutationBoundary']??false)===true&&($p['mutationBoundary']??null)==='CONFLICTING_RESOURCE','integrity boundary remains enforced');
ep(HubCapabilityRegistryService::mutationResourceForExecution('system.platform.release','VPS')==='CANONICAL:DEPLOY:VPS_PLATFORM','platform release has host-global track');
ep(HubCapabilityRegistryService::mutationResourceForExecution('system.core.release','VPS')==='CANONICAL:DEPLOY:AWH','AWH release has its own track');
ep(HubCapabilityRegistryService::mutationResourceForExecution('system.learnlab.release','VPS')==='CANONICAL:DEPLOY:BAY_LEARNLAB','LearnLab release has its own track');
ep(HubCapabilityRegistryService::mutationResourceForExecution('system.assessment.release','VPS')==='CANONICAL:DEPLOY:BAY_ASSESSMENT','Assessment release has its own track');
ep(HubCapabilityRegistryService::mutationResourceForExecution('bay.remote_update.install','VPS',json_encode(['releaseTrack'=>'bay-excuse-core']))==='CANONICAL:DEPLOY:BAY_EXCUSE','BAY Core install keeps its own deploy track');
ep(HubCapabilityRegistryService::mutationResourceForExecution('bay.remote_update.install','VPS',json_encode(['releaseTrack'=>'line-oa']))==='CANONICAL:DEPLOY:LINE_OA','LINE OA install keeps its own deploy track');
ep(HubCapabilityRegistryService::mutationResourceForExecution('bay.remote_update.install','VPS',json_encode(['releaseTrack'=>'cooperative-center']))==='CANONICAL:DEPLOY:BAY_COOPERATIVE','Cooperative install keeps its own deploy track');
ep(HubCapabilityRegistryService::mutationResourceForExecution('bay.remote_update.install','VPS',json_encode(['releaseTrack'=>'pp-center']))==='CANONICAL:DEPLOY:BAY_PP','PP install keeps its own deploy track');
ep(HubCapabilityRegistryService::mutationResourceForExecution('bay.remote_update.install','VPS')==='CANONICAL:DEPLOY:PROJECT','legacy BAY install without track metadata remains fail-closed');
ep(HubCapabilityRegistryService::mutationResourcesConflictForProjects('CANONICAL:DEPLOY:BAY_EXCUSE','bay','CANONICAL:DEPLOY:LINE_OA','bay')===false,'BAY Core and LINE OA deploy tracks do not block each other');
ep(HubCapabilityRegistryService::mutationResourcesConflictForProjects('CANONICAL:DEPLOY:BAY_EXCUSE','bay','CANONICAL:DEPLOY:BAY_COOPERATIVE','bay')===false,'BAY Core and Cooperative deploy tracks do not block each other');
ep(HubCapabilityRegistryService::mutationResourceForExecution('source.promote','VPS')==='CANONICAL:SOURCE','source promotion remains canonical-source scoped');
ep(HubCapabilityRegistryService::mutationResourcesConflictForProjects('CANONICAL:DEPLOY:AWH','project-a','CANDIDATE','project-a')===false,'candidate mission does not block AWH deploy');
ep(HubCapabilityRegistryService::mutationResourcesConflictForProjects('CANONICAL:DEPLOY:AWH','project-a','CANONICAL:DEPLOY:BAY_LEARNLAB','project-b')===false,'different release tracks can deploy independently');
ep(HubCapabilityRegistryService::mutationResourcesConflictForProjects('CANONICAL:DEPLOY:VPS_PLATFORM','platform','CANONICAL:DEPLOY:AWH','project-a')===true,'platform deploy blocks another deploy while shared host runtime mutates');
ep(HubCapabilityRegistryService::mutationResourcesConflictForProjects('CANONICAL:DEPLOY:VPS_PLATFORM','platform','CANONICAL:SOURCE','project-a')===false,'exact-SHA platform deploy does not block canonical source promotion');
ep(HubCapabilityRegistryService::mutationResourcesConflictForProjects('CANONICAL:SOURCE','project-a','CANONICAL:DEPLOY:VPS_PLATFORM','platform')===false,'canonical source may fast-forward while immutable platform target deploys');
ep(HubCapabilityRegistryService::mutationResourcesConflictForProjects('CANONICAL:DEPLOY:VPS_PLATFORM','platform','RESOURCE:RELEASE_STAGE','project-a')===true,'platform deploy blocks release staging that could change shared host release state');
ep(HubCapabilityRegistryService::mutationResourcesConflictForProjects('CANONICAL:DEPLOY:VPS_PLATFORM','platform','CANDIDATE','project-a')===false,'candidate work remains isolated while platform release runs');
ep(HubCapabilityRegistryService::mutationResourcesConflictForProjects('CANONICAL:SOURCE','project-a','CANONICAL:DEPLOY:AWH','project-a')===false,'exact-SHA AWH deploy does not block later source promotion');
ep(HubCapabilityRegistryService::mutationResourcesConflictForProjects('CANONICAL:SOURCE','project-a','CANONICAL:DEPLOY:BAY_LEARNLAB','project-b')===false,'different-project source promotion remains independent');
ep(HubCapabilityRegistryService::mutationResourcesConflictForProjects('RESOURCE:RELEASE_STAGE','project-a','CANONICAL:DEPLOY:AWH','project-a')===true,'same-project staging interlocks with deploy');
ep(HubCapabilityRegistryService::mutationResourceIsGlobal('CANONICAL:DEPLOY:VPS_PLATFORM')===true,'VPS Platform is host-global');
ep(HubCapabilityRegistryService::mutationResourceIsGlobal('CANONICAL:DEPLOY:AWH')===false,'AWH deploy is not host-global');
ep(HubCapabilityRegistryService::mutationResourcesConflict('CANONICAL:SOURCE','CANONICAL:SOURCE')===true,'same canonical resource serializes');
ep(HubCapabilityRegistryService::mutationResourcesConflict('CANONICAL:PROJECT','CANDIDATE')===true,'unknown canonical mutations fail closed');
ep(HubUpdateTargetRegistry::releaseTrackForPaths('awh',['config/execution-policy.json','hub/src/HubControlPlaneService.php','web/updates.js'])==='vps-platform','Platform-owned change plus shared Update Center integration stays on VPS Platform track');
ep(HubUpdateTargetRegistry::releaseTrackForPaths('awh',['config/execution-policy.json','hub/src/HubDurableExecutionService.php'])==='vps-platform','shared durable executor may carry a VPS Platform concurrency fix without creating a mixed-track release');
ep(HubUpdateTargetRegistry::releaseTrackForPaths('awh',['web/app.js','hub/src/HubControlPlaneService.php'])==='awh','AWH-owned change plus shared Update Center integration stays on AWH track');
ep(HubUpdateTargetRegistry::releaseTrackForPaths('awh',['config/execution-policy.json','web/app.js'])===null,'true mixed AWH and VPS Platform change-set is rejected');
ep(HubUpdateTargetRegistry::releaseTrackForPaths('awh',['scripts/qa/test-singleflight.mjs','test/test-singleflight.test.mjs'])==='vps-platform','QA singleflight infrastructure is VPS Platform-owned');
ep(HubUpdateTargetRegistry::releaseTrackForPaths('awh',['scripts/ops/run-release-qa-isolated.sh','test/bounded-deploy-mission.test.ts'])==='vps-platform','isolated release QA runner and mission contract are VPS Platform-owned');
ep(HubUpdateTargetRegistry::releaseTrackForPaths('awh',['scripts/create-web-release-manifest.mjs','scripts/list-web-release-files.mjs','scripts/release/desktop-reuse-fallback.mjs','test/desktop-release-reuse.test.ts','test/desktop-reuse-fallback.test.ts'])==='vps-platform','desktop release packaging and verified reuse recovery are VPS Platform-owned infrastructure');
ep(HubUpdateTargetRegistry::releaseTrackForPaths('awh',['deploy/awh-control-plane/remote-deploy-control-plane.sh','scripts/release/desktop-reuse-fallback.mjs','hub/src/HubCapabilityRegistryService.php'])==='vps-platform','platform deployment, desktop reuse recovery and execution authority remain one VPS Platform track');
ep(HubUpdateTargetRegistry::releaseTrackForPaths('awh',['config/continuous-improvement-policy.json','config/kruart-engineering-eval.json','hub/src/HubVerificationIntelligence.php','hub/tests/verification-intelligence.php'])==='vps-platform','continuous improvement policy, classifier and eval authority are VPS Platform-owned');
ep(!isset($p['policyFamilies'])&&!isset($p['planBeforeCall'])&&!isset($p['quotaAware']),'retired owner-model fields are absent');

// Provider capability recovery: a retry-exhausted transient wait is preserved
// and may wake only after newer canonical provider health evidence appears.
require_once dirname(__DIR__) . '/src/HubDurableExecutionService.php';
if(in_array('sqlite',PDO::getAvailableDrivers(),true)){
    $root=sys_get_temp_dir().'/awh-provider-wait-'.bin2hex(random_bytes(5));
    try{
        mkdir($root,0700,true);
        $pdo=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
        $pdo->exec("CREATE TABLE control_tasks(task_id TEXT PRIMARY KEY,state TEXT NOT NULL,progress INTEGER NOT NULL DEFAULT 0,failure_code TEXT,lease_expires_at TEXT,updated_at TEXT NOT NULL);");
        $pdo->exec("CREATE TABLE control_task_executions(execution_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,project_id TEXT NOT NULL,executor_kind TEXT NOT NULL,required_capability TEXT NOT NULL,state TEXT NOT NULL,lease_owner TEXT,lease_expires_at TEXT,attempt_count INTEGER NOT NULL DEFAULT 0,checkpoint_json TEXT NOT NULL DEFAULT '{}',last_error_code TEXT,updated_at TEXT NOT NULL);");
        $pdo->exec("CREATE TABLE control_execution_envelopes(execution_id TEXT PRIMARY KEY,state TEXT NOT NULL,lease_expires_at TEXT,updated_at TEXT NOT NULL);");
        $pdo->exec("CREATE TABLE control_task_events(event_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,state TEXT NOT NULL,progress INTEGER NOT NULL,message TEXT NOT NULL,occurred_at TEXT NOT NULL);");
        $pdo->exec("CREATE TABLE control_ai_provider_profiles(provider_id TEXT PRIMARY KEY,current_availability TEXT NOT NULL,lifecycle TEXT NOT NULL,updated_at TEXT NOT NULL);");
        $pdo->exec("CREATE TABLE control_ai_models(provider_id TEXT NOT NULL,model_id TEXT NOT NULL,lifecycle TEXT NOT NULL,enabled INTEGER NOT NULL,PRIMARY KEY(provider_id,model_id));");
        $pdo->exec("CREATE TABLE control_ai_model_health(provider_id TEXT NOT NULL,model_id TEXT NOT NULL,circuit_state TEXT NOT NULL,circuit_until TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(provider_id,model_id));");
        $pdo->exec("CREATE TABLE control_ai_route_decisions(route_id TEXT PRIMARY KEY,execution_id TEXT NOT NULL,provider_id TEXT,model_id TEXT,created_at TEXT NOT NULL);");
        $waiting='2026-10-03T10:00:00+00:00';$healthy='2026-10-03T10:05:00+00:00';$later='2026-10-03T10:10:00+00:00';
        $pdo->prepare("INSERT INTO control_ai_provider_profiles(provider_id,current_availability,lifecycle,updated_at) VALUES('openai','AVAILABLE','PRODUCTION',:at)")->execute(['at'=>$healthy]);
        $pdo->exec("INSERT INTO control_ai_models(provider_id,model_id,lifecycle,enabled) VALUES('openai','fixture-model','PRODUCTION',1)");
        $pdo->prepare("INSERT INTO control_ai_model_health(provider_id,model_id,circuit_state,circuit_until,updated_at) VALUES('openai','fixture-model','CLOSED',NULL,:at)")->execute(['at'=>$healthy]);
        $uuid=static fn(int $n):string=>sprintf('00000000-0000-4000-8000-%012d',$n);
        $insert=static function(int $n,int $attempts,string $code)use($pdo,$waiting,$uuid):array{
            $task=$uuid($n);$execution=$uuid($n+100);$route=$uuid($n+200);
            $pdo->prepare("INSERT INTO control_tasks(task_id,state,progress,failure_code,lease_expires_at,updated_at) VALUES(:task,'WAITING_FOR_WORKER',0,:code,NULL,:at)")->execute(['task'=>$task,'code'=>$code,'at'=>$waiting]);
            $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,checkpoint_json,last_error_code,updated_at) VALUES(:execution,:task,:project,'VPS','agent.conversation','WAITING_FOR_CAPABILITY',NULL,NULL,:attempts,'{}',:code,:at)")->execute(['execution'=>$execution,'task'=>$task,'project'=>$uuid(999),'attempts'=>$attempts,'code'=>$code,'at'=>$waiting]);
            $pdo->prepare("INSERT INTO control_execution_envelopes(execution_id,state,lease_expires_at,updated_at) VALUES(:execution,'WAITING',NULL,:at)")->execute(['execution'=>$execution,'at'=>$waiting]);
            $pdo->prepare("INSERT INTO control_ai_route_decisions(route_id,execution_id,provider_id,model_id,created_at) VALUES(:route,:execution,'openai','fixture-model',:at)")->execute(['route'=>$route,'execution'=>$execution,'at'=>$waiting]);
            return [$task,$execution];
        };
        [$shortTask,$shortExecution]=$insert(1,1,'PROVIDER_UNAVAILABLE');
        [$exhaustedTask,$exhaustedExecution]=$insert(2,3,'PROVIDER_UNAVAILABLE');
        [$quotaTask,$quotaExecution]=$insert(3,3,'PROVIDER_QUOTA_EXHAUSTED');
        $vault=new HubProjectVaultService($pdo,new HubProjectVault($root.'/vault'));
        $service=new HubDurableExecutionService($pdo,$vault,null,null);
        $method=(new ReflectionClass(HubDurableExecutionService::class))->getMethod('reconcileRecoverableProviderWaits');
        $method->setAccessible(true);
        ep($method->invoke($service,$later)===1,'only retry-exhausted transient provider wait wakes on newer health evidence');
        $state=static function(string $execution)use($pdo):array{$q=$pdo->prepare('SELECT state,attempt_count,last_error_code,checkpoint_json,updated_at FROM control_task_executions WHERE execution_id=:id');$q->execute(['id'=>$execution]);return $q->fetch()?:[];};
        ep(($state($shortExecution)['state']??null)==='WAITING_FOR_CAPABILITY','non-exhausted provider wait does not bypass bounded retry policy');
        ep(($state($quotaExecution)['state']??null)==='WAITING_FOR_CAPABILITY','quota wait never auto-wakes');
        $recovered=$state($exhaustedExecution);
        ep(($recovered['state']??null)==='QUEUED'&&(int)($recovered['attempt_count']??-1)===0&&array_key_exists('last_error_code',$recovered)&&$recovered['last_error_code']===null,'provider recovery reuses same execution and resets bounded retry state');
        $checkpoint=json_decode((string)($recovered['checkpoint_json']??'{}'),true);
        ep(($checkpoint['_capabilityRecovery']['version']??null)==='provider-health-v1','provider recovery persists canonical health evidence');
        ep((int)$pdo->query("SELECT COUNT(*) FROM control_task_events WHERE task_id='$exhaustedTask'")->fetchColumn()===1,'provider recovery emits one durable event');
        $pdo->prepare("UPDATE control_task_executions SET state='WAITING_FOR_CAPABILITY',attempt_count=3,last_error_code='PROVIDER_UNAVAILABLE',updated_at=:at WHERE execution_id=:id")->execute(['at'=>$later,'id'=>$exhaustedExecution]);
        $pdo->prepare("UPDATE control_tasks SET state='WAITING_FOR_WORKER',failure_code='PROVIDER_UNAVAILABLE',updated_at=:at WHERE task_id=:id")->execute(['at'=>$later,'id'=>$exhaustedTask]);
        $pdo->prepare("UPDATE control_execution_envelopes SET state='WAITING',updated_at=:at WHERE execution_id=:id")->execute(['at'=>$later,'id'=>$exhaustedExecution]);
        ep($method->invoke($service,'2026-10-03T10:11:00+00:00')===0,'same health evidence cannot hot-loop the execution');
        $pdo->prepare("UPDATE control_ai_model_health SET updated_at='2026-10-03T10:12:00+00:00' WHERE provider_id='openai' AND model_id='fixture-model'")->execute();
        ep($method->invoke($service,'2026-10-03T10:13:00+00:00')===1,'newer provider health can wake the preserved execution again');
    }finally{
        if(is_dir($root)){foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST) as $f){$path=$f->getPathname();$f->isDir()&&!$f->isLink()?@rmdir($path):@unlink($path);}@rmdir($root);}
    }
}

echo "AWH Execution Context: PASS\n";
