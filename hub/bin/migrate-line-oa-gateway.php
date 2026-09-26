<?php
declare(strict_types=1);
require_once dirname(__DIR__).'/src/HubLineOaGatewayMigration.php';
if($argc!==2){fwrite(STDERR,"Usage: php migrate-line-oa-gateway.php <database-path>\n");exit(2);}
try{
 $r=HubLineOaGatewayMigration::apply($argv[1],dirname(__DIR__).'/migrations/023_line_oa_gateway.sql');
 fwrite(STDOUT,"M24 AWH LINE OA Gateway: {$r}\n");
}catch(Throwable $e){fwrite(STDERR,"M24 AWH LINE OA Gateway failed\n");exit(1);}
