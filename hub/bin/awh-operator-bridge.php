<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubOperatorBridgeService.php';

const AWH_OPERATOR_MAX_REQUEST = 262144;
$database=getenv('AWH_HUB_DB_PATH');
$auditPath=getenv('AWH_OPERATOR_AUDIT_PATH');
if(!is_string($auditPath)||$auditPath==='')$auditPath='/var/lib/awh-hub/operator-bridge-audit.jsonl';
$raw=fgets(STDIN,AWH_OPERATOR_MAX_REQUEST+2);
$request=null;$action='unknown';$code='OK';$ok=false;$response=[];$serviceExit=0;
try{
    if(!is_string($database)||$database===''||str_contains($database,"\0"))throw new HubOperatorBridgeException('Database configuration is invalid','OPERATOR_CONFIG_INVALID');
    if(!is_string($raw)||$raw===''||strlen($raw)>AWH_OPERATOR_MAX_REQUEST)throw new HubOperatorBridgeException('Request is invalid','OPERATOR_REQUEST_INVALID');
    $request=json_decode(trim($raw),true,16,JSON_THROW_ON_ERROR);
    if(!is_array($request)||array_is_list($request))throw new HubOperatorBridgeException('Request is invalid','OPERATOR_REQUEST_INVALID');
    $action=is_string($request['action']??null)?(string)$request['action']:'unknown';
    $pdo=new PDO('sqlite:'.$database,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $result=(new HubOperatorBridgeService($pdo))->handle($request);
    $response=['ok'=>true,'result'=>$result];$ok=true;
}catch(HubOperatorBridgeException|HubBayRemoteUpdateException $error){$code=$error->codeName;$response=['ok'=>false,'code'=>$code,'message'=>$error->getMessage()];}
catch(Throwable){$code='OPERATOR_BRIDGE_FAILED';$response=['ok'=>false,'code'=>$code,'message'=>'Operator bridge failed safely'];$serviceExit=70;}
$at=gmdate('c');
$audit=['schemaVersion'=>1,'at'=>$at,'action'=>preg_match('/^[a-z.]{1,64}$/',$action)?$action:'invalid','ok'=>$ok,'code'=>$code,'requestSha256'=>hash('sha256',is_string($raw)?$raw:''),'peer'=>'awh-remote-socket'];
$line=json_encode($audit,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)."\n";
if(@file_put_contents($auditPath,$line,FILE_APPEND|LOCK_EX)!==false)@chmod($auditPath,0600);
$body=json_encode($response,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)."\n";
if(fwrite(STDOUT,$body)===false)exit(74);
exit($serviceExit);
