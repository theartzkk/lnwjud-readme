<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubProjectSourceAuthorityService.php';

if ($argc !== 3) {
    fwrite(STDERR, "usage: reconcile-vault-source-authority.php <database> <git-root>\n");
    exit(64);
}

function rvsa_run_git(string $repo,array $args): string
{
    $cmd=array_merge(['git','--git-dir='.$repo],$args);
    $escaped=array_map('escapeshellarg',$cmd);
    $spec=[1=>['pipe','w'],2=>['pipe','w']];
    $proc=proc_open(implode(' ',$escaped),$spec,$pipes);
    if(!is_resource($proc)) throw new RuntimeException('git process failed');
    $out=stream_get_contents($pipes[1]);stream_get_contents($pipes[2]);
    fclose($pipes[1]);fclose($pipes[2]);$code=proc_close($proc);
    if($code!==0) throw new RuntimeException('git verification failed');
    return trim((string)$out);
}

function rvsa_exact_line(string $body,string $line): bool
{
    return preg_match('/(?:^|\\R)'.preg_quote($line,'/').'(?=\\R|$)/',$body)===1;
}

try {
    [$script,$database,$gitRoot]=$argv;
    if($database===''||str_contains($database,"\0")||$gitRoot===''||str_contains($gitRoot,"\0")) throw new RuntimeException('invalid input');
    $gitReal=realpath($gitRoot);
    if(!is_string($gitReal)||!is_dir($gitReal)||is_link($gitRoot)) throw new RuntimeException('git root unavailable');

    $pdo=new PDO('sqlite:'.$database,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,PDO::ATTR_EMULATE_PREPARES=>false]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA busy_timeout = 5000');
    $service=new HubProjectSourceAuthorityService($pdo,null);
    $repos=['BAY EXCUSE X'=>'bay-excuse-x.git','BAY Hub'=>'bay-hub.git','BAY LearnLab'=>'bay-learnlab.git','เว็บไซต์โรงเรียน'=>'school-website.git'];
    $q=$pdo->query("SELECT p.project_id,p.name,p.canonical_source_authority,p.canonical_source_vault_revision_id,p.canonical_source_content_sha256,v.active_revision_id,v.sync_state,v.file_count,r.state,r.content_sha256 FROM projects p JOIN control_project_vaults v USING(project_id) LEFT JOIN control_project_vault_revisions r ON r.revision_id=v.active_revision_id ORDER BY p.name");
    $reconciled=[];$verified=[];

    foreach($q->fetchAll() as $row){
        $name=(string)$row['name'];
        if(!isset($repos[$name])) continue;
        $vault=(string)($row['active_revision_id']??'');
        $content=strtolower((string)($row['content_sha256']??''));
        $count=(int)($row['file_count']??0);
        if(($row['sync_state']??null)!=='SYNCED'||($row['state']??null)!=='ACTIVE'||preg_match('/^[0-9a-f-]{36}$/i',$vault)!==1||preg_match('/^[a-f0-9]{64}$/',$content)!==1||$count<1) continue;

        $repo=$gitReal.'/'.$repos[$name];
        $repoReal=realpath($repo);
        if(!is_string($repoReal)||!is_dir($repoReal)||is_link($repo)||!str_starts_with($repoReal,$gitReal.'/')) continue;
        $head=strtolower(rvsa_run_git($repoReal,['rev-parse','refs/heads/main']));
        if(preg_match('/^[a-f0-9]{40}$/',$head)!==1) continue;
        $parts=preg_split('/\\s+/',rvsa_run_git($repoReal,['rev-list','--parents','-n','1',$head]))?:[];
        if(count($parts)!==2||strtolower((string)$parts[0])!==$head||preg_match('/^[a-f0-9]{40}$/i',(string)$parts[1])!==1) continue;
        $parent=strtolower((string)$parts[1]);
        $tree=strtolower(rvsa_run_git($repoReal,['rev-parse',$head.'^{tree}']));
        $parentTree=strtolower(rvsa_run_git($repoReal,['rev-parse',$parent.'^{tree}']));
        if(!hash_equals($tree,$parentTree)) continue;
        $body=rvsa_run_git($repoReal,['show','-s','--format=%B',$head]);
        foreach(['Vault-Revision: '.$vault,'Content-SHA256: '.$content,'Authority: AWH_VAULT','Projection: true','Source-Revision: '.$parent] as $line){
            if(!rvsa_exact_line($body,$line)) continue 2;
        }
        $files=array_values(array_filter(preg_split('/\\R/',rvsa_run_git($repoReal,['ls-tree','-r','--name-only',$head]))?:[],static fn(string $v):bool=>$v!==''));
        if(count($files)!==$count) continue;
        $verified[]=$name;

        $canonical=(string)($row['canonical_source_vault_revision_id']??'');
        $canonicalContent=strtolower((string)($row['canonical_source_content_sha256']??''));
        if(($row['canonical_source_authority']??null)==='AWH_VAULT'&&hash_equals(strtolower($vault),strtolower($canonical))&&hash_equals($content,$canonicalContent)) continue;
        $state=$service->bindVault((string)$row['project_id'],$vault);
        if(($state['authority']??null)!=='AWH_VAULT'||($state['canonicalVaultRevisionId']??null)!==$vault||strtolower((string)($state['canonicalContentSha256']??''))!==$content||($state['state']??null)!=='CURRENT') throw new RuntimeException('postcondition failed');
        $reconciled[]=$name;
    }

    echo json_encode(['schemaVersion'=>1,'state'=>'RECONCILED','verified'=>$verified,'reconciled'=>$reconciled,'verifiedCount'=>count($verified),'reconciledCount'=>count($reconciled)],JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR).PHP_EOL;
} catch(Throwable $error) {
    $code=$error instanceof HubProjectSourceAuthorityException?$error->codeName:get_class($error);
    fwrite(STDERR,"VAULT_SOURCE_RECONCILE_FAILED=".$code."\n");
    exit(2);
}
