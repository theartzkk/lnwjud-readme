<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubProjectSourceAuthorityMigration.php';
require_once dirname(__DIR__) . '/src/HubVaultSourceAuthorityMigration.php';
require_once dirname(__DIR__) . '/src/HubProjectSourceAuthorityService.php';

function m21_assert(bool $condition,string $message):void{if(!$condition)throw new RuntimeException($message);}

if(!in_array('sqlite',PDO::getAvailableDrivers(),true)){fwrite(STDOUT,"AWH M21 Vault Source Authority: SKIP pdo_sqlite unavailable\n");exit(77);}
$root=rtrim(sys_get_temp_dir(),'/').'/awh-m21-source-'.bin2hex(random_bytes(6));$base=dirname(__DIR__);$now='2026-09-13T02:00:00+00:00';
$project='123b45c0-23e1-408d-ae0f-ac5eca7f6900';$active='223b45c0-23e1-408d-ae0f-ac5eca7f6900';$candidate='323b45c0-23e1-408d-ae0f-ac5eca7f6900';$next='423b45c0-23e1-408d-ae0f-ac5eca7f6900';
$gitOld=str_repeat('a',40);$gitCanonical=str_repeat('b',40);$content=str_repeat('c',64);$candidateContent=str_repeat('d',64);$nextContent=str_repeat('e',64);
try{
 mkdir($root,0700,true);$db=$root.'/awh.sqlite';$pdo=new PDO('sqlite:'.$db,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);$pdo->exec('PRAGMA foreign_keys=ON');
 $pdo->exec("CREATE TABLE awh_schema_migrations(migration_id TEXT PRIMARY KEY,schema_version INTEGER NOT NULL,checksum TEXT NOT NULL,applied_at TEXT NOT NULL);");
 $pdo->exec("CREATE TABLE projects(project_id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,created_at TEXT NOT NULL,source_revision TEXT,observed_at TEXT NOT NULL,provenance TEXT NOT NULL,canonical_source_provider TEXT CHECK(canonical_source_provider IS NULL OR canonical_source_provider='GITHUB'),canonical_source_repository TEXT,canonical_source_ref TEXT,canonical_source_revision TEXT,canonical_source_observed_at TEXT,canonical_source_vault_revision_id TEXT);");
 $pdo->exec("CREATE TABLE control_project_vaults(project_id TEXT PRIMARY KEY,storage_mode TEXT NOT NULL,active_revision_id TEXT,sync_state TEXT NOT NULL,content_bytes INTEGER NOT NULL,file_count INTEGER NOT NULL,updated_at TEXT NOT NULL);");
 $pdo->exec("CREATE TABLE control_project_vault_revisions(revision_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,parent_revision_id TEXT,content_sha256 TEXT NOT NULL,manifest_json TEXT NOT NULL,content_bytes INTEGER NOT NULL,file_count INTEGER NOT NULL,origin_kind TEXT NOT NULL,created_by_user_id TEXT NOT NULL,created_by_device_id TEXT,task_id TEXT,state TEXT NOT NULL,created_at TEXT NOT NULL,promoted_at TEXT);");
 $m20Checksum=hash_file('sha256',$base.'/migrations/019_project_source_authority.sql');m21_assert(is_string($m20Checksum),'M20 checksum');$pdo->prepare('INSERT INTO awh_schema_migrations VALUES(?,?,?,?)')->execute([HubProjectSourceAuthorityMigration::MIGRATION_ID,20,$m20Checksum,$now]);$pdo->exec('PRAGMA user_version=20');
 $pdo->prepare("INSERT INTO projects(project_id,name,type,created_at,source_revision,observed_at,provenance,canonical_source_provider,canonical_source_repository,canonical_source_ref,canonical_source_revision,canonical_source_observed_at,canonical_source_vault_revision_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")->execute([$project,'BAY EXCUSE X','school-system',$now,$gitOld,$now,'m21-fixture','GITHUB','fixture/bay','main',$gitCanonical,$now,$active]);
 $pdo->prepare("INSERT INTO control_project_vault_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")->execute([$active,$project,null,$content,'{}',120,3,'ARCHIVE','owner',null,null,'ACTIVE',$now,$now]);
 $pdo->prepare("INSERT INTO control_project_vaults VALUES(?,?,?,?,?,?,?)")->execute([$project,'VAULT',$active,'SYNCED',120,3,$now]);

 m21_assert(HubVaultSourceAuthorityMigration::apply($db,$base.'/migrations/020_vault_source_authority.sql',$now)==='applied','M21 migration');
 m21_assert(HubVaultSourceAuthorityMigration::apply($db,$base.'/migrations/020_vault_source_authority.sql',$now)==='already-applied','M21 idempotence');
 m21_assert((int)$pdo->query('PRAGMA user_version')->fetchColumn()===21,'M21 user version');
 $columns=array_column($pdo->query('PRAGMA table_info(projects)')->fetchAll(),'name');foreach(['canonical_source_authority','canonical_source_content_sha256'] as $column)m21_assert(in_array($column,$columns,true),'M21 missing '.$column);
 $row=$pdo->query("SELECT canonical_source_authority,canonical_source_content_sha256 FROM projects WHERE project_id='$project'")->fetch();m21_assert(($row['canonical_source_authority']??null)==='GITHUB'&&($row['canonical_source_content_sha256']??null)===$content,'existing GitHub authority and cached content identity are backfilled');

 $service=new HubProjectSourceAuthorityService($pdo,null);$before=$service->state($project,false,$now);m21_assert($before['authority']==='GITHUB'&&$before['provider']==='GITHUB'&&$before['canonicalRevision']===$gitCanonical,'legacy GitHub source remains authoritative after migration');
 $vault=$service->bindVault($project,$active,$now);m21_assert($vault['authority']==='AWH_VAULT'&&$vault['provider']==='GITHUB'&&$vault['repository']==='fixture/bay'&&$vault['canonicalRevision']===$content&&$vault['canonicalContentSha256']===$content&&$vault['canonicalVaultRevisionId']===$active&&$vault['state']==='CURRENT'&&$vault['workflowCompatible']===false,'Vault becomes canonical while GitHub remains mirror metadata');
 $observed=$service->observeGitHub($project,'fixture/bay','main',$now);m21_assert($observed['authority']==='AWH_VAULT'&&$observed['canonicalVaultRevisionId']===$active,'worker GitHub observation cannot steal Vault authority');
 try{$service->observeGitHub($project,'fixture/other','main',$now);throw new RuntimeException('conflicting mirror must fail');}catch(HubProjectSourceAuthorityException $e){m21_assert($e->codeName==='PROJECT_SOURCE_CONFLICT','conflicting mirror provenance fails closed');}

 $pdo->prepare("INSERT INTO control_project_vault_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")->execute([$candidate,$project,$active,$candidateContent,'{}',121,3,'TASK','owner',null,null,'CANDIDATE',$now,null]);
 try{$service->bindVault($project,$candidate,$now);throw new RuntimeException('candidate authority must fail');}catch(HubProjectSourceAuthorityException $e){m21_assert($e->codeName==='PROJECT_SOURCE_VAULT_INVALID','candidate cannot become canonical authority');}

 $pdo->prepare("UPDATE control_project_vault_revisions SET state='SUPERSEDED' WHERE revision_id=?")->execute([$active]);
 $pdo->prepare("INSERT INTO control_project_vault_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")->execute([$next,$project,$active,$nextContent,'{}',122,4,'TASK','owner',null,null,'ACTIVE',$now,$now]);
 $pdo->prepare("UPDATE control_project_vaults SET active_revision_id=?,content_bytes=122,file_count=4,updated_at=? WHERE project_id=?")->execute([$next,$now,$project]);
 $stale=$service->state($project,true,$now);m21_assert($stale['authority']==='AWH_VAULT'&&$stale['state']==='REMOTE_AHEAD_OR_DIFFERENT','Vault authority detects active revision drift without contacting GitHub');
 $rebound=$service->bindVault($project,$next,$now);m21_assert($rebound['state']==='CURRENT'&&$rebound['canonicalRevision']===$nextContent,'new active Vault revision can be promoted deliberately');

 $github=$service->bindGitHub($project,'fixture/bay','main',$now,false);m21_assert($github['authority']==='GITHUB'&&$github['canonicalRevision']===null&&$github['canonicalVaultRevisionId']===null&&$github['canonicalContentSha256']===null,'switching back to GitHub clears Vault canonical identity but keeps project authority singular');
 $cleared=$service->clear($project,$now);m21_assert($cleared['authority']===null&&$cleared['provider']===null&&$cleared['state']==='NOT_CONFIGURED','clear removes canonical and mirror source binding');
 m21_assert($pdo->query('PRAGMA integrity_check')->fetchColumn()==='ok'&&$pdo->query('PRAGMA foreign_key_check')->fetchAll()===[],'M21 preserves DB integrity/FKs');
 fwrite(STDOUT,"AWH M21 Vault Source Authority: PASS\n");
}finally{if(is_dir($root)){foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST) as $f){$x=$f->getPathname();$f->isDir()&&!$f->isLink()?@rmdir($x):@unlink($x);}@rmdir($root);}}
