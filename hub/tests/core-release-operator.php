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

if(!in_array('sqlite',PDO::getAvailableDrivers(),true)){fwrite(STDOUT,"AWH core release operator: SKIP pdo_sqlite unavailable\n");exit(77);}

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
    $service=HubCoreReleaseService::fromPdo($pdo);$sha=str_repeat('a',40);
    $pdo->prepare('UPDATE control_sessions SET step_up_at=NULL WHERE session_hash=:hash')->execute(['hash'=>hash('sha256',$session['sessionToken'])]);

    try{
        $service->request($session['sessionToken'],$session['csrfToken'],['schemaVersion'=>1,'releaseSha'=>$sha,'cleanupTopology'=>false],$now);
        throw new RuntimeException('core release request bypassed step-up');
    }catch(HubCoreReleaseException $error){
        cr_assert($error->codeName==='STEP_UP_REQUIRED','core release requires recent password step-up');
    }

    $auth->stepUp($session['sessionToken'],$session['csrfToken'],$password);
    $request=$service->request($session['sessionToken'],$session['csrfToken'],['schemaVersion'=>1,'releaseSha'=>$sha,'cleanupTopology'=>false],$now);
    cr_assert(($request['state']??null)==='WAITING_FOR_APPROVAL','core release waits for owner approval');
    $task=(string)$request['taskId'];$execution=(string)$request['executionId'];$approval=(string)$request['approvalId'];

    $taskRow=$pdo->query("SELECT state,progress,project_id FROM control_tasks WHERE task_id=".$pdo->quote($task))->fetch();
    $executionRow=$pdo->query("SELECT state,executor_kind,required_capability,checkpoint_json,attempt_count FROM control_task_executions WHERE execution_id=".$pdo->quote($execution))->fetch();
    $approvalRow=$pdo->query("SELECT action,status,scope_json FROM control_approvals WHERE approval_id=".$pdo->quote($approval))->fetch();
    cr_assert(is_array($taskRow)&&$taskRow['state']==='WAITING_FOR_APPROVAL'&&(string)$taskRow['project_id']===$project,'task uses canonical AWH project');
    cr_assert(is_array($executionRow)&&$executionRow['state']==='QUEUED'&&$executionRow['executor_kind']==='VPS'&&$executionRow['required_capability']===HubCoreReleaseService::CAPABILITY,'execution uses canonical VPS capability');
    $checkpoint=HubCoreReleaseService::checkpoint((string)$executionRow['checkpoint_json']);
    cr_assert($checkpoint['releaseSha']===$sha&&$checkpoint['transport']==='LOCAL'&&$checkpoint['releaseMode']==='PROJECT_SOURCE_AUTHORITY','checkpoint binds only approved release identity');
    cr_assert(!array_key_exists('command',$checkpoint)&&!array_key_exists('path',$checkpoint)&&!array_key_exists('script',$checkpoint),'browser checkpoint cannot inject command or path');
    cr_assert(is_array($approvalRow)&&$approvalRow['action']==='deployment.approve'&&$approvalRow['status']==='PENDING','canonical deployment approval is created');

    $duplicate=$service->request($session['sessionToken'],$session['csrfToken'],['schemaVersion'=>1,'releaseSha'=>$sha,'cleanupTopology'=>false],$now);
    cr_assert(($duplicate['idempotent']??false)===true&&$duplicate['taskId']===$task,'same active release request is idempotent');

    $control=HubControlPlaneService::openExisting($db);
    $decided=$control->decideApproval($session['sessionToken'],$session['csrfToken'],$approval,'APPROVED',$now);
    cr_assert(($decided['status']??null)==='APPROVED','owner approval is recorded');
    cr_assert($pdo->query("SELECT state FROM control_tasks WHERE task_id=".$pdo->quote($task))->fetchColumn()==='WAITING_FOR_WORKER','approved release returns to existing worker queue');

    $fake=$root.'/awh-core-release-run.php';file_put_contents($fake,"<?php\n");
    $calls=[];
    $runner=static function(array $command,?array $options=null)use(&$calls):array{$calls[]=$command;return ['code'=>0,'out'=>str_contains(implode(' ',$command),'systemctl is-active')?'inactive\n':'','err'=>''];};
    $operator=new HubCoreReleaseOperator($pdo,$fake,$runner);
    $dispatch=$operator->tick('2026-09-23T01:00:01+00:00');
    cr_assert(($dispatch['state']??null)==='DISPATCHED'&&($dispatch['executionId']??null)===$execution,'approved core release is dispatched');
    cr_assert(count($calls)===1&&($calls[0][0]??null)==='/usr/bin/systemd-run','dispatcher uses fixed systemd-run binary');
    cr_assert(in_array('/usr/bin/php',$calls[0],true)&&in_array($fake,$calls[0],true)&&in_array($execution,$calls[0],true),'dispatcher passes only immutable runner and execution UUID');
    cr_assert(!in_array($sha,$calls[0],true)&&!in_array('rm',$calls[0],true)&&!in_array('sh',$calls[0],true),'release SHA and shell text are not command arguments');

    $running=$pdo->query("SELECT state,lease_owner,attempt_count FROM control_task_executions WHERE execution_id=".$pdo->quote($execution))->fetch();
    cr_assert(is_array($running)&&$running['state']==='RUNNING'&&str_starts_with((string)$running['lease_owner'],'core-release:')&&(int)$running['attempt_count']===1,'dispatcher records one leased transient execution');
    cr_assert($pdo->query('PRAGMA integrity_check')->fetchColumn()==='ok'&&$pdo->query('PRAGMA foreign_key_check')->fetchAll()===[],'core release flow preserves database integrity');

    fwrite(STDOUT,"AWH core release operator: PASS\n");
}finally{
    putenv('AWH_ARTIFACT_ROOT');putenv('AWH_PROJECT_VAULT_ROOT');putenv('AWH_TASK_WORKSPACE_ROOT');cr_clean($root);
}
