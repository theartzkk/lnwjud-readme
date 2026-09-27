<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/src/HubOperatorBridgeService.php';
require_once dirname(__DIR__) . '/src/HubVerificationIntelligence.php';

function ver_assert(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
if(!in_array('sqlite',PDO::getAvailableDrivers(),true)){fwrite(STDOUT,"AWH Verification Evidence Registry: SKIP pdo_sqlite unavailable\n");exit(77);}
$root=rtrim(sys_get_temp_dir(),'/').'/awh-verification-registry-'.bin2hex(random_bytes(5));
mkdir($root,0700,true);putenv('AWH_VERIFICATION_EVIDENCE_ROOT='.$root);$releaseManifest=$root.'/release.json';file_put_contents($releaseManifest,json_encode(['sourceSha'=>str_repeat('a',40),'sourceState'=>'COMMITTED'],JSON_THROW_ON_ERROR));putenv('AWH_PUBLIC_RELEASE_MANIFEST='.$releaseManifest);
try{
 $pdo=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
 $service=new HubOperatorBridgeService($pdo,static fn(string $endpoint,array $payload):array=>[]);
 $fingerprint=hash('sha256','registry-fixture');$regression='reg-'.substr($fingerprint,0,12);
 $incident=['schemaVersion'=>1,'kind'=>'verification-incident','fingerprint'=>$fingerprint,'regressionId'=>$regression,'code'=>'MISSION_QA_FAILED','context'=>['changedPaths'=>['scripts/ops/bounded-deploy-mission.mjs']],'required'=>true];
 $stored=$service->handle(['schemaVersion'=>1,'action'=>'verification.store','document'=>$incident,'confirmation'=>'STORE_VERIFICATION_EVIDENCE']);
 ver_assert(($stored['state']??null)==='STORED','incident must be stored durably');
 $query=$service->handle(['schemaVersion'=>1,'action'=>'verification.regressions','changedPaths'=>['scripts/ops/bounded-deploy-mission.mjs']]);
 ver_assert(($query['count']??0)===1&&($query['regressions'][0]['regressionId']??null)===$regression,'matching path must recall incident regression');
 $none=$service->handle(['schemaVersion'=>1,'action'=>'verification.regressions','changedPaths'=>['docs/OTHER.md']]);
 ver_assert(($none['count']??-1)===0,'unrelated path must not inherit regression');
 $classified=HubVerificationIntelligence::incident('MISSION_PRIVILEGE_LANE_REQUIRED:NO_NEW_PRIVILEGES',[
  'changedPaths'=>['deploy/awh-control-plane/privilege-route.php'],
  'releaseTrack'=>'vps-platform','projectId'=>'113b45c0-23e1-408d-ae0f-ac5eca7f6900',
 ]);
 $classifiedDoc=[...$classified,'kind'=>'verification-incident','createdAt'=>'2026-09-27T00:00:00Z'];
 $service->handle(['schemaVersion'=>1,'action'=>'verification.store','document'=>$classifiedDoc,'confirmation'=>'STORE_VERIFICATION_EVIDENCE']);
 $beforeLesson=$service->handle(['schemaVersion'=>1,'action'=>'verification.regressions','changedPaths'=>['docs/UNRELATED.md'],'releaseTrack'=>'vps-platform','projectId'=>'113b45c0-23e1-408d-ae0f-ac5eca7f6900']);
 ver_assert(($beforeLesson['count']??-1)===0,'raw classified incident must not propagate globally before verified closure');
 $lesson=[
  'schemaVersion'=>1,'kind'=>'verification-lesson',
  'classFingerprint'=>$classified['classFingerprint'],'lessonId'=>'lesson-'.substr($classified['classFingerprint'],0,12),
  'problemClass'=>$classified['problemClass'],'impactScope'=>$classified['impactScope'],'rootCauseLayer'=>$classified['rootCauseLayer'],
  'sourceRegressionId'=>$classified['regressionId'],'releaseTrack'=>'vps-platform','state'=>'ENFORCED',
  'requiredChecks'=>['privilege-route','repeat-regression'],
  'closure'=>[
   'rootCause'=>'Restricted worker attempted a host-global privileged release lane.',
   'canonicalFix'=>'Route host-global release through the typed privileged operator and approved parent execution.',
   'prevention'=>'Fail fast before mutation when the runtime lane cannot elevate.',
   'regression'=>'Replay privilege-route checks for future managed-project releases.',
   'recovery'=>'Resume from the exact durable release checkpoint after a valid privileged handoff.',
   'observability'=>'Expose the privilege lane and required handoff in release evidence.',
  ],
 ];
 $storedLesson=$service->handle(['schemaVersion'=>1,'action'=>'verification.store','document'=>$lesson,'confirmation'=>'STORE_VERIFICATION_EVIDENCE']);
 ver_assert(($storedLesson['kind']??null)==='verification-lesson','verified closure must persist as a durable lesson');
 $afterLesson=$service->handle(['schemaVersion'=>1,'action'=>'verification.regressions','changedPaths'=>['docs/UNRELATED.md'],'releaseTrack'=>'vps-platform','projectId'=>'113b45c0-23e1-408d-ae0f-ac5eca7f6900']);
 ver_assert(($afterLesson['count']??0)===1&&($afterLesson['regressions'][0]['source']??null)==='VERIFIED_LESSON','platform lesson must propagate beyond the original file path after verified closure');
 ver_assert(in_array('privilege-route',$afterLesson['regressions'][0]['requiredChecks']??[],true),'verified lesson must carry its required guardrail checks');
 try{$invalid=$lesson;unset($invalid['closure']['observability']);$service->handle(['schemaVersion'=>1,'action'=>'verification.store','document'=>$invalid,'confirmation'=>'STORE_VERIFICATION_EVIDENCE']);throw new RuntimeException('incomplete lesson accepted');}
 catch(HubOperatorBridgeException $error){ver_assert($error->codeName==='OPERATOR_REQUEST_INVALID','incomplete closure must never become an enforced lesson');}
 $release=['schemaVersion'=>1,'kind'=>'release-verification','releaseSha'=>str_repeat('a',40),'state'=>'COMPLETED','result'=>'PASS'];
 $storedRelease=$service->handle(['schemaVersion'=>1,'action'=>'verification.store','document'=>$release,'confirmation'=>'STORE_VERIFICATION_EVIDENCE']);
 ver_assert(($storedRelease['kind']??null)==='release-verification','release evidence must be stored durably');
 try{$bad=$release;$bad['releaseSha']=str_repeat('b',40);$service->handle(['schemaVersion'=>1,'action'=>'verification.store','document'=>$bad,'confirmation'=>'STORE_VERIFICATION_EVIDENCE']);throw new RuntimeException('mismatched release accepted');}
 catch(HubOperatorBridgeException $error){ver_assert($error->codeName==='OPERATOR_VERIFICATION_IDENTITY_MISMATCH','PASS release evidence must match public Production identity');}
 try{$service->handle(['schemaVersion'=>1,'action'=>'verification.store','document'=>$release]);throw new RuntimeException('missing confirmation accepted');}
 catch(HubOperatorBridgeException $error){ver_assert($error->codeName==='OPERATOR_CONFIRMATION_REQUIRED','store must require explicit typed confirmation');}
 fwrite(STDOUT,"AWH Verification Evidence Registry: PASS\n");
}finally{
 putenv('AWH_VERIFICATION_EVIDENCE_ROOT');putenv('AWH_PUBLIC_RELEASE_MANIFEST');
 if(is_dir($root)){foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST) as $f){$f->isDir()?@rmdir($f->getPathname()):@unlink($f->getPathname());}@rmdir($root);}
}
