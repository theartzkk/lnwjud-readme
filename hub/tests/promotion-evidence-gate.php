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
 $pdo->exec('CREATE TABLE control_project_vault_revisions(revision_id TEXT PRIMARY KEY,project_id TEXT,parent_revision_id TEXT,content_sha256 TEXT,state TEXT)');
 $task='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; $project='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 $base='dddddddd-dddd-4ddd-8ddd-dddddddddddd'; $candidate='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 $artifact='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 $legacyReport=['schemaVersion'=>2,'kind'=>'project-candidate','projectId'=>$project,'taskId'=>$task,'baseRevisionId'=>$base,'candidateRevisionId'=>$candidate,'qa'=>['candidate'=>['status'=>'PASS']]];
 $legacySource=$root.'/legacy.json'; file_put_contents($legacySource,json_encode($legacyReport,JSON_THROW_ON_ERROR)); chmod($legacySource,0640);
 $store=new HubArtifactStore($root); $legacyStored=$store->storeFile($artifact,$legacySource);
 $pdo->prepare('INSERT INTO control_artifacts VALUES(?,?,?,?,?,?)')->execute([$artifact,$task,$project,'project-candidate',$legacyStored['sha256'],$legacyStored['sizeBytes']]);
 $pdo->prepare('INSERT INTO control_artifact_objects(artifact_id,storage_key,mime_type,deleted_at) VALUES(?,?,?,NULL)')->execute([$artifact,$legacyStored['storageKey'],'application/json']);
 $ref=new ReflectionClass(HubControlPlaneService::class); $service=$ref->newInstanceWithoutConstructor();
 foreach(['pdo'=>$pdo,'artifactStore'=>$store] as $name=>$value){$p=$ref->getProperty($name);$p->setAccessible(true);$p->setValue($service,$value);}
 $verify=$ref->getMethod('assertPromotionEvidence');$verify->setAccessible(true);
 $parse=$ref->getMethod('revisionPromotionScope');$parse->setAccessible(true);

 $scopeV2=['taskId'=>$task,'projectId'=>$project,'expectedActiveRevisionId'=>$base,'candidateRevisionId'=>$candidate,'artifactId'=>$artifact,'evidenceSchemaVersion'=>2,'qaStatus'=>'PASS'];
 $verify->invoke($service,$scopeV2);
 $legacy=$parse->invoke(null,json_encode(array_slice($scopeV2,0,5),JSON_THROW_ON_ERROR));
 peg_assert($legacy['evidenceSchemaVersion']===null&&$legacy['qaStatus']===null&&$legacy['contentSha256']===null,'legacy promotion scope must remain compatible');

 $content=str_repeat('1',64); $artifactV3='ffffffff-ffff-4fff-8fff-ffffffffffff';
 $qa=['candidate'=>['status'=>'PASS','workerWorkspaceIsolation'=>'PASS','candidateArchiveValidation'=>'PASS','manifestIntegrity'=>'PASS','projectDefinedTests'=>'PASS','visualReview'=>['status'=>'NOT_APPLICABLE']]];
 $verification=HubVerificationGate::evaluateCandidate($qa);
 $reportV3=['schemaVersion'=>2,'kind'=>'project-candidate','projectId'=>$project,'taskId'=>$task,'baseRevisionId'=>$base,'candidateRevisionId'=>$candidate,'contentSha256'=>$content,'qa'=>$qa,'verification'=>$verification];
 $sourceV3=$root.'/v3.json'; file_put_contents($sourceV3,json_encode($reportV3,JSON_THROW_ON_ERROR)); chmod($sourceV3,0640);
 $storedV3=$store->storeFile($artifactV3,$sourceV3);
 $pdo->prepare('INSERT INTO control_artifacts VALUES(?,?,?,?,?,?)')->execute([$artifactV3,$task,$project,'project-candidate',$storedV3['sha256'],$storedV3['sizeBytes']]);
 $pdo->prepare('INSERT INTO control_artifact_objects(artifact_id,storage_key,mime_type,deleted_at) VALUES(?,?,?,NULL)')->execute([$artifactV3,$storedV3['storageKey'],'application/json']);
 $pdo->prepare('INSERT INTO control_project_vault_revisions VALUES(?,?,?,?,?)')->execute([$candidate,$project,$base,$content,'CANDIDATE']);
 $scopeV3=['taskId'=>$task,'projectId'=>$project,'expectedActiveRevisionId'=>$base,'candidateRevisionId'=>$candidate,'contentSha256'=>$content,'artifactId'=>$artifactV3,'evidenceSchemaVersion'=>3,'qaStatus'=>'PASS'];
 $parsedV3=$parse->invoke(null,json_encode($scopeV3,JSON_THROW_ON_ERROR));
 peg_assert($parsedV3['evidenceSchemaVersion']===3&&$parsedV3['contentSha256']===$content,'v3 scope must bind exact content hash');
 $verify->invoke($service,$parsedV3);

 $badHash=$parsedV3; $badHash['contentSha256']=str_repeat('2',64);
 try{$verify->invoke($service,$badHash);throw new RuntimeException('mismatched content hash was accepted');}
 catch(ReflectionException $e){throw $e;}catch(Throwable $e){$c=$e->getPrevious()??$e;peg_assert($c instanceof HubControlPlaneException&&$c->codeName==='APPROVAL_EVIDENCE_INVALID','mismatched content hash must fail closed');}

 file_put_contents($store->read($legacyStored['storageKey']),"tampered\n");
 try{$verify->invoke($service,$scopeV2);throw new RuntimeException('tampered evidence was accepted');}
 catch(ReflectionException $e){throw $e;}catch(Throwable $e){$c=$e->getPrevious()??$e;peg_assert($c instanceof HubControlPlaneException&&$c->codeName==='APPROVAL_EVIDENCE_INVALID','tampered evidence must fail closed');}

 $durable=file_get_contents(dirname(__DIR__).'/src/HubDurableExecutionService.php');
 peg_assert(is_string($durable)&&str_contains($durable,"'evidenceSchemaVersion' => 3")&&str_contains($durable,"'contentSha256' => \$candidate['contentSha256']"),'native approval scope must bind v3 exact revision evidence');
 fwrite(STDOUT,"AWH Promotion Evidence Gate: PASS\n");
} finally {
 if(is_dir($root)){foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST) as $i){$i->isDir()?@rmdir($i->getPathname()):@unlink($i->getPathname());}@rmdir($root);}
}
