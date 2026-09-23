<?php

declare(strict_types=1);

foreach ([
    'HubSchemaMigration','HubEnrollmentApiMigration','HubControlPlaneMigration','HubOwnerAuthMigration',
    'HubAssistantWorkstreamMigration','HubWorkspaceContinuityMigration','HubUnifiedWorkspaceMigration',
    'HubFinalProductMigration','HubFoundingMemoryMigration','HubSelfServiceMigration',
    'HubCentralProjectAuthorityMigration','HubAnywhereExecutionMigration','HubEnrollmentService',
    'HubOwnerAuthService','HubControlPlaneService','HubLearnLabReleaseService','HubLearnLabReleaseOperator',
    'HubCapabilityRegistryService'
] as $class) require_once dirname(__DIR__) . '/src/' . $class . '.php';

function llr_assert(bool $value,string $message): void { if(!$value)throw new RuntimeException($message); }
function llr_clean(string $root): void {
    if(!is_dir($root))return;
    $it=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST);
    foreach($it as $f){$p=$f->getPathname();$f->isDir()&&!$f->isLink()?@rmdir($p):@unlink($p);}
    @rmdir($root);
}
if(!in_array('sqlite',PDO::getAvailableDrivers(),true)){fwrite(STDOUT,"AWH LearnLab release operator: SKIP pdo_sqlite unavailable\n");exit(77);}

$root=sys_get_temp_dir().'/awh-learnlab-release-'.bin2hex(random_bytes(6));
$db=$root.'/awh.sqlite';$base=dirname(__DIR__);$now='2026-09-23T11:50:00+00:00';
$project=HubLearnLabReleaseService::PROJECT_ID;$owner='223b45c0-23e1-408d-ae0f-ac5eca7f6900';
$password='learnlab-release-'.bin2hex(random_bytes(10));$vaultRevision='b088db09-1ac5-484d-b707-e9901176b073';
$artifact=$root.'/artifacts';$vault=$root.'/vault';$workspace=$root.'/workspaces';
putenv('AWH_ARTIFACT_ROOT='.$artifact);putenv('AWH_PROJECT_VAULT_ROOT='.$vault);putenv('AWH_TASK_WORKSPACE_ROOT='.$workspace);

try{
    mkdir($root,0700,true);foreach([$artifact,$vault,$workspace] as $d)mkdir($d,0700,true);
    $pdo=new PDO('sqlite:'.$db,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys=ON');$pdo->exec(file_get_contents($base.'/schema.sql'));
    foreach(['enrollment_rate_limits','device_project_memberships','device_tokens','pairing_projects','pairing_codes','user_project_memberships','device_enrollments','owner_bootstrap','hub_users'] as $table)$pdo->exec('DROP TABLE IF EXISTS '.$table);
    $pdo->prepare('INSERT INTO projects(project_id,name,type,created_at,source_revision,observed_at,provenance) VALUES(:id,:name,:type,:at,NULL,:at,:provenance)')
        ->execute(['id'=>$project,'name'=>'BAY LearnLab','type'=>'system','at'=>$now,'provenance'=>'learnlab-release-test']);
    llr_assert(HubSchemaMigration::apply($db,$base.'/migrations/001_m3e_enrollment.sql',$now,false,$base.'/schema.sql')==='applied','M3E');
    llr_assert(HubEnrollmentApiMigration::apply($db,$base.'/migrations/002_m3e2_enrollment_api.sql',$now)==='applied','M3E2');
    HubEnrollmentService::openExisting($db)->initializeOwner($owner,'Art Owner',[$project],$now);
    foreach([
        [HubControlPlaneMigration::class,'003_m4_control_plane.sql'],[HubOwnerAuthMigration::class,'004_owner_auth.sql'],
        [HubAssistantWorkstreamMigration::class,'005_assistant_workstream.sql'],[HubWorkspaceContinuityMigration::class,'006_workspace_continuity.sql'],
        [HubUnifiedWorkspaceMigration::class,'007_unified_workspace.sql'],[HubFinalProductMigration::class,'008_final_product.sql'],
        [HubFoundingMemoryMigration::class,'009_founding_memory.sql'],[HubSelfServiceMigration::class,'010_self_service.sql'],
        [HubCentralProjectAuthorityMigration::class,'011_central_project_authority.sql'],[HubAnywhereExecutionMigration::class,'012_anywhere_execution_fabric.sql']
    ] as [$migration,$sql])llr_assert($migration::apply($db,$base.'/migrations/'.$sql,$now)==='applied',$sql);

    $pdo->prepare("INSERT INTO control_project_vaults(project_id,storage_mode,active_revision_id,sync_state,content_bytes,file_count,updated_at) VALUES(:project,'VAULT',:revision,'SYNCED',1,1,:at)")
        ->execute(['project'=>$project,'revision'=>$vaultRevision,'at'=>$now]);

    $auth=HubOwnerAuthService::openExisting($db);$auth->provisionInitial('art',$password,$now);
    $session=$auth->login('art',$password,true,'learnlab-release-browser',$now);
    $service=HubLearnLabReleaseService::fromPdo($pdo);
    $status=$service->status($session['sessionToken']);
    llr_assert(($status['capability']??null)===HubLearnLabReleaseService::CAPABILITY,'status exposes typed LearnLab release capability');
    llr_assert(($status['current']['releaseSha']??null)==='406879b6fee7a1e8a451f24eb3a3d9825a4fe0c9','status reads exact live LearnLab channel authority');
    llr_assert(($status['current']['cacheEpoch']??null)===68,'status reads exact live cache epoch');

    $release=str_repeat('a',40);$version='0.8.1-rc.1';
    $pdo->prepare('UPDATE control_sessions SET step_up_at=NULL WHERE session_hash=:hash')->execute(['hash'=>hash('sha256',$session['sessionToken'])]);
    try{
        $service->request($session['sessionToken'],$session['csrfToken'],['schemaVersion'=>1,'releaseSha'=>$release,'runtimeVersion'=>$version],$now);
        throw new RuntimeException('LearnLab release bypassed step-up');
    }catch(HubLearnLabReleaseException $error){
        llr_assert($error->codeName==='STEP_UP_REQUIRED','LearnLab release requires owner password step-up');
    }

    $auth->stepUp($session['sessionToken'],$session['csrfToken'],$password);
    $request=$service->request($session['sessionToken'],$session['csrfToken'],['schemaVersion'=>1,'releaseSha'=>$release,'runtimeVersion'=>$version],$now);
    llr_assert(($request['state']??null)==='WAITING_FOR_APPROVAL','LearnLab release waits for owner approval');
    $task=(string)$request['taskId'];$execution=(string)$request['executionId'];$approval=(string)$request['approvalId'];

    $executionRow=$pdo->query("SELECT state,executor_kind,required_capability,checkpoint_json,attempt_count FROM control_task_executions WHERE execution_id=".$pdo->quote($execution))->fetch();
    llr_assert(is_array($executionRow)&&$executionRow['state']==='QUEUED'&&$executionRow['executor_kind']==='VPS'
        &&$executionRow['required_capability']===HubLearnLabReleaseService::CAPABILITY,'execution uses one canonical VPS capability');
    $checkpoint=HubLearnLabReleaseService::checkpoint((string)$executionRow['checkpoint_json']);
    llr_assert($checkpoint['releaseSha']===$release&&$checkpoint['baseReleaseSha']==='406879b6fee7a1e8a451f24eb3a3d9825a4fe0c9'
        &&$checkpoint['runtimeVersion']===$version&&$checkpoint['cacheEpoch']===69&&$checkpoint['expectedVaultRevisionId']===$vaultRevision,'checkpoint binds release/base/version/epoch/vault');
    llr_assert(!array_key_exists('command',$checkpoint)&&!array_key_exists('path',$checkpoint)&&!array_key_exists('script',$checkpoint),'browser checkpoint cannot inject shell or path');

    $scope=json_decode((string)$pdo->query("SELECT scope_json FROM control_approvals WHERE approval_id=".$pdo->quote($approval))->fetchColumn(),true,16,JSON_THROW_ON_ERROR);
    llr_assert(($scope['releaseSha']??null)===$release&&($scope['baseReleaseSha']??null)===$checkpoint['baseReleaseSha']
        &&($scope['runtimeVersion']??null)===$version&&($scope['cacheEpoch']??null)===69&&($scope['expectedVaultRevisionId']??null)===$vaultRevision,'approval scope freezes the exact release identity');

    $duplicate=$service->request($session['sessionToken'],$session['csrfToken'],['schemaVersion'=>1,'releaseSha'=>$release,'runtimeVersion'=>$version],$now);
    llr_assert(($duplicate['idempotent']??false)===true&&$duplicate['taskId']===$task,'same active LearnLab release request is idempotent');

    $control=HubControlPlaneService::openExisting($db);
    $decided=$control->decideApproval($session['sessionToken'],$session['csrfToken'],$approval,'APPROVED',$now);
    llr_assert(($decided['status']??null)==='APPROVED','owner approval is recorded by canonical approval flow');
    llr_assert($pdo->query("SELECT state FROM control_tasks WHERE task_id=".$pdo->quote($task))->fetchColumn()==='WAITING_FOR_WORKER','approved LearnLab release returns to canonical worker queue');

    $fakeRunner=$root.'/awh-learnlab-release-run.php';$fakeEngine=$root.'/awh-learnlab-release-engine.py';
    file_put_contents($fakeRunner,"<?php\n");file_put_contents($fakeEngine,"#!/usr/bin/env python3\n");
    $calls=[];
    $runner=static function(array $command,?array $options=null)use(&$calls):array{
        $calls[]=$command;return ['code'=>0,'out'=>str_contains(implode(' ',$command),'systemctl is-active')?"inactive\n":'','err'=>''];
    };
    $operator=new HubLearnLabReleaseOperator($pdo,$fakeRunner,$fakeEngine,$runner);
    $dispatch=$operator->tick('2026-09-23T11:50:01+00:00');
    llr_assert(($dispatch['state']??null)==='DISPATCHED'&&($dispatch['executionId']??null)===$execution,'approved LearnLab release is dispatched');
    llr_assert(count($calls)===1&&($calls[0][0]??null)==='/usr/bin/systemd-run','dispatcher uses fixed systemd-run binary');
    llr_assert(in_array('/usr/bin/php',$calls[0],true)&&in_array($fakeRunner,$calls[0],true)&&in_array($execution,$calls[0],true),'dispatcher passes immutable runner and execution UUID');
    llr_assert(!in_array($release,$calls[0],true)&&!in_array($version,$calls[0],true)&&!in_array('sh',$calls[0],true),'release identity and shell text are not command arguments');

    $running=$pdo->query("SELECT state,lease_owner,attempt_count FROM control_task_executions WHERE execution_id=".$pdo->quote($execution))->fetch();
    llr_assert(is_array($running)&&$running['state']==='RUNNING'&&str_starts_with((string)$running['lease_owner'],'learnlab-release:')
        &&(int)$running['attempt_count']===1,'dispatcher records one leased transient execution');

    llr_assert(HubCapabilityRegistryService::mutationResourceForExecution(HubLearnLabReleaseService::CAPABILITY,'VPS')==='CANONICAL:DEPLOY','LearnLab release uses canonical deploy resource');
    llr_assert(HubCapabilityRegistryService::mutationResourcesConflict('CANONICAL:DEPLOY','CANONICAL:DEPLOY')===true,'LearnLab and core deploys serialize on one writer resource');
    llr_assert($pdo->query('PRAGMA integrity_check')->fetchColumn()==='ok'&&$pdo->query('PRAGMA foreign_key_check')->fetchAll()===[],'LearnLab release flow preserves database integrity');

    fwrite(STDOUT,"AWH LearnLab release operator: PASS\n");
}finally{
    putenv('AWH_ARTIFACT_ROOT');putenv('AWH_PROJECT_VAULT_ROOT');putenv('AWH_TASK_WORKSPACE_ROOT');llr_clean($root);
}

