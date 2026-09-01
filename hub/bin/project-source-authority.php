<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/src/HubArtifactStore.php';
require_once dirname(__DIR__) . '/src/HubCloudWorkflowService.php';
require_once dirname(__DIR__) . '/src/HubProjectSourceAuthorityService.php';
if ($argc < 4 || $argc > 5) { fwrite(STDERR,"usage: project-source-authority.php <database> <project-id> <owner/repo> [ref]\n"); exit(2); }
try {
    $pdo=new PDO('sqlite:'.$argv[1],null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);$pdo->exec('PRAGMA foreign_keys = ON');
    $cloud=new HubCloudWorkflowService($pdo,HubArtifactStore::fromEnvironment());
    $service=new HubProjectSourceAuthorityService($pdo,$cloud); $state=$service->bindGitHub($argv[2],$argv[3],$argv[4]??null,null,true);
    fwrite(STDOUT,json_encode(['schemaVersion'=>1,'projectId'=>$state['projectId'],'repository'=>$state['repository'],'ref'=>$state['ref'],'canonicalRevision'=>$state['canonicalRevision'],'state'=>$state['state']],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)."\n");
} catch(Throwable $error){$code=property_exists($error,'codeName')?$error->codeName:'PROJECT_SOURCE_FAILED';fwrite(STDERR,"PROJECT_SOURCE_AUTHORITY_FAILED=".$code."\n");exit(1);}
