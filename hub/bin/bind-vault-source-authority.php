<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/src/HubProjectSourceAuthorityService.php';
if ($argc !== 4) { fwrite(STDERR,"usage: bind-vault-source-authority.php <database> <project-id> <vault-revision-id>\n"); exit(2); }
try {
    $pdo=new PDO('sqlite:'.$argv[1],null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);$pdo->exec('PRAGMA foreign_keys = ON');
    $service=new HubProjectSourceAuthorityService($pdo,null); $state=$service->bindVault($argv[2],$argv[3]);
    fwrite(STDOUT,json_encode(['schemaVersion'=>1,'projectId'=>$state['projectId'],'authority'=>$state['authority'],'canonicalRevision'=>$state['canonicalRevision'],'canonicalVaultRevisionId'=>$state['canonicalVaultRevisionId'],'state'=>$state['state']],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)."\n");
} catch(Throwable $error){$code=property_exists($error,'codeName')?$error->codeName:'PROJECT_SOURCE_FAILED';fwrite(STDERR,"VAULT_SOURCE_AUTHORITY_FAILED=".$code."\n");exit(1);}
