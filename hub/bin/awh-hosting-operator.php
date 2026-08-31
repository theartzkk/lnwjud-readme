<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/src/HubProjectVault.php';
require_once dirname(__DIR__) . '/src/HubManagedHostingOperator.php';
$db=getenv('AWH_HUB_DB_PATH');if(!is_string($db)||$db===''||str_contains($db,"\0")){fwrite(STDERR,"DATABASE_CONFIG_INVALID\n");exit(2);}try{$pdo=new PDO('sqlite:'.$db,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);$pdo->exec('PRAGMA foreign_keys=ON');$pdo->exec('PRAGMA busy_timeout=7500');$pdo->exec('PRAGMA journal_mode=WAL');$result=HubManagedHostingOperator::fromEnvironment($pdo)->tick();fwrite(STDOUT,json_encode($result,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)."\n");}catch(HubManagedHostingOperatorException|HubProjectVaultException|HubAccountHostingMigrationException $e){fwrite(STDERR,$e->codeName."\n");exit(1);}catch(Throwable){fwrite(STDERR,"HOSTING_OPERATOR_FAILED\n");exit(1);}
