<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubConversationLifecycleMigration.php';

function m19_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function m19_clean(string $root): void { if(!is_dir($root))return;$it=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST);foreach($it as $f){$x=$f->getPathname();$f->isDir()&&!$f->isLink()?@rmdir($x):@unlink($x);}@rmdir($root); }

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { fwrite(STDOUT, "AWH M19 Conversation Lifecycle: SKIP pdo_sqlite unavailable\n"); exit(77); }
$root=rtrim(sys_get_temp_dir(),'/').'/awh-m19-conversation-'.bin2hex(random_bytes(6)); $base=dirname(__DIR__); $db=$root.'/awh.sqlite'; $now='2026-09-01T14:00:00+00:00';
try {
    mkdir($root,0700,true); $pdo=new PDO('sqlite:'.$db,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]); $pdo->exec('PRAGMA foreign_keys=ON');
    $pdo->exec("CREATE TABLE hub_users(user_id TEXT PRIMARY KEY); CREATE TABLE projects(project_id TEXT PRIMARY KEY); CREATE TABLE control_tasks(task_id TEXT PRIMARY KEY); CREATE TABLE control_capability_catalog(capability TEXT PRIMARY KEY,source_id TEXT NOT NULL,maturity TEXT NOT NULL,enabled INTEGER NOT NULL); CREATE TABLE awh_schema_migrations(migration_id TEXT PRIMARY KEY,schema_version INTEGER NOT NULL,checksum TEXT NOT NULL,applied_at TEXT NOT NULL); CREATE TABLE control_conversations(conversation_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,project_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_task_id TEXT,title TEXT NOT NULL DEFAULT 'Work',archived_at TEXT,origin TEXT NOT NULL DEFAULT 'native',FOREIGN KEY(user_id) REFERENCES hub_users(user_id),FOREIGN KEY(project_id) REFERENCES projects(project_id),FOREIGN KEY(last_task_id) REFERENCES control_tasks(task_id));");
    $m18=hash_file('sha256',$base.'/migrations/017_cloud_first_control.sql'); m19_assert(is_string($m18)&&$m18!=='','M18 checksum');
    $pdo->prepare("INSERT INTO awh_schema_migrations(migration_id,schema_version,checksum,applied_at) VALUES('m18-cloud-first-control',18,:checksum,:at)")->execute(['checksum'=>$m18,'at'=>$now]);
    foreach(['qa.cloud','review.visual'] as $cap) $pdo->prepare("INSERT INTO control_capability_catalog(capability,source_id,maturity,enabled) VALUES(:cap,'awh-core','AVAILABLE',1)")->execute(['cap'=>$cap]);
    $pdo->exec('PRAGMA user_version=18');
    $migration=$base.'/migrations/018_conversation_lifecycle.sql';
    m19_assert(HubConversationLifecycleMigration::apply($db,$migration,$now)==='applied','M19 first apply');
    m19_assert(HubConversationLifecycleMigration::apply($db,$migration,$now)==='already-applied','M19 idempotence');
    m19_assert((int)$pdo->query('PRAGMA user_version')->fetchColumn()===19,'M19 user_version');
    $columns=array_column($pdo->query("PRAGMA table_info('control_conversations')")->fetchAll(),'name');
    m19_assert(in_array('deleted_at',$columns,true)&&in_array('deleted_by_user_id',$columns,true),'M19 adds lifecycle markers to canonical conversation table');
    m19_assert($pdo->query("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_control_conversations_deleted'")->fetchColumn()!==false,'M19 lifecycle index');
    m19_assert((int)$pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name LIKE '%conversation%' AND name<>'control_conversations'")->fetchColumn()===0,'M19 creates no shadow conversation authority');
    m19_assert($pdo->query('PRAGMA foreign_key_check')->fetchAll()===[],'M19 foreign keys');
    fwrite(STDOUT,"AWH M19 Conversation Lifecycle: PASS\n");
} finally { m19_clean($root); }
