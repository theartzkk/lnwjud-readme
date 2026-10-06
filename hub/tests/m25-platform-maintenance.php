<?php
declare(strict_types=1);

require_once dirname(__DIR__).'/src/HubConversationDelegateMigration.php';
require_once dirname(__DIR__).'/src/HubPlatformMaintenanceMigration.php';
require_once dirname(__DIR__).'/src/HubPlatformMaintenanceService.php';
require_once dirname(__DIR__).'/src/HubCapabilityRegistryService.php';
require_once dirname(__DIR__).'/src/HubDurableExecutionService.php';

function m25_assert(bool $ok,string $message):void{
    if(!$ok)throw new RuntimeException($message);
    echo "PASS: {$message}\n";
}
function m25_uuid():string{
    $bytes=random_bytes(16);$bytes[6]=chr((ord($bytes[6])&15)|64);$bytes[8]=chr((ord($bytes[8])&63)|128);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($bytes),4));
}
function m25_clean(string $root):void{
    if(!is_dir($root))return;
    foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST) as $f){
        $path=$f->getPathname();$f->isDir()&&!$f->isLink()?@rmdir($path):@unlink($path);
    }
    @rmdir($root);
}
if(!in_array('sqlite',PDO::getAvailableDrivers(),true)){echo "AWH M25 Platform Maintenance: SKIP\n";exit(77);}
$root=rtrim(sys_get_temp_dir(),'/').'/awh-m25-'.bin2hex(random_bytes(6));
$db=$root.'/awh.sqlite';$base=dirname(__DIR__);$now='2026-09-30T00:00:00Z';
$platform='113b45c0-23e1-408d-ae0f-ac5eca7f6900';
$product='7ee0b9ec-4d2e-435f-92da-fa949afb7c01';
$sourceless='4017edab-fbe8-4614-a247-a5649e331fd6';
$platformVault='916eab29-165e-4ba8-ae39-6c0a59088b47';
$productVault='edcbf2c4-6fd2-47c6-be35-563ee6ebba2a';
try{
    mkdir($root,0700,true);
    $pdo=new PDO('sqlite:'.$db,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys=ON');
    $pdo->exec("CREATE TABLE awh_schema_migrations(migration_id TEXT PRIMARY KEY,schema_version INTEGER NOT NULL,checksum TEXT NOT NULL,applied_at TEXT NOT NULL)");
    $pdo->exec("CREATE TABLE projects(project_id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT,canonical_source_authority TEXT,canonical_source_revision TEXT,canonical_source_vault_revision_id TEXT)");
    $pdo->prepare("INSERT INTO projects VALUES(?,?,'platform','AWH_VAULT',NULL,?)")->execute([$platform,'Art’s Workspace Hub',$platformVault]);
    $pdo->prepare("INSERT INTO projects VALUES(?,?,'product','AWH_VAULT',NULL,?)")->execute([$product,'BAY EXCUSE X',$productVault]);
    $pdo->prepare("INSERT INTO projects VALUES(?,?,'product',NULL,NULL,NULL)")->execute([$sourceless,'Source-less Fixture']);
    $pdo->exec("CREATE TABLE control_project_vaults(project_id TEXT PRIMARY KEY,active_revision_id TEXT,sync_state TEXT)");
    $pdo->prepare("INSERT INTO control_project_vaults VALUES(?,?,'SYNCED')")->execute([$platform,$platformVault]);
    $pdo->prepare("INSERT INTO control_project_vaults VALUES(?,?,'SYNCED')")->execute([$product,$productVault]);
    $pdo->exec("CREATE TABLE control_ai_delegates(user_id TEXT NOT NULL,project_id TEXT NOT NULL,delegate_mode TEXT NOT NULL,granted_by_user_id TEXT NOT NULL,created_at TEXT NOT NULL,revoked_at TEXT)");
    $pdo->exec("CREATE INDEX idx_control_ai_delegates_lookup ON control_ai_delegates(user_id,project_id,delegate_mode,revoked_at)");
    $m24=$base.'/migrations/023_conversation_delegate.sql';
    $pdo->prepare("INSERT INTO awh_schema_migrations VALUES('m24-conversation-delegates',24,?,'2026-09-29T00:00:00Z')")->execute([hash_file('sha256',$m24)]);
    $m12=$base.'/migrations/011_central_project_authority.sql';
    $pdo->prepare("INSERT INTO awh_schema_migrations VALUES('m12-central-project-authority',12,?,'2026-09-28T00:00:00Z')")->execute([hash_file('sha256',$m12)]);
    $pdo->exec('PRAGMA user_version=24');
    $pdo->exec("CREATE TABLE control_capability_sources(source_id TEXT PRIMARY KEY)");
    $pdo->exec("CREATE TABLE control_capability_catalog(capability TEXT PRIMARY KEY,source_id TEXT,enabled INTEGER,maturity TEXT)");
    $pdo->exec("CREATE TABLE control_execution_providers(provider_id TEXT PRIMARY KEY,provider_kind TEXT,display_name TEXT,availability_mode TEXT,cost_class TEXT,priority INTEGER,enabled INTEGER,observed_at TEXT,expires_at TEXT,metadata_json TEXT)");
    $pdo->exec("CREATE TABLE control_execution_provider_capabilities(provider_id TEXT,capability TEXT,cost_rank INTEGER,quality_rank INTEGER,latency_rank INTEGER,enabled INTEGER,expires_at TEXT,PRIMARY KEY(provider_id,capability))");
    $pdo->exec("CREATE TABLE control_tasks(task_id TEXT PRIMARY KEY,user_id TEXT,project_id TEXT NOT NULL,state TEXT NOT NULL,conversation_id TEXT,goal TEXT,lease_expires_at TEXT,progress INTEGER NOT NULL DEFAULT 0,failure_code TEXT,created_at TEXT,updated_at TEXT)");
    $pdo->exec("CREATE TABLE control_task_executions(execution_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,project_id TEXT NOT NULL,vault_revision_id TEXT,executor_kind TEXT NOT NULL,required_capability TEXT NOT NULL,state TEXT NOT NULL,lease_owner TEXT,lease_expires_at TEXT,attempt_count INTEGER NOT NULL DEFAULT 0,checkpoint_json TEXT NOT NULL DEFAULT '{}',last_error_code TEXT,created_at TEXT,updated_at TEXT NOT NULL)");
    $pdo->exec("CREATE TABLE control_task_events(event_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,state TEXT NOT NULL,progress INTEGER NOT NULL,message TEXT NOT NULL,occurred_at TEXT NOT NULL)");
    $pdo->exec("CREATE TABLE control_execution_envelopes(envelope_id TEXT PRIMARY KEY,execution_id TEXT UNIQUE,task_id TEXT,project_id TEXT,conversation_id TEXT,base_revision_id TEXT,session_key TEXT,mutation_scope TEXT,state TEXT,provider_id TEXT,lease_expires_at TEXT,created_at TEXT,updated_at TEXT)");
    // Minimal M12 capability contract required by DurableExecution::claim.
    $pdo->exec("CREATE TABLE control_project_vault_revisions(revision_id TEXT PRIMARY KEY,project_id TEXT,created_at TEXT,is_active INTEGER DEFAULT 0)");
    $pdo->exec("CREATE TABLE control_executor_capabilities(executor_id TEXT,executor_kind TEXT,capability TEXT,version TEXT,observed_at TEXT,expires_at TEXT,PRIMARY KEY(executor_id,capability))");
    $pdo->exec("CREATE TABLE control_artifact_objects(artifact_id TEXT PRIMARY KEY)");
    $pdo->exec("CREATE TABLE control_desktop_releases(release_id TEXT PRIMARY KEY,is_current INTEGER DEFAULT 0)");
    $pdo->exec("CREATE INDEX idx_control_project_vault_revisions_active ON control_project_vault_revisions(project_id,is_active)");
    $pdo->exec("CREATE INDEX idx_control_project_vault_revisions_recent ON control_project_vault_revisions(project_id,created_at)");
    $pdo->exec("CREATE INDEX idx_control_task_executions_ready ON control_task_executions(state,executor_kind,created_at)");
    $pdo->exec("CREATE INDEX idx_control_task_executions_project ON control_task_executions(project_id,state)");
    $pdo->exec("CREATE INDEX idx_control_desktop_releases_current ON control_desktop_releases(is_current)");

    $m25=$base.'/migrations/024_platform_maintenance.sql';
    m25_assert(HubPlatformMaintenanceMigration::apply($db,$m25,$now)==='applied','M25 applies after M24');
    m25_assert(HubPlatformMaintenanceMigration::apply($db,$m25,$now)==='already-applied','M25 is idempotent');
    $pdo=null;
    $pdo=new PDO('sqlite:'.$db,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys=ON');
    m25_assert((int)$pdo->query('PRAGMA user_version')->fetchColumn()===25,'M25 advances schema to 25');
    $maintenance=new HubPlatformMaintenanceService($pdo);
    m25_assert(($maintenance->state()['active']??true)===false,'maintenance defaults to NORMAL');
    $state=$maintenance->enable($platform,'VPS Platform clean-room replatform','test',$now);
    m25_assert(($state['active']??false)===true&&($state['platformProjectId']??null)===$platform,'PLATFORM_ONLY freeze binds to platform project');
    m25_assert($maintenance->mutationAllowed($product,'READ')===true,'product READ remains available');
    m25_assert($maintenance->mutationAllowed($product,'CANDIDATE')===false,'product candidate mutation is blocked');
    m25_assert($maintenance->mutationAllowed($platform,'CANDIDATE')===true,'platform candidate mutation remains available');
    m25_assert($maintenance->mutationAllowed($platform,'RESOURCE:HOSTING')===true,'platform hosting self-heal remains available');
    m25_assert($maintenance->mutationAllowed($platform,'CANONICAL:DEPLOY:VPS_PLATFORM')===true,'VPS Platform deploy remains available');
    m25_assert($maintenance->mutationAllowed($platform,'CANONICAL:DEPLOY:AWH')===false,'AWH deploy cannot move Production during PLATFORM_ONLY');
    m25_assert($maintenance->mutationAllowed($platform,'CANONICAL:SOURCE','vps-platform')===true,'VPS Platform source promotion remains available');
    m25_assert($maintenance->mutationAllowed($platform,'CANONICAL:SOURCE','awh')===true,'exact-SHA PLATFORM_ONLY does not block later AWH source promotion');
    m25_assert($maintenance->mutationAllowed($product,'CANONICAL:SOURCE','bay-product')===true,'exact-SHA PLATFORM_ONLY allows independent product source progress');

    $insert=function(string $project,string $capability,string $state='QUEUED',?string $at=null)use($pdo,$now):string{
        $task=m25_uuid();$execution=m25_uuid();$stamp=$at??$now;
        $pdo->prepare("INSERT INTO control_tasks(task_id,project_id,state,conversation_id,goal,created_at,updated_at) VALUES(:task,:project,'WAITING_FOR_WORKER',NULL,'fixture',:at,:at)")->execute(['task'=>$task,'project'=>$project,'at'=>$stamp]);
        $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,created_at,updated_at) VALUES(:execution,:task,:project,NULL,'VPS',:capability,:state,:at,:at)")->execute(['execution'=>$execution,'task'=>$task,'project'=>$project,'capability'=>$capability,'state'=>$state,'at'=>$stamp]);
        return $execution;
    };
    $registry=new HubCapabilityRegistryService($pdo);
    $missionTask=m25_uuid();$missionExecution=m25_uuid();
    $pdo->prepare("INSERT INTO control_tasks(task_id,project_id,state,conversation_id,goal) VALUES(:task,:project,'WAITING_FOR_WORKER',NULL,'platform mission fixture')")->execute(['task'=>$missionTask,'project'=>$platform]);
    $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,checkpoint_json,updated_at) VALUES(:execution,:task,:project,NULL,'VPS','operator.project_mission','RUNNING',:checkpoint,:at)")->execute(['execution'=>$missionExecution,'task'=>$missionTask,'project'=>$platform,'checkpoint'=>json_encode(['scopeEnvelope'=>['releaseTrack'=>'vps-platform']],JSON_THROW_ON_ERROR),'at'=>$now]);
    $trackResolver=new ReflectionMethod(HubCapabilityRegistryService::class,'maintenanceReleaseTrack');$trackResolver->setAccessible(true);
    m25_assert($trackResolver->invoke($registry,'source.promote',json_encode(['missionExecutionId'=>$missionExecution],JSON_THROW_ON_ERROR))==='vps-platform','source writer inherits VPS Platform release track from its durable Mission scope');
    $blockedExecution=$insert($product,'project.mutate.assisted');
    $blocked=false;
    try{$registry->activateExecutionAuthority($blockedExecution,null,$now);}
    catch(HubCapabilityRegistryException $error){$blocked=$error->codeName==='PLATFORM_MAINTENANCE_FREEZE';}
    m25_assert($blocked,'execution gate rejects product mutation while frozen');

    $readExecution=$insert($product,'project.read');
    $read=$registry->activateExecutionAuthority($readExecution,null,$now);
    m25_assert(($read['granted']??false)===true&&($read['mutationResource']??null)==='READ','execution gate keeps product reads available');

    $platformExecution=$insert($platform,'project.mutate.assisted');
    $allowed=$registry->activateExecutionAuthority($platformExecution,null,$now);
    m25_assert(($allowed['granted']??false)===true&&($allowed['mutationResource']??null)==='CANDIDATE','execution gate allows platform maintenance mutation');

    $awhRelease=$insert($platform,'system.core.release');
    $awhReleaseBlocked=false;
    try{$registry->activateExecutionAuthority($awhRelease,null,$now);}
    catch(HubCapabilityRegistryException $error){$awhReleaseBlocked=$error->codeName==='PLATFORM_MAINTENANCE_FREEZE';}
    m25_assert($awhReleaseBlocked,'execution gate blocks AWH Production release while PLATFORM_ONLY is active');

    $platformRelease=$insert($platform,'system.platform.release');
    $platformReleaseAuthority=$registry->activateExecutionAuthority($platformRelease,null,$now);
    m25_assert(($platformReleaseAuthority['granted']??false)===true&&($platformReleaseAuthority['mutationResource']??null)==='CANONICAL:DEPLOY:VPS_PLATFORM','execution gate keeps VPS Platform Production release available');

    $normal=$maintenance->disable('Platform closure complete','test',gmdate('c',strtotime($now)+60));
    m25_assert(($normal['active']??true)===false,'freeze can return explicitly to NORMAL');

    $pdo->prepare("UPDATE control_project_vaults SET sync_state='STALE' WHERE project_id=:project")->execute(['project'=>$product]);
    $pendingCandidateMutation=$insert($product,'project.mutate.assisted');
    $pendingCandidateAuthority=$registry->activateExecutionAuthority($pendingCandidateMutation,null,gmdate('c',strtotime($now)+61));
    m25_assert(($pendingCandidateAuthority['granted']??false)===true&&($pendingCandidateAuthority['mutationResource']??null)==='CANDIDATE','candidate authority remains available while the canonical Vault baseline is active and pending candidates make sync state STALE');
    $registry->updateEnvelopeState($pendingCandidateMutation,'RELEASED',null,gmdate('c',strtotime($now)+61));
    $pdo->prepare("UPDATE control_task_executions SET state='COMPLETED' WHERE execution_id=:execution")->execute(['execution'=>$pendingCandidateMutation]);
    $pdo->prepare("UPDATE control_tasks SET state='COMPLETED',progress=100 WHERE task_id=(SELECT task_id FROM control_task_executions WHERE execution_id=:execution)")->execute(['execution'=>$pendingCandidateMutation]);

    $sourceLessMutation=$insert($sourceless,'project.mutate.assisted');
    $sourceBlocked=false;
    try{$registry->activateExecutionAuthority($sourceLessMutation,null,gmdate('c',strtotime($now)+61));}
    catch(HubCapabilityRegistryException $error){$sourceBlocked=$error->codeName==='PROJECT_SOURCE_NOT_READY';}
    m25_assert($sourceBlocked,'source-less project mutation fails closed at execution authority');

    $sourceLessRead=$insert($sourceless,'project.read');
    $sourceRead=$registry->activateExecutionAuthority($sourceLessRead,null,gmdate('c',strtotime($now)+62));
    m25_assert(($sourceRead['granted']??false)===true,'source-less project remains readable for diagnosis and onboarding');

    $sourceLessMission=$insert($sourceless,'operator.project_mission');
    $sourceMission=$registry->activateExecutionAuthority($sourceLessMission,null,gmdate('c',strtotime($now)+63));
    m25_assert(($sourceMission['granted']??false)===true,'source-less project coordination remains available for onboarding');

    // Head-of-line proof on the current source-authority schema. Historical
    // fixtures are terminalized first so only these two rows participate.
    $pdo->exec("UPDATE control_task_executions SET state='COMPLETED',lease_owner=NULL,lease_expires_at=NULL");
    $pdo->exec("UPDATE control_tasks SET state='COMPLETED',progress=100,lease_expires_at=NULL");
    $pdo->exec("UPDATE control_execution_envelopes SET state='RELEASED',lease_expires_at=NULL");
    $blockedAt=gmdate('c',strtotime($now)+64);$readyAt=gmdate('c',strtotime($now)+65);$claimAt=gmdate('c',strtotime($now)+66);
    $holBlocked=$insert($sourceless,'project.mutate.assisted','QUEUED',$blockedAt);
    $holReady=$insert($product,'project.read','QUEUED',$readyAt);
    $durable=new HubDurableExecutionService($pdo,new HubProjectVaultService($pdo,new HubProjectVault($root.'/hol-vault')),null,null);
    $claim=(new ReflectionClass(HubDurableExecutionService::class))->getMethod('claim');$claim->setAccessible(true);
    $claimed=$claim->invoke($durable,$claimAt);
    m25_assert(($claimed['execution_id']??null)===$holReady,'native executor skips source-not-ready queue head and claims the next eligible project in the same tick');
    $blockedRow=$pdo->query("SELECT state,attempt_count FROM control_task_executions WHERE execution_id='$holBlocked'")->fetch();
    m25_assert(is_array($blockedRow)&&$blockedRow['state']==='QUEUED'&&(int)$blockedRow['attempt_count']===0,'skipped source-not-ready execution stays queued without consuming a retry attempt');
    $readyRow=$pdo->query("SELECT state,attempt_count FROM control_task_executions WHERE execution_id='$holReady'")->fetch();
    m25_assert(is_array($readyRow)&&$readyRow['state']==='RUNNING'&&(int)$readyRow['attempt_count']===1,'eligible execution is claimed exactly once after the skipped queue head');

    m25_assert($pdo->query('PRAGMA integrity_check')->fetchColumn()==='ok','database integrity remains clean');
    m25_assert($pdo->query('PRAGMA foreign_key_check')->fetchAll()===[],'foreign keys remain clean');
    echo "AWH M25 Platform Maintenance: PASS\n";
} finally {
    m25_clean($root);
}
