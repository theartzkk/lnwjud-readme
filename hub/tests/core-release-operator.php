<?php

declare(strict_types=1);

foreach ([
    'HubSchemaMigration','HubEnrollmentApiMigration','HubControlPlaneMigration','HubOwnerAuthMigration',
    'HubAssistantWorkstreamMigration','HubWorkspaceContinuityMigration','HubUnifiedWorkspaceMigration',
    'HubFinalProductMigration','HubFoundingMemoryMigration','HubSelfServiceMigration',
    'HubCentralProjectAuthorityMigration','HubAnywhereExecutionMigration','HubEnrollmentService',
    'HubOwnerAuthService','HubControlPlaneService','HubCoreReleaseService','HubCoreReleaseOperator'
] as $class) require_once dirname(__DIR__) . '/src/' . $class . '.php';

function cr_assert(bool $value,string $message): void { if(!$value)throw new RuntimeException($message); }
function cr_clean(string $root): void { if(!is_dir($root))return;$it=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST);foreach($it as $f){$p=$f->getPathname();$f->isDir()&&!$f->isLink()?@rmdir($p):@unlink($p);}@rmdir($root); }
function cr_release_notes(string $base,string $target,string $track='awh'): array {
    return [
        'schemaVersion'=>1,'metadataState'=>'READY','generatedFrom'=>'EXACT_GIT_DIFF',
        'repository'=>'awh','releaseTrack'=>$track,'previousSha'=>$base,'targetSha'=>$target,'generatedAt'=>'2026-09-23T01:00:00+00:00',
        'ownerSummary'=>'AWH release fixture','userVisible'=>true,
        'summary'=>['features'=>['Track-scoped release fixture'],'improvements'=>[],'fixes'=>[],'internal'=>[]],
        'commits'=>[['sha'=>$target,'subject'=>'Track-scoped release fixture']],'changedFileCount'=>1,
        'impact'=>['databaseMigration'=>'NONE','serviceReload'=>'AUTOMATIC','appRestart'=>'NONE','signIn'=>'NONE','plannedDowntime'=>false],
        'compatibility'=>['data'=>'COMPATIBLE','runtime'=>'COMPATIBLE','authentication'=>'UNCHANGED'],
        'rollback'=>['required'=>true,'strategy'=>'PREVIOUS_VERIFIED_RELEASE_OR_SOURCE','sourceSha'=>$base],
        'knownIssues'=>[],'comingNext'=>[]
    ];
}

if(!in_array('sqlite',PDO::getAvailableDrivers(),true)){fwrite(STDOUT,"AWH core release operator: SKIP pdo_sqlite unavailable\n");exit(77);}if(!is_executable('/usr/bin/systemd-run')||!is_executable('/usr/bin/git')||!is_executable('/usr/bin/php')){fwrite(STDOUT,"AWH core release operator: SKIP Linux release toolchain unavailable\n");exit(77);}

$root=sys_get_temp_dir().'/awh-core-release-'.bin2hex(random_bytes(6));
$db=$root.'/awh.sqlite';$base=dirname(__DIR__);$now='2026-09-23T01:00:00+00:00';
$project=HubCoreReleaseService::PROJECT_ID;$owner='223b45c0-23e1-408d-ae0f-ac5eca7f6900';$password='core-release-'.bin2hex(random_bytes(10));
$artifact=$root.'/artifacts';$vault=$root.'/vault';$workspace=$root.'/workspaces';
putenv('AWH_ARTIFACT_ROOT='.$artifact);putenv('AWH_PROJECT_VAULT_ROOT='.$vault);putenv('AWH_TASK_WORKSPACE_ROOT='.$workspace);

try{
    mkdir($root,0700,true);foreach([$artifact,$vault,$workspace] as $d)mkdir($d,0700,true);
    $pdo=new PDO('sqlite:'.$db,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys=ON');$pdo->exec(file_get_contents($base.'/schema.sql'));
    foreach(['enrollment_rate_limits','device_project_memberships','device_tokens','pairing_projects','pairing_codes','user_project_memberships','device_enrollments','owner_bootstrap','hub_users'] as $table)$pdo->exec('DROP TABLE IF EXISTS '.$table);
    $pdo->prepare('INSERT INTO projects(project_id,name,type,created_at,source_revision,observed_at,provenance) VALUES(:id,:name,:type,:at,NULL,:at,:provenance)')->execute(['id'=>$project,'name'=>'Art’s Workspace Hub','type'=>'system','at'=>$now,'provenance'=>'core-release-test']);
    cr_assert(HubSchemaMigration::apply($db,$base.'/migrations/001_m3e_enrollment.sql',$now,false,$base.'/schema.sql')==='applied','M3E');
    cr_assert(HubEnrollmentApiMigration::apply($db,$base.'/migrations/002_m3e2_enrollment_api.sql',$now)==='applied','M3E2');
    HubEnrollmentService::openExisting($db)->initializeOwner($owner,'Art Owner',[$project],$now);
    foreach([
        [HubControlPlaneMigration::class,'003_m4_control_plane.sql'],[HubOwnerAuthMigration::class,'004_owner_auth.sql'],
        [HubAssistantWorkstreamMigration::class,'005_assistant_workstream.sql'],[HubWorkspaceContinuityMigration::class,'006_workspace_continuity.sql'],
        [HubUnifiedWorkspaceMigration::class,'007_unified_workspace.sql'],[HubFinalProductMigration::class,'008_final_product.sql'],
        [HubFoundingMemoryMigration::class,'009_founding_memory.sql'],[HubSelfServiceMigration::class,'010_self_service.sql'],
        [HubCentralProjectAuthorityMigration::class,'011_central_project_authority.sql'],[HubAnywhereExecutionMigration::class,'012_anywhere_execution_fabric.sql']
    ] as [$migration,$sql])cr_assert($migration::apply($db,$base.'/migrations/'.$sql,$now)==='applied',$sql);

    $auth=HubOwnerAuthService::openExisting($db);$auth->provisionInitial('art',$password,$now);
    $session=$auth->login('art',$password,true,'core-release-browser',$now);
    $service=HubCoreReleaseService::fromPdo($pdo);
    $legacyPlatformCheckpoint=HubCoreReleaseService::checkpoint(json_encode([
        'schemaVersion'=>1,'mode'=>'CORE_RELEASE','releaseSha'=>str_repeat('a',40),
        'releaseMode'=>'PLATFORM_HARDENING','cleanupTopology'=>false,'transport'=>'LOCAL',
        'releaseNotesSha256'=>str_repeat('b',64),
    ],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR));
    cr_assert(($legacyPlatformCheckpoint['releaseTrack']??null)==='vps-platform','legacy approved PLATFORM_HARDENING checkpoint is normalized to VPS Platform track');
    $operatorSource=(string)file_get_contents($base.'/src/HubCoreReleaseOperator.php');
    cr_assert(str_contains($operatorSource,"in_array(\$checkpointTrack,['awh','vps-platform'],true)"),'legacy approval scope remains valid for exact AWH or VPS Platform parent only');
    cr_assert(str_contains($operatorSource,'$legacyPlatformBootstrap'),'core runner recognizes the bounded legacy Platform bootstrap parent');
    cr_assert(str_contains($operatorSource,"(\$checkpointRaw['releaseMode']??null)==='PLATFORM_HARDENING'"),'legacy bootstrap compatibility requires PLATFORM_HARDENING mode');
    cr_assert(str_contains($operatorSource,"!array_key_exists('releaseTrack',\$checkpointRaw)"),'legacy bootstrap compatibility applies only to checkpoints created before releaseTrack existed');
    cr_assert(str_contains($operatorSource,'$expectedCapability=$legacyPlatformBootstrap?HubCoreReleaseService::CAPABILITY:HubCoreReleaseService::PLATFORM_CAPABILITY'),'legacy Platform parent keeps its original system.core.release approval while modern Platform releases require system.platform.release');
    $serviceSource=(string)file_get_contents($base.'/src/HubCoreReleaseService.php');
    cr_assert(str_contains($serviceSource,'->forMission($missionId)'),'release request reuses the immutable scoped Mission envelope after source promotion');
    cr_assert(!str_contains($serviceSource,'->issueOrResolve($missionId,self::PROJECT_ID,$this->releaseTrack,$at)'),'release request never depends on extending the source-promotion Mission lease');
    $awhMissionTask='913b45c0-23e1-408d-ae0f-ac5eca7f6900';$awhMissionExecution='923b45c0-23e1-408d-ae0f-ac5eca7f6900';
    $platformMissionTask='933b45c0-23e1-408d-ae0f-ac5eca7f6900';$platformMissionExecution='943b45c0-23e1-408d-ae0f-ac5eca7f6900';
    foreach([[$awhMissionTask,$awhMissionExecution,'AWH'],[$platformMissionTask,$platformMissionExecution,'VPS Platform']] as [$missionTask,$missionExecution,$missionLabel]){
        $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,:goal,'RUNNING',NULL,NULL,0,NULL,NULL,:key,NULL,:at,:at,NULL)")
            ->execute(['task'=>$missionTask,'user'=>$owner,'project'=>$project,'goal'=>$missionLabel.' release scope fixture','key'=>'core-release-scope-'.strtolower(str_replace(' ','-',$missionLabel)),'at'=>$now]);
        $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,NULL,'VPS','operator.project_mission','RUNNING','operator-mission',:lease,1,NULL,'{}',NULL,:at,:at)")
            ->execute(['execution'=>$missionExecution,'task'=>$missionTask,'project'=>$project,'lease'=>'2026-09-23T03:00:00+00:00','at'=>$now]);
    }
    $scopeAuthorizer=new HubScopeAuthorizer($pdo);
    $scopeAuthorizer->issueOrResolve($awhMissionExecution,$project,'awh',$now);
    $scopeAuthorizer->issueOrResolve($platformMissionExecution,$project,'vps-platform',$now);
    $promoteTask='a13b45c0-23e1-408d-ae0f-ac5eca7f6900';$promoteExecution='b13b45c0-23e1-408d-ae0f-ac5eca7f6900';$promoteBase=str_repeat('b',40);$promoteTarget=str_repeat('c',40);$sha=$promoteTarget;
    $canonicalGit=$root.'/canonical.git';mkdir($canonicalGit.'/refs/heads',0700,true);file_put_contents($canonicalGit.'/refs/heads/main',$promoteTarget."\n");file_put_contents($canonicalGit.'/refs/heads/production',$promoteBase."\n");putenv('AWH_CORE_CANONICAL_GIT='.$canonicalGit);
    $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,'Promote canonical AWH main','COMPLETED',NULL,NULL,100,'Guarded operator mutation completed',NULL,'core-release-source-promotion-test',NULL,:at,:at,NULL)")->execute(['task'=>$promoteTask,'user'=>$owner,'project'=>$project,'at'=>$now]);
    $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,NULL,'VPS','source.promote','COMPLETED',NULL,NULL,1,NULL,:checkpoint,NULL,:at,:at)")->execute(['execution'=>$promoteExecution,'task'=>$promoteTask,'project'=>$project,'checkpoint'=>json_encode(['repository'=>'awh','expectedMainSha'=>$promoteBase,'targetSha'=>$promoteTarget,'bundleSha256'=>str_repeat('d',64),'missionExecutionId'=>$awhMissionExecution,'releaseNotes'=>cr_release_notes($promoteBase,$promoteTarget)],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'at'=>$now]);
    $sourceStatus=$service->status($session['sessionToken']);
    cr_assert(($sourceStatus['sourcePromotion']['sha']??null)===$promoteTarget&&($sourceStatus['sourcePromotion']['previousSha']??null)===$promoteBase&&($sourceStatus['sourcePromotion']['authority']??null)==='CANONICAL_GIT_MAIN_VERIFIED','core release status verifies the successful source-promotion audit against canonical Git main');
    cr_assert(($sourceStatus['releaseDetailsReady']??null)===true&&array_key_exists('releaseBlocker',$sourceStatus)&&$sourceStatus['releaseBlocker']===null,'core release status exposes release metadata readiness before mutation');
    $pdo->prepare('UPDATE control_sessions SET step_up_at=NULL WHERE session_hash=:hash')->execute(['hash'=>hash('sha256',$session['sessionToken'])]);

    $request=$service->request($session['sessionToken'],$session['csrfToken'],['schemaVersion'=>1,'releaseSha'=>$sha,'cleanupTopology'=>false],$now);
    cr_assert(($request['state']??null)==='WAITING_FOR_WORKER','signed-in Owner request goes directly to the canonical worker queue without repeated password or approval prompts');
    $task=(string)$request['taskId'];$execution=(string)$request['executionId'];$approval=(string)$request['approvalId'];

    $taskRow=$pdo->query("SELECT state,progress,project_id FROM control_tasks WHERE task_id=".$pdo->quote($task))->fetch();
    $executionRow=$pdo->query("SELECT state,executor_kind,required_capability,checkpoint_json,attempt_count FROM control_task_executions WHERE execution_id=".$pdo->quote($execution))->fetch();
    $approvalRow=$pdo->query("SELECT action,status,scope_json,decided_at FROM control_approvals WHERE approval_id=".$pdo->quote($approval))->fetch();
    $queuedEnvelope=$pdo->query("SELECT state,mutation_scope,lease_expires_at FROM control_execution_envelopes WHERE execution_id=".$pdo->quote($execution))->fetch();
    cr_assert(is_array($taskRow)&&$taskRow['state']==='WAITING_FOR_WORKER'&&(string)$taskRow['project_id']===$project,'task uses canonical AWH project and is immediately dispatchable');
    cr_assert(is_array($executionRow)&&$executionRow['state']==='QUEUED'&&$executionRow['executor_kind']==='VPS'&&$executionRow['required_capability']===HubCoreReleaseService::CAPABILITY,'execution uses canonical VPS capability');
    cr_assert(is_array($queuedEnvelope)&&$queuedEnvelope['state']==='OPEN'&&$queuedEnvelope['mutation_scope']==='EXTERNAL'&&$queuedEnvelope['lease_expires_at']===null,'queued core release has a canonical execution envelope before dispatcher claim');
    cr_assert(HubCapabilityRegistryService::mutationResourceForExecution(HubCoreReleaseService::CAPABILITY,'VPS')==='CANONICAL:DEPLOY:AWH','core release envelope maps to the typed AWH deploy resource');
    $checkpoint=HubCoreReleaseService::checkpoint((string)$executionRow['checkpoint_json']);
    cr_assert($checkpoint['releaseSha']===$sha&&$checkpoint['transport']==='LOCAL'&&$checkpoint['releaseMode']==='AWH_CORE'&&$checkpoint['releaseTrack']==='awh','checkpoint binds exact approved AWH release identity');
    cr_assert(!array_key_exists('command',$checkpoint)&&!array_key_exists('path',$checkpoint)&&!array_key_exists('script',$checkpoint),'browser checkpoint cannot inject command or path');
    cr_assert(is_array($approvalRow)&&$approvalRow['action']==='deployment.approve'&&$approvalRow['status']==='APPROVED'&&is_string($approvalRow['decided_at']),'canonical deployment approval is recorded automatically as Owner audit evidence');

    $pdo->prepare("UPDATE control_tasks SET state='WAITING_FOR_APPROVAL',updated_at=:at WHERE task_id=:task")->execute(['at'=>$now,'task'=>$task]);
    $pdo->prepare("UPDATE control_approvals SET status='PENDING',decided_at=NULL,expires_at=:expires WHERE approval_id=:approval")->execute(['expires'=>'2026-09-23T01:20:00+00:00','approval'=>$approval]);
    $duplicate=$service->request($session['sessionToken'],$session['csrfToken'],['schemaVersion'=>1,'releaseSha'=>$sha,'cleanupTopology'=>false],$now);
    cr_assert(($duplicate['idempotent']??false)===true&&$duplicate['taskId']===$task&&($duplicate['state']??null)==='WAITING_FOR_WORKER','same active legacy-pending release resumes the existing task without a second release');
    cr_assert($pdo->query("SELECT status FROM control_approvals WHERE approval_id=".$pdo->quote($approval))->fetchColumn()==='APPROVED','legacy pending approval is converted into Owner audit evidence by the repeated Update action');
    cr_assert((int)$pdo->query("SELECT count(*) FROM control_task_executions WHERE required_capability='system.core.release'")->fetchColumn()===1,'legacy recovery never creates a duplicate core release execution');

    $control=HubControlPlaneService::openExisting($db);
    cr_assert($pdo->query("SELECT state FROM control_tasks WHERE task_id=".$pdo->quote($task))->fetchColumn()==='WAITING_FOR_WORKER','Owner request is already on the existing worker queue');

    $fake=$root.'/awh-core-release-run.php';file_put_contents($fake,"<?php\n");
    $calls=[];$unitState='active';
    $runner=static function(array $command,?array $options=null)use(&$calls,&$unitState):array{$calls[]=$command;return ['code'=>0,'out'=>str_contains(implode(' ',$command),'systemctl is-active')?$unitState."\n":'','err'=>''];};
    $operator=new HubCoreReleaseOperator($pdo,$fake,$runner);
    $dispatch=$operator->tick('2026-09-23T01:00:01+00:00');
    cr_assert(($dispatch['state']??null)==='DISPATCHED'&&($dispatch['executionId']??null)===$execution,'approved core release is dispatched');
    cr_assert(count($calls)===1&&($calls[0][0]??null)==='/usr/bin/systemd-run','dispatcher uses fixed systemd-run binary');
    cr_assert(in_array('/usr/bin/php',$calls[0],true)&&in_array($fake,$calls[0],true)&&in_array($execution,$calls[0],true),'dispatcher passes only immutable runner and execution UUID');
    cr_assert(!in_array($sha,$calls[0],true)&&!in_array('rm',$calls[0],true)&&!in_array('sh',$calls[0],true),'release SHA and shell text are not command arguments');

    $running=$pdo->query("SELECT state,lease_owner,attempt_count FROM control_task_executions WHERE execution_id=".$pdo->quote($execution))->fetch();
    $activeEnvelope=$pdo->query("SELECT state,mutation_scope,lease_expires_at FROM control_execution_envelopes WHERE execution_id=".$pdo->quote($execution))->fetch();
    cr_assert(is_array($running)&&$running['state']==='RUNNING'&&str_starts_with((string)$running['lease_owner'],'core-release:')&&(int)$running['attempt_count']===1,'dispatcher records one leased transient execution');
    cr_assert(is_array($activeEnvelope)&&$activeEnvelope['state']==='ACTIVE'&&$activeEnvelope['mutation_scope']==='EXTERNAL'&&is_string($activeEnvelope['lease_expires_at']),'dispatcher activates typed release authority before the execution becomes RUNNING');

    // E2E queue regression: A is RUNNING, a real Platform service request for B must be admitted
    // as WAITING_FOR_WORKER/QUEUED, remain queued while A is active, then dispatch automatically
    // on the first operator tick after A reaches a terminal state.
    $platformBase=$promoteBase;$platformSha=str_repeat('9',40);
    if(!is_dir($canonicalGit.'/refs/heads/platform'))mkdir($canonicalGit.'/refs/heads/platform',0700,true);
    file_put_contents($canonicalGit.'/refs/heads/platform/production',$platformBase."\n");
    file_put_contents($canonicalGit.'/refs/heads/main',$platformSha."\n");
    $platformPromoteTask='c23b45c0-23e1-408d-ae0f-ac5eca7f6900';$platformPromoteExecution='d23b45c0-23e1-408d-ae0f-ac5eca7f6900';
    $platformNotes=cr_release_notes($sha,$platformSha,'vps-platform');
    $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,'Promote queued Platform fixture','COMPLETED',NULL,NULL,100,'Guarded operator mutation completed',NULL,'queue-e2e-platform-source-promotion',NULL,:at,:at,NULL)")
        ->execute(['task'=>$platformPromoteTask,'user'=>$owner,'project'=>$project,'at'=>'2026-09-23T01:00:02+00:00']);
    $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,NULL,'VPS','source.promote','COMPLETED',NULL,NULL,1,NULL,:checkpoint,NULL,:at,:at)")
        ->execute(['execution'=>$platformPromoteExecution,'task'=>$platformPromoteTask,'project'=>$project,'checkpoint'=>json_encode(['repository'=>'awh','expectedMainSha'=>$sha,'targetSha'=>$platformSha,'bundleSha256'=>str_repeat('7',64),'missionExecutionId'=>$platformMissionExecution,'releaseNotes'=>$platformNotes],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'at'=>'2026-09-23T01:00:02+00:00']);
    $platformService=HubCoreReleaseService::platformFromPdo($pdo);
    $queuedB=$platformService->request($session['sessionToken'],$session['csrfToken'],['schemaVersion'=>1,'releaseSha'=>$platformSha,'cleanupTopology'=>false],'2026-09-23T01:00:02+00:00');
    cr_assert(($queuedB['state']??null)==='WAITING_FOR_WORKER','B request is admitted while A is RUNNING');
    $queuedBExecution=(string)$queuedB['executionId'];$queuedBTask=(string)$queuedB['taskId'];
    cr_assert($pdo->query("SELECT state FROM control_task_executions WHERE execution_id=".$pdo->quote($queuedBExecution))->fetchColumn()==='QUEUED','B execution persists as QUEUED behind running A');

    $whileA=$operator->tick('2026-09-23T01:00:03+00:00');
    cr_assert(($whileA['state']??null)==='RUNNING'&&($whileA['executionId']??null)===$execution,'operator observes A as RUNNING instead of claiming B');
    cr_assert($pdo->query("SELECT state FROM control_task_executions WHERE execution_id=".$pdo->quote($queuedBExecution))->fetchColumn()==='QUEUED'
        &&$pdo->query("SELECT state FROM control_tasks WHERE task_id=".$pdo->quote($queuedBTask))->fetchColumn()==='WAITING_FOR_WORKER','B remains queued while A is active');

    $pdo->prepare("UPDATE control_task_executions SET state='COMPLETED',lease_owner=NULL,lease_expires_at=NULL,updated_at=:at WHERE execution_id=:execution")->execute(['at'=>'2026-09-23T01:00:04+00:00','execution'=>$execution]);
    $pdo->prepare("UPDATE control_tasks SET state='COMPLETED',progress=100,updated_at=:at WHERE task_id=:task")->execute(['at'=>'2026-09-23T01:00:04+00:00','task'=>$task]);
    $afterA=$operator->tick('2026-09-23T01:00:05+00:00');
    cr_assert(($afterA['state']??null)==='DISPATCHED'&&($afterA['executionId']??null)===$queuedBExecution,'B starts automatically on the next operator tick after A completes');
    cr_assert($pdo->query("SELECT state FROM control_task_executions WHERE execution_id=".$pdo->quote($queuedBExecution))->fetchColumn()==='RUNNING'
        &&$pdo->query("SELECT state FROM control_tasks WHERE task_id=".$pdo->quote($queuedBTask))->fetchColumn()==='RUNNING','B transitions QUEUED to RUNNING without a second request');
    $pdo->prepare("UPDATE control_task_executions SET state='COMPLETED',lease_owner=NULL,lease_expires_at=NULL,updated_at=:at WHERE execution_id=:execution")->execute(['at'=>'2026-09-23T01:00:06+00:00','execution'=>$queuedBExecution]);
    $pdo->prepare("UPDATE control_tasks SET state='COMPLETED',progress=100,updated_at=:at WHERE task_id=:task")->execute(['at'=>'2026-09-23T01:00:06+00:00','task'=>$queuedBTask]);
    file_put_contents($canonicalGit.'/refs/heads/platform/production',$platformSha."\n");

    // Finish the fixture execution, then simulate an approved release stranded while the dispatcher heartbeat expires.
    $pdo->prepare("UPDATE control_task_executions SET state='COMPLETED',lease_owner=NULL,lease_expires_at=NULL,updated_at=:at WHERE execution_id=:execution")->execute(['at'=>'2026-09-23T01:01:00+00:00','execution'=>$execution]);
    $pdo->prepare("UPDATE control_tasks SET state='COMPLETED',progress=100,updated_at=:at WHERE task_id=:task")->execute(['at'=>'2026-09-23T01:01:00+00:00','task'=>$task]);
    file_put_contents($canonicalGit.'/refs/heads/production',$sha."
");
    $completedDuplicate=$service->request($session['sessionToken'],$session['csrfToken'],['schemaVersion'=>1,'releaseSha'=>$sha,'cleanupTopology'=>false],'2026-09-23T01:01:01+00:00');
    cr_assert(($completedDuplicate['idempotent']??false)===true&&$completedDuplicate['taskId']===$task&&$completedDuplicate['executionId']===$execution&&($completedDuplicate['state']??null)==='COMPLETED','same already-running production release is a verified no-op and reuses the completed operation');
    cr_assert((int)$pdo->query("SELECT count(*) FROM control_task_executions WHERE required_capability='system.core.release'")->fetchColumn()===1,'completed duplicate action never creates a second core release execution');
    $firstKey=(string)$pdo->query("SELECT idempotency_key FROM control_tasks WHERE task_id=".$pdo->quote($task))->fetchColumn();
    cr_assert(str_starts_with($firstKey,$project.'.awh.release.'.substr($sha,0,12).'.'.substr(str_repeat('d',64),0,16).'.cleanup0.attempt'),'release idempotency key is deterministic by project, track, candidate, artifact and operation shape rather than task UUID');
    $staleSha=str_repeat('d',40);$nextSha=str_repeat('e',40);
    $stalePromoteTask='e13b45c0-23e1-408d-ae0f-ac5eca7f6900';$stalePromoteExecution='f13b45c0-23e1-408d-ae0f-ac5eca7f6900';
    $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,'Promote stale fixture','COMPLETED',NULL,NULL,100,'Guarded operator mutation completed',NULL,'core-release-source-promotion-stale',NULL,:at,:at,NULL)")->execute(['task'=>$stalePromoteTask,'user'=>$owner,'project'=>$project,'at'=>'2026-09-23T01:01:09+00:00']);
    $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,NULL,'VPS','source.promote','COMPLETED',NULL,NULL,1,NULL,:checkpoint,NULL,:at,:at)")->execute(['execution'=>$stalePromoteExecution,'task'=>$stalePromoteTask,'project'=>$project,'checkpoint'=>json_encode(['repository'=>'awh','expectedMainSha'=>$promoteTarget,'targetSha'=>$staleSha,'bundleSha256'=>str_repeat('f',64),'missionExecutionId'=>$awhMissionExecution,'releaseNotes'=>cr_release_notes($promoteTarget,$staleSha)],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'at'=>'2026-09-23T01:01:09+00:00']);
    file_put_contents($canonicalGit.'/refs/heads/main',$staleSha."\n");
    $stale=$service->request($session['sessionToken'],$session['csrfToken'],['schemaVersion'=>1,'releaseSha'=>$staleSha,'cleanupTopology'=>false],'2026-09-23T01:01:10+00:00');
    $nextPromoteTask='a23b45c0-23e1-408d-ae0f-ac5eca7f6900';$nextPromoteExecution='b23b45c0-23e1-408d-ae0f-ac5eca7f6900';
    $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,'Promote replacement fixture','COMPLETED',NULL,NULL,100,'Guarded operator mutation completed',NULL,'core-release-source-promotion-next',NULL,:at,:at,NULL)")->execute(['task'=>$nextPromoteTask,'user'=>$owner,'project'=>$project,'at'=>'2026-09-23T01:09:59+00:00']);
    $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,NULL,'VPS','source.promote','COMPLETED',NULL,NULL,1,NULL,:checkpoint,NULL,:at,:at)")->execute(['execution'=>$nextPromoteExecution,'task'=>$nextPromoteTask,'project'=>$project,'checkpoint'=>json_encode(['repository'=>'awh','expectedMainSha'=>$staleSha,'targetSha'=>$nextSha,'bundleSha256'=>str_repeat('1',64),'missionExecutionId'=>$awhMissionExecution,'releaseNotes'=>cr_release_notes($staleSha,$nextSha)],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'at'=>'2026-09-23T01:09:59+00:00']);
    file_put_contents($canonicalGit.'/refs/heads/main',$nextSha."\n");
    $next=$service->request($session['sessionToken'],$session['csrfToken'],['schemaVersion'=>1,'releaseSha'=>$nextSha,'cleanupTopology'=>false],'2026-09-23T01:10:00+00:00');
    cr_assert(($next['state']??null)==='WAITING_FOR_WORKER'&&($next['releaseSha']??null)===$nextSha,'stale approved release is reconciled before a new request and the replacement is immediately dispatchable');
    cr_assert($pdo->query("SELECT state FROM control_task_executions WHERE execution_id=".$pdo->quote((string)$stale['executionId']))->fetchColumn()==='FAILED','stale queued release is failed closed');
    cr_assert($pdo->query("SELECT failure_code FROM control_tasks WHERE task_id=".$pdo->quote((string)$stale['taskId']))->fetchColumn()==='CORE_RELEASE_DISPATCHER_UNAVAILABLE','stale release records dispatcher outage');

    $legacyPlatformSha=str_repeat('f',40);
    $legacyPlatformTask='c13b45c0-23e1-408d-ae0f-ac5eca7f6900';
    $legacyPlatformExecution='d13b45c0-23e1-408d-ae0f-ac5eca7f6900';
    $legacyPlatformNotes=cr_release_notes($nextSha,$legacyPlatformSha);unset($legacyPlatformNotes['releaseTrack']);
    $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,'Legacy Platform source promotion','COMPLETED',NULL,NULL,100,'Legacy source promotion completed',NULL,'legacy-platform-source-promotion',NULL,:at,:at,NULL)")
        ->execute(['task'=>$legacyPlatformTask,'user'=>$owner,'project'=>$project,'at'=>'2026-09-23T01:20:00+00:00']);
    $legacyCheckpoint=['repository'=>'awh','expectedMainSha'=>$nextSha,'targetSha'=>$legacyPlatformSha,'bundleSha256'=>str_repeat('2',64),'releaseNotes'=>$legacyPlatformNotes];
    $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,NULL,'VPS','source.promote','COMPLETED',NULL,NULL,1,NULL,:checkpoint,NULL,:at,:at)")
        ->execute(['execution'=>$legacyPlatformExecution,'task'=>$legacyPlatformTask,'project'=>$project,'checkpoint'=>json_encode($legacyCheckpoint,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'at'=>'2026-09-23T01:20:00+00:00']);
    if(!is_dir($canonicalGit.'/refs/heads/platform'))mkdir($canonicalGit.'/refs/heads/platform',0700,true);
    file_put_contents($canonicalGit.'/refs/heads/main',$legacyPlatformSha."\n");
    file_put_contents($canonicalGit.'/refs/heads/platform/production',$legacyPlatformSha."\n");
    $platformService=HubCoreReleaseService::platformFromPdo($pdo);
    $platformStatus=$platformService->status($session['sessionToken']);
    cr_assert(($platformStatus['sourcePromotion']['sha']??null)!==$legacyPlatformSha,'VPS Platform never reclassifies a legacy no-track promotion from the current platform pointer');
    $awhAfterBootstrap=$service->status($session['sessionToken']);
    cr_assert(($awhAfterBootstrap['sourcePromotion']['sha']??null)===$legacyPlatformSha&&($awhAfterBootstrap['sourcePromotion']['releaseTrack']??null)==='awh','legacy no-track promotion remains on the AWH source chain');

    cr_assert($pdo->query('PRAGMA integrity_check')->fetchColumn()==='ok'&&$pdo->query('PRAGMA foreign_key_check')->fetchAll()===[],'core release flow preserves database integrity');

    fwrite(STDOUT,"AWH core release operator: PASS\n");
}finally{
    putenv('AWH_ARTIFACT_ROOT');putenv('AWH_PROJECT_VAULT_ROOT');putenv('AWH_TASK_WORKSPACE_ROOT');putenv('AWH_CORE_CANONICAL_GIT');cr_clean($root);
}
