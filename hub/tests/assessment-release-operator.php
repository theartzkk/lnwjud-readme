<?php

declare(strict_types=1);

foreach ([
    'HubSchemaMigration','HubEnrollmentApiMigration','HubControlPlaneMigration','HubOwnerAuthMigration',
    'HubAssistantWorkstreamMigration','HubWorkspaceContinuityMigration','HubUnifiedWorkspaceMigration',
    'HubFinalProductMigration','HubFoundingMemoryMigration','HubSelfServiceMigration',
    'HubCentralProjectAuthorityMigration','HubAnywhereExecutionMigration','HubEnrollmentService',
    'HubOwnerAuthService','HubControlPlaneService','HubAssessmentReleaseService','HubAssessmentReleaseOperator',
    'HubCapabilityRegistryService'
] as $class) require_once dirname(__DIR__) . '/src/' . $class . '.php';

function ar_assert(bool $value,string $message): void { if(!$value)throw new RuntimeException($message); }
function ar_clean(string $root): void {
    if(!is_dir($root))return;
    $it=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST);
    foreach($it as $f){$p=$f->getPathname();$f->isDir()&&!$f->isLink()?@rmdir($p):@unlink($p);}
    @rmdir($root);
}
if(!in_array('sqlite',PDO::getAvailableDrivers(),true)){fwrite(STDOUT,"AWH Assessment release operator: SKIP pdo_sqlite unavailable\n");exit(77);}

$root=sys_get_temp_dir().'/awh-assessment-release-'.bin2hex(random_bytes(6));
$db=$root.'/awh.sqlite';$base=dirname(__DIR__);$now='2026-09-23T13:30:00+00:00';
$project=HubAssessmentReleaseService::PROJECT_ID;$owner='223b45c0-23e1-408d-ae0f-ac5eca7f6900';
$password='assessment-release-'.bin2hex(random_bytes(10));
$artifact=$root.'/artifacts';$vault=$root.'/vault';$workspace=$root.'/workspaces';
$prod=$root.'/assessment-prod';$candidate=$root.'/assessment-candidate.json';
$baseSha=str_repeat('b',40);$releaseSha=str_repeat('a',40);$version='0.3.0-rc.16';
putenv('AWH_ARTIFACT_ROOT='.$artifact);putenv('AWH_PROJECT_VAULT_ROOT='.$vault);putenv('AWH_TASK_WORKSPACE_ROOT='.$workspace);
putenv('AWH_ASSESSMENT_PROD_ROOT='.$prod);putenv('AWH_ASSESSMENT_CANDIDATE_MANIFEST='.$candidate);

try{
    mkdir($root,0700,true);foreach([$artifact,$vault,$workspace,$prod.'/releases/base'] as $d)mkdir($d,0700,true);
    file_put_contents($prod.'/releases/base/package.json',json_encode(['version'=>'0.3.0-rc.15'],JSON_THROW_ON_ERROR));
    file_put_contents($prod.'/releases/base/SOURCE_SHA',$baseSha."\n");
    symlink($prod.'/releases/base',$prod.'/current');
    file_put_contents($candidate,json_encode([
        'schemaVersion'=>1,'product'=>'BAY Assessment','ready'=>true,'releaseSha'=>$releaseSha,'baseReleaseSha'=>$baseSha,
        'runtimeVersion'=>$version,'sourceMode'=>'LOCAL','qa'=>'PASS','observedAt'=>$now
    ],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR));

    $pdo=new PDO('sqlite:'.$db,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys=ON');$pdo->exec(file_get_contents($base.'/schema.sql'));
    foreach(['enrollment_rate_limits','device_project_memberships','device_tokens','pairing_projects','pairing_codes','user_project_memberships','device_enrollments','owner_bootstrap','hub_users'] as $table)$pdo->exec('DROP TABLE IF EXISTS '.$table);
    $pdo->prepare('INSERT INTO projects(project_id,name,type,created_at,source_revision,observed_at,provenance) VALUES(:id,:name,:type,:at,:source,:at,:provenance)')
        ->execute(['id'=>$project,'name'=>'BAY Assessment','type'=>'system','at'=>$now,'source'=>$baseSha,'provenance'=>'assessment-release-test']);
    ar_assert(HubSchemaMigration::apply($db,$base.'/migrations/001_m3e_enrollment.sql',$now,false,$base.'/schema.sql')==='applied','M3E');
    ar_assert(HubEnrollmentApiMigration::apply($db,$base.'/migrations/002_m3e2_enrollment_api.sql',$now)==='applied','M3E2');
    HubEnrollmentService::openExisting($db)->initializeOwner($owner,'Art Owner',[$project],$now);
    foreach([
        [HubControlPlaneMigration::class,'003_m4_control_plane.sql'],[HubOwnerAuthMigration::class,'004_owner_auth.sql'],
        [HubAssistantWorkstreamMigration::class,'005_assistant_workstream.sql'],[HubWorkspaceContinuityMigration::class,'006_workspace_continuity.sql'],
        [HubUnifiedWorkspaceMigration::class,'007_unified_workspace.sql'],[HubFinalProductMigration::class,'008_final_product.sql'],
        [HubFoundingMemoryMigration::class,'009_founding_memory.sql'],[HubSelfServiceMigration::class,'010_self_service.sql'],
        [HubCentralProjectAuthorityMigration::class,'011_central_project_authority.sql'],[HubAnywhereExecutionMigration::class,'012_anywhere_execution_fabric.sql']
    ] as [$migration,$sql])ar_assert($migration::apply($db,$base.'/migrations/'.$sql,$now)==='applied',$sql);

    $pdo->prepare("INSERT INTO control_project_capabilities(user_id,project_id,capability,granted_by_user_id,created_at,revoked_at)
        VALUES(:user,:project,'deployment.approve',:owner,:at,NULL)
        ON CONFLICT(user_id,project_id,capability) DO UPDATE SET revoked_at=NULL")
        ->execute(['user'=>$owner,'project'=>$project,'owner'=>$owner,'at'=>$now]);

    $auth=HubOwnerAuthService::openExisting($db);$auth->provisionInitial('art',$password,$now);
    $session=$auth->login('art',$password,true,'assessment-release-browser',$now);
    $service=HubAssessmentReleaseService::fromPdo($pdo);
    $status=$service->status($session['sessionToken']);
    ar_assert(($status['capability']??null)===HubAssessmentReleaseService::CAPABILITY,'status exposes typed Assessment release capability');
    ar_assert(($status['current']['releaseSha']??null)===$baseSha&&($status['current']['runtimeVersion']??null)==='0.3.0-rc.15','status reads exact current Assessment release');
    ar_assert(($status['candidate']['ready']??false)===true&&($status['candidate']['releaseSha']??null)===$releaseSha&&($status['candidate']['runtimeVersion']??null)===$version,'status binds exact QA candidate');

    $pdo->prepare('UPDATE control_sessions SET step_up_at=NULL WHERE session_hash=:hash')->execute(['hash'=>hash('sha256',$session['sessionToken'])]);
    try{
        $service->request($session['sessionToken'],$session['csrfToken'],['schemaVersion'=>1,'releaseSha'=>$releaseSha,'runtimeVersion'=>$version],$now);
        throw new RuntimeException('Assessment release bypassed step-up');
    }catch(HubAssessmentReleaseException $error){
        ar_assert($error->codeName==='STEP_UP_REQUIRED','Assessment release requires owner step-up');
    }

    $auth->stepUp($session['sessionToken'],$session['csrfToken'],$password);
    $request=$service->request($session['sessionToken'],$session['csrfToken'],['schemaVersion'=>1,'releaseSha'=>$releaseSha,'runtimeVersion'=>$version],$now);
    ar_assert(($request['state']??null)==='WAITING_FOR_APPROVAL','Assessment release waits for canonical owner approval');
    $task=(string)$request['taskId'];$execution=(string)$request['executionId'];$approval=(string)$request['approvalId'];

    $executionRow=$pdo->query("SELECT state,executor_kind,required_capability,checkpoint_json FROM control_task_executions WHERE execution_id=".$pdo->quote($execution))->fetch();
    ar_assert(is_array($executionRow)&&$executionRow['state']==='QUEUED'&&$executionRow['executor_kind']==='VPS'
        &&$executionRow['required_capability']===HubAssessmentReleaseService::CAPABILITY,'Assessment release uses one typed VPS capability');
    $checkpoint=HubAssessmentReleaseService::checkpoint((string)$executionRow['checkpoint_json']);
    ar_assert($checkpoint['releaseSha']===$releaseSha&&$checkpoint['baseReleaseSha']===$baseSha&&$checkpoint['runtimeVersion']===$version
        &&$checkpoint['transport']==='LOCAL'&&$checkpoint['releaseMode']==='IMMUTABLE_NODE','checkpoint freezes release/base/version and bounded transport');
    ar_assert(!array_key_exists('command',$checkpoint)&&!array_key_exists('path',$checkpoint)&&!array_key_exists('script',$checkpoint),'browser cannot inject command or path');

    $duplicate=$service->request($session['sessionToken'],$session['csrfToken'],['schemaVersion'=>1,'releaseSha'=>$releaseSha,'runtimeVersion'=>$version],$now);
    ar_assert(($duplicate['idempotent']??false)===true&&$duplicate['taskId']===$task,'same active Assessment release request is idempotent');

    $control=HubControlPlaneService::openExisting($db);
    $decided=$control->decideApproval($session['sessionToken'],$session['csrfToken'],$approval,'APPROVED',$now);
    ar_assert(($decided['status']??null)==='APPROVED','owner approval follows canonical approval flow');
    ar_assert($pdo->query("SELECT state FROM control_tasks WHERE task_id=".$pdo->quote($task))->fetchColumn()==='WAITING_FOR_WORKER','approval returns task to bounded worker queue');

    $engineSource=(string)file_get_contents(dirname(__DIR__,2).'/deploy/assessment/awh-assessment-release-engine.py');
    ar_assert(str_contains($engineSource,'def normalize_canonical_permissions():')&&str_contains($engineSource,"'/usr/bin/setfacl','-m','g::rwx,m::rwx,d:g::rwx,d:m::rwx'")&&str_contains($engineSource,"'config','--system','--add','safe.directory',str(CANON)")&&str_contains($engineSource,'normalize_canonical_permissions()'),'Assessment canonical Git creation and reuse self-heal source-promotion permissions');
    $manifestProbe=$root.'/manifest-share/candidate.json';mkdir(dirname($manifestProbe),0700,true);
    $enginePath=dirname(__DIR__,2).'/deploy/assessment/awh-assessment-release-engine.py';
    $probe=<<<'PY'
import importlib.util, pathlib, sys
engine=pathlib.Path(sys.argv[1]); target=pathlib.Path(sys.argv[2])
spec=importlib.util.spec_from_file_location('assessment_release_engine',engine)
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
module.atomic_json(target,{'schemaVersion':1,'product':'BAY Assessment','ready':True},share_parent_group=True)
st=target.stat(); parent=target.parent.stat()
assert (st.st_mode & 0o777)==0o640, oct(st.st_mode & 0o777)
assert st.st_gid==parent.st_gid, (st.st_gid,parent.st_gid)
PY;
    $probeCommand='PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -c '.escapeshellarg($probe).' '.escapeshellarg($enginePath).' '.escapeshellarg($manifestProbe);
    exec($probeCommand,$probeOutput,$probeCode);
    ar_assert($probeCode===0,'Assessment candidate manifest stays private while inheriting the control-plane group');

    $fakeRunner=$root.'/awh-assessment-release-run.php';$fakeEngine=$root.'/awh-assessment-release-engine.py';
    file_put_contents($fakeRunner,"<?php\n");file_put_contents($fakeEngine,"#!/usr/bin/env python3\n");
    $calls=[];
    $runner=static function(array $command,?array $options=null)use(&$calls):array{
        $calls[]=$command;
        if(in_array('--candidate',$command,true))return ['code'=>0,'out'=>"{\"ok\":true}\n",'err'=>''];
        if(in_array('is-active',$command,true))return ['code'=>0,'out'=>"inactive\n",'err'=>''];
        return ['code'=>0,'out'=>'','err'=>''];
    };
    $operator=new HubAssessmentReleaseOperator($pdo,$fakeRunner,$fakeEngine,$runner);
    $dispatch=$operator->tick('2026-09-23T13:30:01+00:00');
    ar_assert(($dispatch['state']??null)==='DISPATCHED'&&($dispatch['executionId']??null)===$execution,'approved Assessment release dispatches');
    $dispatchCall=null;foreach($calls as $call)if(($call[0]??null)==='/usr/bin/systemd-run'){$dispatchCall=$call;break;}
    ar_assert(is_array($dispatchCall),'dispatcher uses systemd-run instead of sudo from awh-remote');
    ar_assert(in_array('/usr/bin/php',$dispatchCall,true)&&in_array($fakeRunner,$dispatchCall,true)&&in_array($execution,$dispatchCall,true),'dispatcher passes immutable runner and execution UUID only');
    ar_assert(!in_array($releaseSha,$dispatchCall,true)&&!in_array($version,$dispatchCall,true)&&!in_array('sh',$dispatchCall,true),'release identity and shell text are not command arguments');
    ar_assert(in_array('--property=NoNewPrivileges=true',$dispatchCall,true),'privileged release runner preserves NoNewPrivileges');
    ar_assert(HubCapabilityRegistryService::mutationResourceForExecution(HubAssessmentReleaseService::CAPABILITY,'VPS')==='CANONICAL:DEPLOY','Assessment release serializes on canonical deploy resource');
    ar_assert($pdo->query('PRAGMA integrity_check')->fetchColumn()==='ok'&&$pdo->query('PRAGMA foreign_key_check')->fetchAll()===[],'Assessment release flow preserves DB integrity');

    fwrite(STDOUT,"AWH Assessment release operator: PASS\n");
}finally{
    foreach(['AWH_ARTIFACT_ROOT','AWH_PROJECT_VAULT_ROOT','AWH_TASK_WORKSPACE_ROOT','AWH_ASSESSMENT_PROD_ROOT','AWH_ASSESSMENT_CANDIDATE_MANIFEST'] as $key)putenv($key);
    ar_clean($root);
}
