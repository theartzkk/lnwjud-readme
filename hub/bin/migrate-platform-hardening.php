<?php
declare(strict_types=1);
require_once dirname(__DIR__).'/src/HubPlatformHardeningMigration.php';
if($argc!==2){fwrite(STDERR,"Usage: php migrate-platform-hardening.php <database-path>\n");exit(2);}
try{
 $r=HubPlatformHardeningMigration::apply($argv[1],dirname(__DIR__).'/migrations/022_platform_hardening.sql');
 fwrite(STDOUT,"M23 Platform Hardening: {$r}\n");
}catch(Throwable $e){fwrite(STDERR,"M23 Platform Hardening failed\n");exit(1);}
