<?php

declare(strict_types=1);

function sd_assert(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);echo "PASS: {$message}\n";}
function sd_run(array $args,?string $cwd=null):array{
    $cmd=array_map('escapeshellarg',$args);$spec=[1=>['pipe','w'],2=>['pipe','w']];
    $proc=proc_open(implode(' ',$cmd),$spec,$pipes,$cwd);
    if(!is_resource($proc))throw new RuntimeException('process start failed');
    $out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);$code=proc_close($proc);
    return [$code,(string)$out,(string)$err];
}
function sd_git(string $cwd,array $args):string{
    [$code,$out,$err]=sd_run(array_merge(['git'],$args),$cwd);if($code!==0)throw new RuntimeException('git failed: '.$err);return trim($out);
}
if(!in_array('sqlite',PDO::getAvailableDrivers(),true)){fwrite(STDOUT,"AWH Source Drift Policy: SKIP pdo_sqlite unavailable\n");exit(77);}
$root=rtrim(sys_get_temp_dir(),'/').'/awh-source-drift-'.bin2hex(random_bytes(6));
try{
    mkdir($root,0700,true);$db=$root.'/awh.sqlite';$pdo=new PDO('sqlite:'.$db,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE projects(project_id TEXT,name TEXT,canonical_source_authority TEXT,canonical_source_vault_revision_id TEXT,canonical_source_content_sha256 TEXT)');
    $pdo->exec('CREATE TABLE control_project_vaults(project_id TEXT,active_revision_id TEXT,sync_state TEXT,file_count INTEGER)');
    $pdo->exec('CREATE TABLE control_project_vault_revisions(revision_id TEXT,state TEXT,content_sha256 TEXT)');
    $work=$root.'/work';mkdir($work,0700);sd_git($work,['init','-q']);sd_git($work,['config','user.email','qa@localhost']);sd_git($work,['config','user.name','AWH QA']);
    mkdir($work.'/hub/src',0777,true);file_put_contents($work.'/hub/src/HubCapabilityRegistryService.php',"<?php\n// 'mode'=>'CONTEXT_ONLY'\n// 'enforcement'=>'ADVISORY'\n");
    file_put_contents($work.'/ART_AI_WORKING_PROTOCOL.md',"# AWH Working Context\nVersion: 3.0\nMode: context-only\n");sd_git($work,['add','.']);sd_git($work,['commit','-qm','production']);$production=sd_git($work,['rev-parse','HEAD']);
    file_put_contents($work.'/candidate.txt',"candidate\n");sd_git($work,['add','candidate.txt']);sd_git($work,['commit','-qm','candidate']);$main=sd_git($work,['rev-parse','HEAD']);
    $gitRoot=$root.'/git';mkdir($gitRoot,0700);sd_git($root,['clone','-q','--bare',$work,$gitRoot.'/awh.git']);sd_git($root,['--git-dir='.$gitRoot.'/awh.git','update-ref','refs/heads/production',$production]);sd_git($root,['--git-dir='.$gitRoot.'/awh.git','update-ref','refs/heads/main',$main]);
    $manifest=$root.'/release.json';file_put_contents($manifest,json_encode(['sourceSha'=>$production],JSON_THROW_ON_ERROR));
    [$code,$out,$err]=sd_run([PHP_BINARY,dirname(__DIR__).'/bin/ecosystem-source-drift.php',$db,$gitRoot,$manifest]);$json=json_decode(trim($out),true,32,JSON_THROW_ON_ERROR);
    sd_assert($code===0&&($json['ok']??false)===true&&($json['state']??null)==='PENDING_RELEASE'&&($json['findings']??null)===[],'main ahead of production is pending, not drift failure');
    sd_assert(in_array('AWH main ahead of production',$json['pending']??[],true),'pending release reason is explicit');
    sd_git($work,['checkout','-q','-b','production-next',$production]);file_put_contents($work.'/production-next.txt',"production-next\n");sd_git($work,['add','production-next.txt']);sd_git($work,['commit','-qm','production-next']);$productionNext=sd_git($work,['rev-parse','HEAD']);sd_git($root,['--git-dir='.$gitRoot.'/awh.git','fetch','-q',$work,$productionNext]);sd_git($root,['--git-dir='.$gitRoot.'/awh.git','update-ref','refs/heads/production',$productionNext]);file_put_contents($manifest,json_encode(['sourceSha'=>$productionNext],JSON_THROW_ON_ERROR));
    sd_git($work,['checkout','-q','-b','diverged',$production]);file_put_contents($work.'/diverged.txt',"diverged\n");sd_git($work,['add','diverged.txt']);sd_git($work,['commit','-qm','diverged']);$diverged=sd_git($work,['rev-parse','HEAD']);sd_git($root,['--git-dir='.$gitRoot.'/awh.git','fetch','-q',$work,$diverged]);sd_git($root,['--git-dir='.$gitRoot.'/awh.git','update-ref','refs/heads/main',$diverged]);
    [$code,$out,$err]=sd_run([PHP_BINARY,dirname(__DIR__).'/bin/ecosystem-source-drift.php',$db,$gitRoot,$manifest]);$json=json_decode(trim($out),true,32,JSON_THROW_ON_ERROR);
    sd_assert($code===2&&($json['state']??null)==='BLOCKED'&&in_array('AWH main/production divergence',$json['findings']??[],true),'true main/production divergence still fails closed');
    echo "AWH Source Drift Policy: PASS\n";
}finally{
    if(is_dir($root)){foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST) as $f){$t=$f->getPathname();$f->isDir()&&!$f->isLink()?@rmdir($t):@unlink($t);}@rmdir($root);}
}
