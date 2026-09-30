<?php
declare(strict_types=1);

require_once dirname(__DIR__).'/src/HubConversationDelegateMigration.php';
require_once dirname(__DIR__).'/src/HubPlatformMaintenanceMigration.php';
require_once dirname(__DIR__).'/src/HubPlatformMaintenanceService.php';
require_once dirname(__DIR__).'/src/HubCapabilityRegistryService.php';

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
    $pdo->exec('PRAGMA user_version=24');
    $pdo->exec("CREATE TABLE control_capability_sources(source_id TEXT PRIMARY KEY)");
    $pdo->exec("CREATE TABLE control_capability_catalog(capability TEXT PRIMARY KEY,source_id TEXT,enabled INTEGER,maturity TEXT)");
    $pdo->exec("CREATE TABLE control_execution_providers(provider_id TEXT PRIMARY KEY,provider_kind TEXT,display_name TEXT,availability_mode TEXT,cost_class TEXT,priority INTEGER,enabled INTEGER,observed_at TEXT,expires_at TEXT,metadata_json TEXT)");
    $pdo->exec("CREATE TABLE control_execution_provider_capabilities(provider_id TEXT,capability TEXT,cost_rank INTEGER,quality_rank INTEGER,latency_rank INTEGER,enabled INTEGER,expires_at TEXT,PRIMARY KEY(provider_id,capability))");
    $pdo->exec("CREATE TABLE control_tasks(task_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,state TEXT NOT NULL,conversation_id TEXT,goal TEXT)");
    $pdo->exec("CREATE TABLE control_task_executions(execution_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,project_id TEXT NOT NULL,vault_revision_id TEXT,executor_kind TEXT NOT NULL,required_capability TEXT NOT NULL,state TEXT NOT NULL,updated_at TEXT NOT NULL)");
    $pdo->exec("CREATE TABLE control_execution_envelopes(envelope_id TEXT PRIMARY KEY,execution_id TEXT UNIQUE,task_id TEXT,project_id TEXT,conversation_id TEXT,base_revision_id TEXT,session_key TEXT,mutation_scope TEXT,state TEXT,provider_id TEXT,lease_expires_at TEXT,created_at TEXT,updated_at TEXT)");

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
    m25_assert($maintenance->mutationAllowed($platform,'CANDIDATE')===true,'platform mutation remains available');

    $insert=function(string $project,string $capability,string $state='QUEUED')use($pdo,$now):string{
        $task=m25_uuid();$execution=m25_uuid();
        $pdo->prepare("INSERT INTO control_tasks(task_id,project_id,state,conversation_id,goal) VALUES(:task,:project,'WAITING_FOR_WORKER',NULL,'fixture')")->execute(['task'=>$task,'project'=>$project]);
        $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,updated_at) VALUES(:execution,:task,:project,NULL,'VPS',:capability,:state,:at)")->execute(['execution'=>$execution,'task'=>$task,'project'=>$project,'capability'=>$capability,'state'=>$state,'at'=>$now]);
        return $execution;
    };
    $registry=new HubCapabilityRegistryService($pdo);
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

    $normal=$maintenance->disable('Platform closure complete','test',gmdate('c',strtotime($now)+60));
    m25_assert(($normal['active']??true)===false,'freeze can return explicitly to NORMAL');

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

    m25_assert($pdo->query('PRAGMA integrity_check')->fetchColumn()==='ok','database integrity remains clean');
    m25_assert($pdo->query('PRAGMA foreign_key_check')->fetchAll()===[],'foreign keys remain clean');
    echo "AWH M25 Platform Maintenance: PASS\n";
} finally {
    m25_clean($root);
}
