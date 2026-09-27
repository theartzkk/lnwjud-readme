<?php
declare(strict_types=1);

require_once dirname(__DIR__).'/src/HubCompletionAuthorityService.php';

function ca_assert(bool $ok,string $message): void { if(!$ok)throw new RuntimeException($message); echo "PASS: {$message}
"; }
function ca_uuid(int $n): string { return sprintf('%08x-0000-4000-8000-%012x',$n,$n); }

if(!in_array('sqlite',PDO::getAvailableDrivers(),true)){echo "AWH Completion Authority: SKIP
";exit(77);}
$pdo=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$pdo->exec('PRAGMA foreign_keys=ON');
$pdo->exec("CREATE TABLE projects(project_id TEXT PRIMARY KEY,name TEXT)");
$pdo->exec("CREATE TABLE control_tasks(task_id TEXT PRIMARY KEY,user_id TEXT,project_id TEXT,goal TEXT,state TEXT,progress INTEGER,result_summary TEXT,failure_code TEXT,updated_at TEXT)");
$pdo->exec("CREATE TABLE control_task_executions(execution_id TEXT PRIMARY KEY,task_id TEXT,project_id TEXT,state TEXT,required_capability TEXT,lease_owner TEXT,lease_expires_at TEXT,checkpoint_json TEXT,last_error_code TEXT,updated_at TEXT)");
$pdo->exec("CREATE TABLE control_approvals(approval_id TEXT PRIMARY KEY,task_id TEXT,status TEXT,expires_at TEXT)");
$pdo->exec("CREATE TABLE control_execution_envelopes(envelope_id TEXT PRIMARY KEY,execution_id TEXT,task_id TEXT,project_id TEXT,mutation_scope TEXT,state TEXT,lease_expires_at TEXT)");
$pdo->exec("CREATE TABLE control_task_events(event_id TEXT PRIMARY KEY,task_id TEXT,state TEXT,progress INTEGER,message TEXT,occurred_at TEXT)");
$project=ca_uuid(1);$pdo->prepare('INSERT INTO projects VALUES(?,?)')->execute([$project,'Fixture']);
$now='2026-09-27T04:00:00Z';

$insertTask=$pdo->prepare("INSERT INTO control_tasks VALUES(:task,'owner',:project,'fixture',:state,:progress,:summary,NULL,:updated)");
$insertExec=$pdo->prepare("INSERT INTO control_task_executions VALUES(:execution,:task,:project,:state,'project.read',:owner,:lease,:checkpoint,NULL,:updated)");

$verifiedTask=ca_uuid(10);$verifiedExec=ca_uuid(11);
$insertTask->execute(['task'=>$verifiedTask,'project'=>$project,'state'=>'COMPLETED','progress'=>100,'summary'=>'verified result','updated'=>$now]);
$insertExec->execute(['execution'=>$verifiedExec,'task'=>$verifiedTask,'project'=>$project,'state'=>'COMPLETED','owner'=>null,'lease'=>null,'checkpoint'=>'{}','updated'=>$now]);
$pdo->prepare("INSERT INTO control_execution_envelopes VALUES(?,?,?,?,?,'RELEASED',NULL)")->execute([ca_uuid(12),$verifiedExec,$verifiedTask,$project,'READ']);
$authority=new HubCompletionAuthorityService($pdo);
$v=$authority->assessTask($verifiedTask,$now);
ca_assert(($v['verified']??false)===true&&($v['publicState']??null)==='COMPLETED','terminal task is publishable only after execution/authority evidence agrees');

$activeTask=ca_uuid(20);$activeExec=ca_uuid(21);
$insertTask->execute(['task'=>$activeTask,'project'=>$project,'state'=>'COMPLETED','progress'=>100,'summary'=>'premature','updated'=>$now]);
$insertExec->execute(['execution'=>$activeExec,'task'=>$activeTask,'project'=>$project,'state'=>'RUNNING','owner'=>'worker:test','lease'=>'2026-09-27T04:05:00Z','checkpoint'=>'{}','updated'=>$now]);
$a=$authority->assessTask($activeTask,$now);
ca_assert(($a['verified']??true)===false&&($a['publicState']??null)==='VERIFYING'&&($a['reasonCode']??null)==='EXECUTION_STILL_ACTIVE','internal COMPLETED never publishes while execution is still active');

$staleTask=ca_uuid(30);$staleExec=ca_uuid(31);
$insertTask->execute(['task'=>$staleTask,'project'=>$project,'state'=>'RUNNING','progress'=>40,'summary'=>null,'updated'=>'2026-09-27T03:00:00Z']);
$insertExec->execute(['execution'=>$staleExec,'task'=>$staleTask,'project'=>$project,'state'=>'RUNNING','owner'=>'worker:test','lease'=>'2026-09-27T03:05:00Z','checkpoint'=>'{"mode":"PROJECT_INSPECTION"}','updated'=>'2026-09-27T03:00:00Z']);
$s=$authority->assessTask($staleTask,$now);
ca_assert(($s['publicState']??null)==='RECOVERING'&&($s['reasonCode']??null)==='HEARTBEAT_STALE','stale heartbeat exposes RECOVERING with durable resume cursor');

$root=ca_uuid(40);$rootExec=ca_uuid(41);
$failedCheckpoint=json_encode(['continuation'=>['enabled'=>true,'rootTaskId'=>$root,'step'=>0,'maxSteps'=>3],'_continuationOutcome'=>['state'=>'FAILED','attempts'=>1,'at'=>'2026-09-27T03:59:00Z','nextEligibleAt'=>'2026-09-27T04:04:00Z','nextTaskId'=>null]],JSON_THROW_ON_ERROR);
$insertTask->execute(['task'=>$root,'project'=>$project,'state'=>'COMPLETED','progress'=>100,'summary'=>'step done','updated'=>$now]);
$insertExec->execute(['execution'=>$rootExec,'task'=>$root,'project'=>$project,'state'=>'COMPLETED','owner'=>null,'lease'=>null,'checkpoint'=>$failedCheckpoint,'updated'=>$now]);
$f=$authority->assessTask($root,$now);
ca_assert(($f['verified']??true)===false&&($f['publicState']??null)==='RECOVERING'&&($f['reasonCode']??null)==='CONTINUATION_RECOVERY_PENDING','failed continuation cannot publish completion and retains recovery cursor');

$chainRoot=ca_uuid(50);$chainExec=ca_uuid(51);$child=ca_uuid(52);$childExec=ca_uuid(53);
$parentCp=json_encode(['continuation'=>['enabled'=>true,'rootTaskId'=>$chainRoot,'step'=>0,'maxSteps'=>3],'_continuationOutcome'=>['state'=>'CONTINUED','attempts'=>0,'nextTaskId'=>$child]],JSON_THROW_ON_ERROR);
$childCp=json_encode(['continuation'=>['enabled'=>true,'rootTaskId'=>$chainRoot,'step'=>1,'maxSteps'=>3]],JSON_THROW_ON_ERROR);
$insertTask->execute(['task'=>$chainRoot,'project'=>$project,'state'=>'COMPLETED','progress'=>100,'summary'=>'parent done','updated'=>$now]);
$insertExec->execute(['execution'=>$chainExec,'task'=>$chainRoot,'project'=>$project,'state'=>'COMPLETED','owner'=>null,'lease'=>null,'checkpoint'=>$parentCp,'updated'=>$now]);
$insertTask->execute(['task'=>$child,'project'=>$project,'state'=>'RUNNING','progress'=>30,'summary'=>null,'updated'=>$now]);
$insertExec->execute(['execution'=>$childExec,'task'=>$child,'project'=>$project,'state'=>'RUNNING','owner'=>'vps-native','lease'=>'2026-09-27T04:05:00Z','checkpoint'=>$childCp,'updated'=>$now]);
$c=$authority->assessTask($chainRoot,$now);
ca_assert(($c['verified']??true)===false&&($c['publicState']??null)==='VERIFYING'&&($c['reasonCode']??null)==='CONTINUATION_ACTIVE','parent step stays non-terminal while successor in the same project is active');

echo "AWH Completion Authority: PASS
";
