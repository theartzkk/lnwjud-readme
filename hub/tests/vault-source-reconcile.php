<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubProjectSourceAuthorityMigration.php';
require_once dirname(__DIR__) . '/src/HubVaultSourceAuthorityMigration.php';
require_once dirname(__DIR__) . '/src/HubProjectSourceAuthorityService.php';

function vsr_assert(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function vsr_run(array $args,?string $cwd=null):array{
    $spec=[1=>['pipe','w'],2=>['pipe','w']];$proc=proc_open(implode(' ',array_map('escapeshellarg',$args)),$spec,$pipes,$cwd);
    if(!is_resource($proc))throw new RuntimeException('process start failed');
    $out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);$code=proc_close($proc);
    return [$code,(string)$out,(string)$err];
}
function vsr_git(string $cwd,array $args):string{[$code,$out,$err]=vsr_run(array_merge(['git'],$args),$cwd);if($code!==0)throw new RuntimeException('git failed: '.$err);return trim($out);}

if(!in_array('sqlite',PDO::getAvailableDrivers(),true)){fwrite(STDOUT,"AWH Vault Source Reconcile: SKIP pdo_sqlite unavailable\n");exit(77);}
$root=rtrim(sys_get_temp_dir(),'/').'/awh-vault-reconcile-'.bin2hex(random_bytes(6));$base=dirname(__DIR__);$now='2026-09-24T05:00:00+00:00';
$project='a7285fbd-029b-4d17-9d26-c7497b28a72e';$active='832f723d-63db-401d-93f9-be47c2376629';$content=str_repeat('a',64);
try{
    mkdir($root,0700,true);$db=$root.'/awh.sqlite';$pdo=new PDO('sqlite:'.$db,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);$pdo->exec('PRAGMA foreign_keys=ON');
    $pdo->exec("CREATE TABLE awh_schema_migrations(migration_id TEXT PRIMARY KEY,schema_version INTEGER NOT NULL,checksum TEXT NOT NULL,applied_at TEXT NOT NULL);");
    $pdo->exec("CREATE TABLE projects(project_id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,created_at TEXT NOT NULL,source_revision TEXT,observed_at TEXT NOT NULL,provenance TEXT NOT NULL,canonical_source_provider TEXT CHECK(canonical_source_provider IS NULL OR canonical_source_provider='GITHUB'),canonical_source_repository TEXT,canonical_source_ref TEXT,canonical_source_revision TEXT,canonical_source_observed_at TEXT,canonical_source_vault_revision_id TEXT);");
    $pdo->exec("CREATE TABLE control_project_vaults(project_id TEXT PRIMARY KEY,storage_mode TEXT NOT NULL,active_revision_id TEXT,sync_state TEXT NOT NULL,content_bytes INTEGER NOT NULL,file_count INTEGER NOT NULL,updated_at TEXT NOT NULL);");
    $pdo->exec("CREATE TABLE control_project_vault_revisions(revision_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,parent_revision_id TEXT,content_sha256 TEXT NOT NULL,manifest_json TEXT NOT NULL,content_bytes INTEGER NOT NULL,file_count INTEGER NOT NULL,origin_kind TEXT NOT NULL,created_by_user_id TEXT NOT NULL,created_by_device_id TEXT,task_id TEXT,state TEXT NOT NULL,created_at TEXT NOT NULL,promoted_at TEXT);");
    $m20=hash_file('sha256',$base.'/migrations/019_project_source_authority.sql');$pdo->prepare('INSERT INTO awh_schema_migrations VALUES(?,?,?,?)')->execute([HubProjectSourceAuthorityMigration::MIGRATION_ID,20,$m20,$now]);$pdo->exec('PRAGMA user_version=20');
    $pdo->prepare("INSERT INTO projects(project_id,name,type,created_at,source_revision,observed_at,provenance,canonical_source_provider,canonical_source_repository,canonical_source_ref,canonical_source_revision,canonical_source_observed_at,canonical_source_vault_revision_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")->execute([$project,'BAY LearnLab','learning-platform',$now,null,$now,'fixture','GITHUB','fixture/learnlab','main',null,$now,null]);
    $pdo->prepare("INSERT INTO control_project_vault_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")->execute([$active,$project,null,$content,'{}',4,1,'ARCHIVE','owner',null,null,'ACTIVE',$now,$now]);
    $pdo->prepare("INSERT INTO control_project_vaults VALUES(?,?,?,?,?,?,?)")->execute([$project,'VAULT',$active,'SYNCED',4,1,$now]);
    vsr_assert(HubVaultSourceAuthorityMigration::apply($db,$base.'/migrations/020_vault_source_authority.sql',$now)==='applied','M21 applied');

    $work=$root.'/work';mkdir($work,0700);vsr_git($work,['init','-q','-b','main']);vsr_git($work,['config','user.email','qa@localhost']);vsr_git($work,['config','user.name','AWH QA']);
    file_put_contents($work.'/app.txt',"ok\n");vsr_git($work,['add','.']);vsr_git($work,['commit','-qm','source']);$source=vsr_git($work,['rev-parse','HEAD']);
    $message="AWH Vault projection: BAY LearnLab\n\nVault-Revision: $active\nContent-SHA256: $content\nAuthority: AWH_VAULT\nProjection: true\nSource-Revision: $source";
    vsr_git($work,['commit','--allow-empty','-qm',$message]);
    $gitRoot=$root.'/git';mkdir($gitRoot,0700);vsr_git($root,['clone','-q','--bare',$work,$gitRoot.'/bay-learnlab.git']);

    [$code,$out,$err]=vsr_run([PHP_BINARY,$base.'/bin/reconcile-vault-source-authority.php',$db,$gitRoot]);if($code!==0)throw new RuntimeException('reconcile failed: '.trim($err));$json=json_decode(trim($out),true,32,JSON_THROW_ON_ERROR);
    vsr_assert($code===0&&($json['reconciledCount']??0)===1&&in_array('BAY LearnLab',$json['reconciled']??[],true),'valid projection reconciles Vault authority');
    $state=(new HubProjectSourceAuthorityService($pdo,null))->state($project,false,$now);vsr_assert(($state['authority']??null)==='AWH_VAULT'&&($state['canonicalVaultRevisionId']??null)===$active&&($state['state']??null)==='CURRENT','reconciled source is current Vault authority');

    (new HubProjectSourceAuthorityService($pdo,null))->bindGitHub($project,'fixture/learnlab','main',$now,false);
    file_put_contents($work.'/tampered.txt',"changed\n");vsr_git($work,['add','.']);vsr_git($work,['commit','-qm','tampered projection']);$tampered=vsr_git($work,['rev-parse','HEAD']);vsr_git($root,['--git-dir='.$gitRoot.'/bay-learnlab.git','fetch','-q',$work,$tampered]);vsr_git($root,['--git-dir='.$gitRoot.'/bay-learnlab.git','update-ref','refs/heads/main',$tampered]);
    [$code,$out,$err]=vsr_run([PHP_BINARY,$base.'/bin/reconcile-vault-source-authority.php',$db,$gitRoot]);if($code!==0)throw new RuntimeException('reconcile failed: '.trim($err));$json=json_decode(trim($out),true,32,JSON_THROW_ON_ERROR);
    $state=(new HubProjectSourceAuthorityService($pdo,null))->state($project,false,$now);vsr_assert($code===0&&($json['reconciledCount']??-1)===0&&($state['authority']??null)==='GITHUB','unverified projection cannot seize Vault authority');
    echo "AWH Vault Source Reconcile: PASS\n";
}finally{if(is_dir($root)){foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST) as $f){$x=$f->getPathname();$f->isDir()&&!$f->isLink()?@rmdir($x):@unlink($x);}@rmdir($root);}}
