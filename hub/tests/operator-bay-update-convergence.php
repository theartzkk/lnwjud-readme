<?php
declare(strict_types=1);

require_once dirname(__DIR__).'/src/HubOperatorBridgeService.php';

function conv_assert(bool $ok,string $message):void{
    if(!$ok)throw new RuntimeException($message);
    echo "PASS: {$message}\n";
}
function conv_exec(array $cmd,?string $cwd=null):string{
    $pipes=[];
    $p=proc_open($cmd,[0=>['file','/dev/null','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes,$cwd,null,['bypass_shell'=>true]);
    if(!is_resource($p))throw new RuntimeException('process start failed');
    $out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);
    foreach($pipes as $pipe)if(is_resource($pipe))fclose($pipe);
    $code=proc_close($p);
    if($code!==0)throw new RuntimeException('process failed: '.trim((string)$err));
    return trim((string)$out);
}

if(!in_array('sqlite',PDO::getAvailableDrivers(),true)){
    fwrite(STDOUT,"BAY convergence: SKIP pdo_sqlite unavailable\n");exit(77);
}

$root=rtrim(sys_get_temp_dir(),'/').'/awh-bay-convergence-'.bin2hex(random_bytes(5));
$project='7ee0b9ec-4d2e-435f-92da-fa949afb7c01';
try{
    mkdir($root,0700,true);
    $gitRoot=$root.'/git';$repo=$gitRoot.'/bay-excuse-x.git';$work=$root.'/work';
    mkdir($gitRoot,0700,true);
    conv_exec(['/usr/bin/git','init','--bare',$repo]);
    conv_exec(['/usr/bin/git','init',$work]);
    conv_exec(['/usr/bin/git','config','user.email','qa@example.invalid'],$work);
    conv_exec(['/usr/bin/git','config','user.name','AWH QA'],$work);
    file_put_contents($work.'/VERSION',"fixture\n");
    conv_exec(['/usr/bin/git','add','.'],$work);
    conv_exec(['/usr/bin/git','commit','-m','production baseline'],$work);
    $deployed=conv_exec(['/usr/bin/git','rev-parse','HEAD'],$work);

    file_put_contents($work.'/VERSION',"fixture-next\n");
    conv_exec(['/usr/bin/git','add','VERSION'],$work);
    conv_exec(['/usr/bin/git','commit','-m','canonical source'],$work);
    $source=conv_exec(['/usr/bin/git','rev-parse','HEAD'],$work);

    $projectionMessage="AWH Vault projection: BAY convergence fixture\n\n".
        "Vault-Revision: 9007585d-87a2-400b-a382-a4bf3c03a5b6\n".
        "Content-SHA256: ".str_repeat('a',64)."\n".
        "Authority: AWH_VAULT\n".
        "Projection: true\n".
        "Source-Revision: {$source}";
    conv_exec(['/usr/bin/git','commit','--allow-empty','-m',$projectionMessage],$work);
    $projection=conv_exec(['/usr/bin/git','rev-parse','HEAD'],$work);
    conv_exec(['/usr/bin/git','branch','-M','main'],$work);
    conv_exec(['/usr/bin/git','remote','add','origin',$repo],$work);
    conv_exec(['/usr/bin/git','push','origin','main'],$work);

    putenv('AWH_CANONICAL_GIT_ROOT='.$gitRoot);
    $pdo=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $pdo->exec("CREATE TABLE control_task_executions(execution_id TEXT PRIMARY KEY,project_id TEXT,required_capability TEXT,state TEXT,updated_at TEXT,checkpoint_json TEXT)");
    $notes=[
        'schemaVersion'=>1,
        'summary'=>['features'=>['canonical convergence'],'improvements'=>[],'fixes'=>[],'internal'=>[]],
        'impact'=>['plannedDowntime'=>false,'databaseMigration'=>'NONE','serviceReload'=>'NONE','appRestart'=>'NONE','signIn'=>'NONE'],
        'knownIssues'=>[],
    ];
    $checkpoint=['repository'=>'bay-excuse-x','targetSha'=>$projection,'releaseNotes'=>$notes];
    $q=$pdo->prepare("INSERT INTO control_task_executions VALUES(?,?,?,?,?,?)");
    $q->execute(['11111111-1111-4111-8111-111111111111',$project,'source.promote','COMPLETED','2026-09-26T10:00:00+00:00',json_encode($checkpoint,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)]);

    $service=new HubOperatorBridgeService($pdo,static fn(string $endpoint,array $payload):array=>[]);
    $parityMethod=new ReflectionMethod(HubOperatorBridgeService::class,'bayProductionSourceParity');
    $parity=$parityMethod->invoke($service,['deployedSha'=>$deployed]);
    conv_assert(($parity['ready']??true)===false&&($parity['sourceRevision']??null)===$source,'older Production is reported as source drift against canonical Source-Revision');

    $targetMethod=new ReflectionMethod(HubOperatorBridgeService::class,'assertBayCanonicalTarget');
    $canonical=$targetMethod->invoke($service,$source);
    conv_assert(($canonical['projectionSha']??null)===$projection&&($canonical['sourceRevision']??null)===$source,'canonical Source-Revision is accepted as guarded update target');
    try{$targetMethod->invoke($service,$deployed);throw new RuntimeException('expected target rejection');}
    catch(ReflectionException $e){throw $e;}
    catch(Throwable $e){
        $cause=$e instanceof ReflectionException?$e:$e;
        if($e instanceof HubOperatorBridgeException){conv_assert($e->codeName==='OPERATOR_BAY_TARGET_DRIFT','non-canonical target is rejected fail-closed');}
        elseif($e instanceof ReflectionInvocationException && $e->getPrevious() instanceof HubOperatorBridgeException){conv_assert($e->getPrevious()->codeName==='OPERATOR_BAY_TARGET_DRIFT','non-canonical target is rejected fail-closed');}
        else throw $e;
    }

    $releaseMethod=new ReflectionMethod(HubOperatorBridgeService::class,'releaseDetailsForSourceSha');
    $resolved=$releaseMethod->invoke($service,$project,'bay-excuse-x',$source);
    conv_assert(is_array($resolved)&&($resolved['summary']['features'][0]??null)==='canonical convergence','projection release notes resolve through Source-Revision');

    $serviceSource=(string)file_get_contents(dirname(__DIR__).'/src/HubOperatorBridgeService.php');
    conv_assert(substr_count($serviceSource,'$this->assertBayCanonicalTarget($sha);')===2,'stage and install both require canonical target identity');
    conv_assert(!str_contains($serviceSource,'$this->assertBayProductionSourceParity($before);'),'stage/install no longer require pre-update parity');
    conv_assert(str_contains($serviceSource,'$this->assertBayProductionSourceParity($after);'),'install requires post-update parity before success');

    echo "AWH BAY Update Convergence Contract: PASS\n";
} finally {
    putenv('AWH_CANONICAL_GIT_ROOT');
    if(is_dir($root)){
        foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST) as $f){
            $path=$f->getPathname();$f->isDir()&&!$f->isLink()?@rmdir($path):@unlink($path);
        }
        @rmdir($root);
    }
}
