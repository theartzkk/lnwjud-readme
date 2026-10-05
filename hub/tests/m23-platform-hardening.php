<?php
declare(strict_types=1);

require_once dirname(__DIR__).'/src/HubIdentityConvergenceMigration.php';
require_once dirname(__DIR__).'/src/HubPlatformHardeningMigration.php';
require_once dirname(__DIR__).'/src/HubDomainEventService.php';
require_once dirname(__DIR__).'/src/HubExecutionLifecycleService.php';

function m23_assert(bool $ok,string $message): void { if(!$ok)throw new RuntimeException($message); echo "PASS: {$message}\n"; }
if(!in_array('sqlite',PDO::getAvailableDrivers(),true)){echo "AWH M23 Platform Hardening: SKIP\n";exit(77);}
$root=rtrim(sys_get_temp_dir(),'/').'/awh-m23-'.bin2hex(random_bytes(6));$dbPath=$root.'/awh.sqlite';

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
 $pdo->exec("INSERT INTO control_capability_sources VALUES('awh-core','BUILTIN','AWH Core',NULL,NULL,NULL,1,'2026-09-26T00:00:00Z','{}')");
 $pdo->exec("CREATE TABLE control_tasks(task_id TEXT PRIMARY KEY,user_id TEXT,project_id TEXT,goal TEXT,state TEXT,assigned_device_id TEXT,lease_expires_at TEXT,progress INTEGER,result_summary TEXT,failure_code TEXT,idempotency_key TEXT,conversation_id TEXT,created_at TEXT,updated_at TEXT,cancelled_at TEXT)");
 $pdo->exec("CREATE TABLE control_task_executions(execution_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,project_id TEXT NOT NULL,vault_revision_id TEXT,executor_kind TEXT,required_capability TEXT,state TEXT,lease_owner TEXT,lease_expires_at TEXT,attempt_count INTEGER,cancellation_requested_at TEXT,checkpoint_json TEXT,last_error_code TEXT,created_at TEXT,updated_at TEXT)");
 $pdo->exec("CREATE TABLE control_execution_envelopes(envelope_id TEXT PRIMARY KEY,execution_id TEXT UNIQUE,task_id TEXT,project_id TEXT,conversation_id TEXT,base_revision_id TEXT,session_key TEXT,mutation_scope TEXT,state TEXT,provider_id TEXT,lease_expires_at TEXT,created_at TEXT,updated_at TEXT)");
 $pdo->exec("CREATE TABLE control_task_events(event_id TEXT PRIMARY KEY,task_id TEXT,state TEXT,progress INTEGER,message TEXT,occurred_at TEXT)");

 $owner='11111111-1111-4111-8111-111111111111';$project='22222222-2222-4222-8222-222222222222';
 $pdo->prepare("INSERT INTO hub_users VALUES(?,?,NULL)")->execute([$owner,'Owner']);
 $pdo->prepare("INSERT INTO projects VALUES(?,?,'AWH_VAULT',NULL)")->execute([$project,'Fixture']);
 $pdo->prepare("INSERT INTO control_user_profiles VALUES(?,?,?,'OWNER','ACTIVE')")->execute([$owner,'Owner','STAFF']);
 $m21=dirname(__DIR__).'/migrations/020_vault_source_authority.sql';$m21Checksum=hash_file('sha256',$m21);
 $pdo->prepare("INSERT INTO awh_schema_migrations VALUES('m21-vault-source-authority',21,?,'2026-09-26T00:00:00Z')")->execute([$m21Checksum]);
 $pdo->exec('PRAGMA user_version=21');

 $m22=dirname(__DIR__).'/migrations/021_identity_convergence.sql';
 m23_assert(HubIdentityConvergenceMigration::apply($dbPath,$m22,'2026-09-26T01:00:00Z')==='applied','M22 fixture baseline applies');
 $m23=dirname(__DIR__).'/migrations/022_platform_hardening.sql';
 m23_assert(HubPlatformHardeningMigration::apply($dbPath,$m23,'2026-09-26T02:00:00Z')==='applied','M23 applies after M22');
 m23_assert(HubPlatformHardeningMigration::apply($dbPath,$m23,'2026-09-26T02:01:00Z')==='already-applied','M23 is idempotent');
 $pdo=null;$pdo=new PDO('sqlite:'.$dbPath,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);$pdo->exec('PRAGMA foreign_keys=ON');
 m23_assert((int)$pdo->query('PRAGMA user_version')->fetchColumn()===23,'M23 advances user_version to 23');
 m23_assert((int)$pdo->query("SELECT count(*) FROM control_capability_catalog WHERE capability IN ('qa.runner','event.outbox') AND enabled=1")->fetchColumn()===2,'M23 publishes runner and outbox capabilities');
 $events=new HubDomainEventService($pdo);
 $first=$events->publish('exam.submitted',['examId'=>'x1'],'exam:x1:v1',$project,'2026-09-26T03:00:00Z');
 $same=$events->publish('exam.submitted',['examId'=>'x1'],'exam:x1:v1',$project,'2026-09-26T03:00:01Z');
 m23_assert($first['eventId']===$same['eventId']&&$same['deduplicated']===true,'outbox idempotency deduplicates identical publish');
 $conflict=false;try{$events->publish('exam.submitted',['examId'=>'x2'],'exam:x1:v1',$project,'2026-09-26T03:00:02Z');}catch(HubDomainEventException $e){$conflict=$e->codeName==='DOMAIN_EVENT_IDEMPOTENCY_CONFLICT';}
 m23_assert($conflict,'outbox rejects idempotency key content conflict');
 $claimed=$events->claim('worker:test',10,'2026-09-26T03:00:10Z');
 m23_assert(count($claimed)===1&&$claimed[0]['eventId']===$first['eventId'],'outbox claims pending event');
 $events->acknowledge($first['eventId'],'worker:test','2026-09-26T03:00:20Z');
 m23_assert(($events->stats()['states']['DELIVERED']??0)===1,'outbox acknowledges delivery');

 $dead=$events->publish('line.notify',['message'=>'fixture'],'line:fixture:dead',$project,'2026-09-26T04:00:00Z');
 for($attempt=1;$attempt<=5;$attempt++){
   $now=gmdate('c',strtotime('2026-09-26T04:00:00Z')+$attempt*7200);
   $rows=$events->claim('worker:test',10,$now);
   $row=array_values(array_filter($rows,fn($r)=>$r['eventId']===$dead['eventId']));
   m23_assert(count($row)===1,"outbox retry {$attempt} can be claimed");
   $result=$events->fail($dead['eventId'],'worker:test','DELIVERY_FAILED',$now);
 }
 m23_assert($result['state']==='DEAD'&&($events->stats()['dead']??0)===1,'outbox dead-letters after bounded attempts');
 $staleTask='33333333-3333-4333-8333-333333333333';$staleExec='44444444-4444-4444-8444-444444444444';$staleEnv='55555555-5555-4555-8555-555555555555';
 $freshTask='66666666-6666-4666-8666-666666666666';$freshExec='77777777-7777-4777-8777-777777777777';
 foreach([[$staleTask,$staleExec,'2026-09-24T00:00:00Z'],[$freshTask,$freshExec,'2026-09-26T05:30:00Z']] as [$task,$exec,$at]){
   $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,progress,failure_code,created_at,updated_at) VALUES(?,?,?,'fixture','WAITING_FOR_WORKER',0,'LEASE_EXPIRED',?,?)")->execute([$task,$owner,$project,$at,$at]);
   $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,executor_kind,required_capability,state,lease_owner,attempt_count,last_error_code,created_at,updated_at) VALUES(?,?,?,'VPS','project.read','QUEUED',NULL,1,'LEASE_EXPIRED',?,?)")->execute([$exec,$task,$project,$at,$at]);
 }
 $pdo->prepare("INSERT INTO control_execution_envelopes(envelope_id,execution_id,task_id,project_id,session_key,mutation_scope,state,created_at,updated_at) VALUES(?,?,?,?,?,'PROJECT_CANDIDATE','WAITING',?,?)")->execute([$staleEnv,$staleExec,$staleTask,$project,'fixture','2026-09-24T00:00:00Z','2026-09-24T00:00:00Z']);
 $life=(new HubExecutionLifecycleService($pdo))->reconcile($project,'2026-09-26T06:00:00Z');
 m23_assert($life['expiredRetryCount']===1,'lifecycle terminalizes only stale lease-expired work');
 m23_assert($pdo->query("SELECT state FROM control_task_executions WHERE execution_id='$staleExec'")->fetchColumn()==='FAILED','stale execution becomes FAILED');
 m23_assert($pdo->query("SELECT state FROM control_execution_envelopes WHERE execution_id='$staleExec'")->fetchColumn()==='RELEASED','stale mutation envelope is released');
 m23_assert($pdo->query("SELECT state FROM control_task_executions WHERE execution_id='$freshExec'")->fetchColumn()==='QUEUED','fresh retry remains queued');
 $hatchetWorker=(string)file_get_contents(dirname(__DIR__,2).'/deploy/hatchet/worker/worker.cjs');
 $durableSource=(string)file_get_contents(dirname(__DIR__).'/src/HubDurableExecutionService.php');
 m23_assert(str_contains($hatchetWorker,'retries:16,backoff:{factor:2,maxSeconds:3600}')&&str_contains($hatchetWorker,'AWH_CANONICAL_RETRY_PENDING'),'Hatchet owns bounded retry cadence while canonical retry safety remains authoritative');
 m23_assert(str_contains($hatchetWorker,'idempotency:{strategy:"status",expression:"input.executionId"')&&str_contains($hatchetWorker,'AWH_CANONICAL_STATE_NOT_TERMINAL'),'Hatchet retry remains idempotent on the canonical execution id and fails closed on unknown state');
 m23_assert(str_contains($durableSource,"getenv('AWH_HATCHET_DISPATCH_MODE')==='1'")&&str_contains($durableSource,"'processed'=>0"),'native executor keeps recovery bookkeeping but never claims queued work after Hatchet cutover');
 m23_assert($pdo->query('PRAGMA integrity_check')->fetchColumn()==='ok'&&$pdo->query('PRAGMA foreign_key_check')->fetchAll()===[],'M23 database integrity remains clean');
 echo "AWH M23 Platform Hardening: PASS\n";
} finally {
 if(is_dir($root)){foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST) as $f){$p=$f->getPathname();$f->isDir()&&!$f->isLink()?@rmdir($p):@unlink($p);}@rmdir($root);}
}
