<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/src/HubControlPlaneService.php';
function peg_assert(bool $ok,string $m):void{if(!$ok)throw new RuntimeException($m);}
if(!extension_loaded('pdo_sqlite')){fwrite(STDOUT,"AWH Promotion Evidence Gate: SKIP required PHP extension unavailable\n");exit(77);}
$root=sys_get_temp_dir().'/awh-peg-'.bin2hex(random_bytes(5)); mkdir($root,0700,true);
try {
 $pdo=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
 $pdo->exec('CREATE TABLE control_artifacts(artifact_id TEXT PRIMARY KEY,task_id TEXT,project_id TEXT,kind TEXT,sha256 TEXT,size_bytes INTEGER)');
 $pdo->exec('CREATE TABLE control_artifact_objects(artifact_id TEXT PRIMARY KEY,storage_key TEXT,mime_type TEXT,deleted_at TEXT)');
 $artifact='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; $task='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; $project='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 $base='dddddddd-dddd-4ddd-8ddd-dddddddddddd'; $candidate='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 $report=['schemaVersion'=>2,'kind'=>'project-candidate','projectId'=>$project,'taskId'=>$task,'baseRevisionId'=>$base,'candidateRevisionId'=>$candidate,'qa'=>['candidate'=>['status'=>'PASS']]];
 $source=$root.'/report.json'; file_put_contents($source,json_encode($report,JSON_THROW_ON_ERROR)); chmod($source,0640);
 $store=new HubArtifactStore($root); $stored=$store->storeFile($artifact,$source);
 $pdo->prepare('INSERT INTO control_artifacts VALUES(?,?,?,?,?,?)')->execute([$artifact,$task,$project,'project-candidate',$stored['sha256'],$stored['sizeBytes']]);
 $pdo->prepare('INSERT INTO control_artifact_objects(artifact_id,storage_key,mime_type,deleted_at) VALUES(?,?,?,NULL)')->execute([$artifact,$stored['storageKey'],'application/json']);
 $ref=new ReflectionClass(HubControlPlaneService::class); $service=$ref->newInstanceWithoutConstructor();
 foreach(['pdo'=>$pdo,'artifactStore'=>$store] as $name=>$value){$p=$ref->getProperty($name);$p->setAccessible(true);$p->setValue($service,$value);}
 $scope=['taskId'=>$task,'projectId'=>$project,'expectedActiveRevisionId'=>$base,'candidateRevisionId'=>$candidate,'artifactId'=>$artifact,'evidenceSchemaVersion'=>2,'qaStatus'=>'PASS'];
 $verify=$ref->getMethod('assertPromotionEvidence');$verify->setAccessible(true);$verify->invoke($service,$scope);
 $parse=$ref->getMethod('revisionPromotionScope');$parse->setAccessible(true);
 $legacy=$parse->invoke(null,json_encode(array_slice($scope,0,5),JSON_THROW_ON_ERROR));
 peg_assert($legacy['evidenceSchemaVersion']===null&&$legacy['qaStatus']===null,'legacy promotion scope must remain compatible');
 file_put_contents($store->read($stored['storageKey']),"tampered\n");
 try{$verify->invoke($service,$scope);throw new RuntimeException('tampered evidence was accepted');}
 catch(ReflectionException $e){throw $e;}catch(Throwable $e){$c=$e->getPrevious()??$e;peg_assert($c instanceof HubControlPlaneException&&$c->codeName==='APPROVAL_EVIDENCE_INVALID','tampered evidence must fail closed');}
 $durable=file_get_contents(dirname(__DIR__).'/src/HubDurableExecutionService.php');
 peg_assert(is_string($durable)&&str_contains($durable,"'evidenceSchemaVersion' => 2")&&str_contains($durable,"'qaStatus' => \$qaStatus"),'new native approval scope must bind QA evidence');
 fwrite(STDOUT,"AWH Promotion Evidence Gate: PASS\n");
} finally { if(is_dir($root)){foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST) as $i){$i->isDir()?@rmdir($i->getPathname()):@unlink($i->getPathname());}@rmdir($root);} }
