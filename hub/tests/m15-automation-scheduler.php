<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubAutomationRegistryService.php';
require_once dirname(__DIR__) . '/src/HubAutomationSchedulerService.php';

function as_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function as_uuid(): string { $bytes=random_bytes(16); $bytes[6]=chr((ord($bytes[6])&15)|64); $bytes[8]=chr((ord($bytes[8])&63)|128); return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($bytes),4)); }
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { fwrite(STDOUT, "AWH Automation Scheduler: SKIP pdo_sqlite unavailable\n"); exit(77); }

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$pdo->exec('PRAGMA foreign_keys = ON');
$pdo->exec('CREATE TABLE hub_users(user_id TEXT PRIMARY KEY, revoked_at TEXT)');
$pdo->exec('CREATE TABLE projects(project_id TEXT PRIMARY KEY)');
$pdo->exec('CREATE TABLE user_project_memberships(user_id TEXT,project_id TEXT,revoked_at TEXT,PRIMARY KEY(user_id,project_id))');
$pdo->exec('CREATE TABLE control_conversations(conversation_id TEXT PRIMARY KEY,user_id TEXT,project_id TEXT,archived_at TEXT)');
$pdo->exec("CREATE TABLE control_automations(automation_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,project_id TEXT NOT NULL,conversation_id TEXT,name TEXT NOT NULL,goal TEXT NOT NULL,timing_mode TEXT NOT NULL,schedule_ical TEXT NOT NULL,condition_key TEXT,condition_description TEXT,enabled INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived_at TEXT)");
$pdo->exec('CREATE TABLE control_tasks(task_id TEXT PRIMARY KEY,user_id TEXT,project_id TEXT,state TEXT,updated_at TEXT)');
$pdo->exec('CREATE TABLE control_approvals(approval_id TEXT PRIMARY KEY,task_id TEXT,status TEXT,expires_at TEXT)');
$pdo->exec('CREATE TABLE devices(device_id TEXT PRIMARY KEY,revoked_at TEXT)');
$pdo->exec('CREATE TABLE device_project_memberships(device_id TEXT,project_id TEXT,revoked_at TEXT)');
$pdo->exec('CREATE TABLE control_workers(device_id TEXT PRIMARY KEY,last_seen_at TEXT)');

$user=as_uuid(); $project=as_uuid();
$pdo->prepare('INSERT INTO hub_users(user_id,revoked_at) VALUES(:id,NULL)')->execute(['id'=>$user]);
$pdo->prepare('INSERT INTO projects(project_id) VALUES(:id)')->execute(['id'=>$project]);
$pdo->prepare('INSERT INTO user_project_memberships(user_id,project_id,revoked_at) VALUES(:user,:project,NULL)')->execute(['user'=>$user,'project'=>$project]);
$registry=new HubAutomationRegistryService($pdo);
$calls=[];
$scheduler=new HubAutomationSchedulerService($pdo, function(string $userId,array $definition,string $occurrenceAt) use (&$calls): array { $calls[]=['userId'=>$userId,'definition'=>$definition,'occurrenceAt'=>$occurrenceAt]; return ['ok'=>true]; });

$once=$registry->create($user,['schemaVersion'=>1,'projectId'=>$project,'conversationId'=>null,'name'=>'Once','goal'=>'ทำงานครั้งเดียว','timingMode'=>'exact_schedule','schedule'=>"BEGIN:VEVENT\nDTSTART:20260828T010000\nEND:VEVENT",'condition'=>null,'enabled'=>true],'2026-08-28T00:00:00+00:00');
$tasksBefore=(int)$pdo->query('SELECT COUNT(*) FROM control_tasks')->fetchColumn();
$first=$scheduler->tick('2026-08-28T01:00:00+00:00');
as_assert($first['checked']===1 && $first['due']===1 && $first['materialized']===1 && count($calls)===1,'one-time occurrence materialized');
as_assert($calls[0]['userId']===$user && $calls[0]['definition']['automationId']===$once['definition']['automationId'],'canonical definition delegated');
as_assert($calls[0]['occurrenceAt']==='2026-08-28T01:00:00+00:00','occurrence is deterministic');
$second=$scheduler->tick('2026-08-28T01:30:00+00:00');
as_assert($second['materialized']===1 && count($calls)===2 && $calls[1]['occurrenceAt']===$calls[0]['occurrenceAt'],'same occurrence delegates same downstream idempotency input');
as_assert((int)$pdo->query('SELECT COUNT(*) FROM control_tasks')->fetchColumn()===$tasksBefore,'scheduler never writes tasks directly');
$registry->setEnabled($user,$once['definition']['automationId'],false,'2026-08-28T01:31:00+00:00');

$failedTask=as_uuid(); $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,state,updated_at) VALUES(:id,:user,:project,'FAILED',:at)")->execute(['id'=>$failedTask,'user'=>$user,'project'=>$project,'at'=>'2026-08-28T01:40:00+00:00']);
$watch=$registry->create($user,['schemaVersion'=>1,'projectId'=>$project,'conversationId'=>null,'name'=>'Failure watch','goal'=>'สรุปงานที่หยุด','timingMode'=>'condition_watch','schedule'=>"BEGIN:VEVENT\nRRULE:FREQ=HOURLY\nEND:VEVENT",'condition'=>['schemaVersion'=>1,'key'=>'project.task.failed','description'=>'มีงานใน Project หยุดด้วยข้อผิดพลาด'],'enabled'=>true],'2026-08-28T01:00:00+00:00');
$calls=[]; $watchTick=$scheduler->tick('2026-08-28T02:00:00+00:00');
as_assert($watchTick['due']===1 && $watchTick['materialized']===1 && count($calls)===1,'condition watch materialized when canonical task state matches');
as_assert($calls[0]['definition']['automationId']===$watch['definition']['automationId'],'condition watch delegates correct definition');

$registry->setEnabled($user,$watch['definition']['automationId'],false,'2026-08-28T02:01:00+00:00');
$unsupported=$registry->create($user,['schemaVersion'=>1,'projectId'=>$project,'conversationId'=>null,'name'=>'Unknown condition','goal'=>'ไม่ควรรัน','timingMode'=>'condition_watch','schedule'=>"BEGIN:VEVENT\nRRULE:FREQ=HOURLY\nEND:VEVENT",'condition'=>['schemaVersion'=>1,'key'=>'custom.signal','description'=>'เงื่อนไขที่ยังไม่รองรับ'],'enabled'=>true],'2026-08-28T01:00:00+00:00');
$calls=[]; $unsupportedTick=$scheduler->tick('2026-08-28T02:00:00+00:00');
as_assert($unsupportedTick['unsupported']===1 && $unsupportedTick['materialized']===0 && $calls===[],'unknown condition fails closed');
as_assert((int)$pdo->query('SELECT COUNT(*) FROM control_tasks')->fetchColumn()===$tasksBefore+1,'only fixture task exists; scheduler added none');

fwrite(STDOUT,"AWH Automation Scheduler: PASS\n");
