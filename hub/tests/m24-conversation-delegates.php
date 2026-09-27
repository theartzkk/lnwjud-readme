<?php
declare(strict_types=1);

require_once dirname(__DIR__).'/src/HubIdentityConvergenceMigration.php';
require_once dirname(__DIR__).'/src/HubPlatformHardeningMigration.php';
require_once dirname(__DIR__).'/src/HubConversationDelegateMigration.php';

function m24_assert(bool $ok,string $message): void { if(!$ok)throw new RuntimeException($message); echo "PASS: {$message}\n"; }
if(!in_array('sqlite',PDO::getAvailableDrivers(),true)){echo "AWH M24 Conversation Delegates: SKIP\n";exit(77);}
$root=rtrim(sys_get_temp_dir(),'/').'/awh-m24-'.bin2hex(random_bytes(6));$dbPath=$root.'/awh.sqlite';

try{
 mkdir($root,0700,true);
 $pdo=new PDO('sqlite:'.$dbPath,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
 $pdo->exec('PRAGMA foreign_keys=ON');
 $pdo->exec("CREATE TABLE awh_schema_migrations(migration_id TEXT PRIMARY KEY,schema_version INTEGER NOT NULL,checksum TEXT NOT NULL,applied_at TEXT NOT NULL)");
 $pdo->exec("CREATE TABLE hub_users(user_id TEXT PRIMARY KEY,display_name TEXT NOT NULL,revoked_at TEXT)");
 $pdo->exec("CREATE TABLE projects(project_id TEXT PRIMARY KEY,name TEXT,canonical_source_authority TEXT,canonical_source_content_sha256 TEXT)");
 $pdo->exec("CREATE TABLE control_user_profiles(user_id TEXT PRIMARY KEY,display_name TEXT NOT NULL,person_type TEXT NOT NULL,system_role TEXT NOT NULL,status TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES hub_users(user_id) ON DELETE CASCADE)");
 $pdo->exec("CREATE TABLE control_account_requests(request_id TEXT PRIMARY KEY,person_type TEXT NOT NULL,state TEXT NOT NULL)");
 $pdo->exec("CREATE TABLE control_capability_sources(source_id TEXT PRIMARY KEY,source_kind TEXT,display_name TEXT,source_uri TEXT,version TEXT,license_id TEXT,enabled INTEGER,observed_at TEXT,metadata_json TEXT)");
 $pdo->exec("CREATE TABLE control_capability_catalog(capability TEXT PRIMARY KEY,source_id TEXT NOT NULL,category TEXT NOT NULL,display_name TEXT NOT NULL,description TEXT NOT NULL,mutation_kind TEXT NOT NULL,risk_class TEXT NOT NULL,maturity TEXT NOT NULL,user_visible INTEGER NOT NULL,enabled INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
 $pdo->exec("INSERT INTO control_capability_sources VALUES('awh-core','BUILTIN','AWH Core',NULL,NULL,NULL,1,'2026-09-27T00:00:00Z','{}')");
 $pdo->exec("CREATE TABLE control_tasks(task_id TEXT PRIMARY KEY,user_id TEXT,project_id TEXT,goal TEXT,state TEXT,assigned_device_id TEXT,lease_expires_at TEXT,progress INTEGER,result_summary TEXT,failure_code TEXT,idempotency_key TEXT,conversation_id TEXT,created_at TEXT,updated_at TEXT,cancelled_at TEXT)");
 $pdo->exec("CREATE TABLE control_task_executions(execution_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,project_id TEXT NOT NULL,vault_revision_id TEXT,executor_kind TEXT,required_capability TEXT,state TEXT,lease_owner TEXT,lease_expires_at TEXT,attempt_count INTEGER,cancellation_requested_at TEXT,checkpoint_json TEXT,last_error_code TEXT,created_at TEXT,updated_at TEXT)");
 $pdo->exec("CREATE TABLE control_execution_envelopes(envelope_id TEXT PRIMARY KEY,execution_id TEXT UNIQUE,task_id TEXT,project_id TEXT,conversation_id TEXT,base_revision_id TEXT,session_key TEXT,mutation_scope TEXT,state TEXT,provider_id TEXT,lease_expires_at TEXT,created_at TEXT,updated_at TEXT)");
 $pdo->exec("CREATE TABLE control_task_events(event_id TEXT PRIMARY KEY,task_id TEXT,state TEXT,progress INTEGER,message TEXT,occurred_at TEXT)");
 $owner='11111111-1111-4111-8111-111111111111';$delegate='22222222-2222-4222-8222-222222222222';$project='33333333-3333-4333-8333-333333333333';
 foreach([[$owner,'Owner'],[$delegate,'Delegate']] as [$id,$name])$pdo->prepare("INSERT INTO hub_users VALUES(?,?,NULL)")->execute([$id,$name]);
 $pdo->prepare("INSERT INTO projects VALUES(?,?,'AWH_VAULT',NULL)")->execute([$project,'Fixture']);
 $pdo->prepare("INSERT INTO control_user_profiles VALUES(?,?,?,'OWNER','ACTIVE')")->execute([$owner,'Owner','STAFF']);
 $pdo->prepare("INSERT INTO control_user_profiles VALUES(?,?,?,'STAFF','ACTIVE')")->execute([$delegate,'Delegate','OTHER']);
 $m21=dirname(__DIR__).'/migrations/020_vault_source_authority.sql';$pdo->prepare("INSERT INTO awh_schema_migrations VALUES('m21-vault-source-authority',21,?,'2026-09-27T00:00:00Z')")->execute([hash_file('sha256',$m21)]);$pdo->exec('PRAGMA user_version=21');
 m24_assert(HubIdentityConvergenceMigration::apply($dbPath,dirname(__DIR__).'/migrations/021_identity_convergence.sql','2026-09-27T01:00:00Z')==='applied','M22 fixture baseline applies');
 m24_assert(HubPlatformHardeningMigration::apply($dbPath,dirname(__DIR__).'/migrations/022_platform_hardening.sql','2026-09-27T02:00:00Z')==='applied','M23 fixture baseline applies');
 $m24=dirname(__DIR__).'/migrations/023_conversation_delegate.sql';
 m24_assert(HubConversationDelegateMigration::apply($dbPath,$m24,'2026-09-27T03:00:00Z')==='applied','M24 applies after M23');
 m24_assert(HubConversationDelegateMigration::apply($dbPath,$m24,'2026-09-27T03:01:00Z')==='already-applied','M24 is idempotent');
 $pdo=null;$pdo=new PDO('sqlite:'.$dbPath,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);$pdo->exec('PRAGMA foreign_keys=ON');
 m24_assert((int)$pdo->query('PRAGMA user_version')->fetchColumn()===24,'M24 advances user_version to 24');
 $pdo->prepare("INSERT INTO control_ai_delegates(user_id,project_id,delegate_mode,granted_by_user_id,created_at,revoked_at) VALUES(?,?,'OWNER_CHANNEL',?,'2026-09-27T03:02:00Z',NULL)")->execute([$delegate,$project,$owner]);
 m24_assert($pdo->query("SELECT delegate_mode FROM control_ai_delegates")->fetchColumn()==='OWNER_CHANNEL','OWNER_CHANNEL delegate persists');
 $pdo->exec("UPDATE control_ai_delegates SET revoked_at='2026-09-27T03:03:00Z'");
 $pdo->prepare("INSERT INTO control_ai_delegates(user_id,project_id,delegate_mode,granted_by_user_id,created_at,revoked_at) VALUES(?,?,'SCHOOL_SUPPORT',?,'2026-09-27T03:04:00Z',NULL)")->execute([$delegate,$project,$owner]);
 m24_assert((int)$pdo->query("SELECT count(*) FROM control_ai_delegates WHERE delegate_mode='SCHOOL_SUPPORT' AND revoked_at IS NULL")->fetchColumn()===1,'SCHOOL_SUPPORT can be scoped independently');
 $invalid=false;try{$pdo->prepare("INSERT INTO control_ai_delegates VALUES(?,?,'DEPLOY_OWNER',?,'2026-09-27T03:05:00Z',NULL)")->execute([$delegate,$project,$owner]);}catch(PDOException){$invalid=true;}
 m24_assert($invalid,'delegate mode cannot escalate to deploy or owner role');
 $source=file_get_contents(dirname(__DIR__).'/src/HubControlPlaneService.php');
 m24_assert(is_string($source)&&str_contains($source,'canUseNativeConversation')&&str_contains($source,'canUseOwnerFundedAi'),'conversation service consumes bounded delegate policy');
 m24_assert($pdo->query('PRAGMA integrity_check')->fetchColumn()==='ok'&&$pdo->query('PRAGMA foreign_key_check')->fetchAll()===[],'M24 database integrity remains clean');
 echo "AWH M24 Conversation Delegates: PASS\n";
} finally {
 if(is_dir($root)){foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST) as $f){$p=$f->getPathname();$f->isDir()&&!$f->isLink()?@rmdir($p):@unlink($p);}@rmdir($root);}
}
