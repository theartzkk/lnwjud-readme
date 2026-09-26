<?php
declare(strict_types=1);

require_once dirname(__DIR__).'/src/HubLineOaGatewayMigration.php';
require_once dirname(__DIR__).'/src/HubLineOaGatewayService.php';

function m24_assert(bool $ok,string $message): void { if(!$ok)throw new RuntimeException($message); echo "PASS: {$message}\n"; }
if(!in_array('sqlite',PDO::getAvailableDrivers(),true)){echo "AWH M24 LINE OA Gateway: SKIP\n";exit(77);}
$root=rtrim(sys_get_temp_dir(),'/').'/awh-m24-'.bin2hex(random_bytes(6));$dbPath=$root.'/awh.sqlite';

try{
 mkdir($root,0700,true);
 $pdo=new PDO('sqlite:'.$dbPath,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
 $pdo->exec('PRAGMA foreign_keys=ON');
 $pdo->exec("CREATE TABLE awh_schema_migrations(migration_id TEXT PRIMARY KEY,schema_version INTEGER NOT NULL,checksum TEXT NOT NULL,applied_at TEXT NOT NULL)");
 $pdo->exec("CREATE TABLE hub_users(user_id TEXT PRIMARY KEY,display_name TEXT NOT NULL,revoked_at TEXT)");
 $pdo->exec("CREATE TABLE control_capability_catalog(capability TEXT PRIMARY KEY,enabled INTEGER NOT NULL)");
 $pdo->exec("CREATE TABLE control_domain_events(event_id TEXT PRIMARY KEY)");
 $pdo->exec("INSERT INTO control_capability_catalog VALUES('qa.runner',1),('event.outbox',1)");
 $m23=dirname(__DIR__).'/migrations/022_platform_hardening.sql';
 $pdo->prepare("INSERT INTO awh_schema_migrations VALUES('m23-platform-hardening',23,?,'2026-09-26T12:00:00Z')")->execute([hash_file('sha256',$m23)]);
 $owner='11111111-1111-4111-8111-111111111111';$pdo->prepare("INSERT INTO hub_users VALUES(?,? ,NULL)")->execute([$owner,'Owner']);
 $pdo->exec('PRAGMA user_version=23');
 $m24=dirname(__DIR__).'/migrations/023_line_oa_gateway.sql';
 m24_assert(HubLineOaGatewayMigration::apply($dbPath,$m24,'2026-09-26T13:00:00Z')==='applied','M24 applies after M23');
 m24_assert(HubLineOaGatewayMigration::apply($dbPath,$m24,'2026-09-26T13:01:00Z')==='already-applied','M24 is idempotent');
 $pdo=null;$pdo=new PDO('sqlite:'.$dbPath,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);$pdo->exec('PRAGMA foreign_keys=ON');
 m24_assert((int)$pdo->query('PRAGMA user_version')->fetchColumn()===24,'M24 advances user_version to 24');

 $credentialRoot=$root.'/credentials';putenv('AWH_PROVIDER_CREDENTIAL_ROOT='.$credentialRoot);
 $replies=[];$transport=static function(string $url,array $headers,string $body)use(&$replies):array{$replies[]=['url'=>$url,'headers'=>$headers,'body'=>$body];return ['status'=>200,'body'=>'{}'];};
 $gateway=HubLineOaGatewayService::fromEnvironment($pdo,$transport);
 $secret='0123456789abcdef0123456789abcdef';
 $token=str_repeat('t',64);
 $status=$gateway->configure($secret,$token,$owner,'2026-09-26T13:02:00Z');
 m24_assert($status['configured']===true&&$status['bound']===false,'credentials stay server-side and gateway becomes configured');
 $pair=$gateway->openPairing($owner,'2026-09-26T13:03:00Z');
 m24_assert(str_starts_with($pair['code'],'AWH-'),'owner receives one-time pairing code');
 $lineUser='U'.str_repeat('a',32);
 $pairBody=json_encode(['events'=>[['type'=>'message','replyToken'=>'reply-one','webhookEventId'=>'event-pair','source'=>['userId'=>$lineUser],'message'=>['type'=>'text','text'=>$pair['code']]]]],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
 $pairSig=base64_encode(hash_hmac('sha256',$pairBody,$secret,true));
 $pairResult=$gateway->handleWebhook($pairSig,$pairBody,static fn()=>['replyText'=>'unexpected'],'2026-09-26T13:04:00Z');
 m24_assert($pairResult['acceptedEvents']===1&&count($replies)===1,'signed LINE event pairs canonical Owner');
 $bound=$gateway->status($owner,'2026-09-26T13:04:01Z');
 m24_assert($bound['bound']===true,'Owner binding is active');

 $called=[];$commandBody=json_encode(['events'=>[['type'=>'message','replyToken'=>'reply-two','webhookEventId'=>'event-command','source'=>['userId'=>$lineUser],'message'=>['type'=>'text','text'=>'สถานะระบบ']]]],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
 $commandSig=base64_encode(hash_hmac('sha256',$commandBody,$secret,true));
 $commandResult=$gateway->handleWebhook($commandSig,$commandBody,static function(string $user,string $text,string $event)use(&$called):array{$called=[$user,$text,$event];return ['replyText'=>'AWH พร้อมใช้งาน ✅'];},'2026-09-26T13:05:00Z');
 m24_assert($commandResult['acceptedEvents']===1&&$called===[$owner,'สถานะระบบ','event-command'],'bound LINE command resolves to canonical Owner');
 m24_assert(count($replies)===2&&str_contains($replies[1]['body'],'AWH พร้อมใช้งาน'),'gateway replies through LINE Messaging API boundary');
 $rejected=false;try{$gateway->handleWebhook('invalid',$commandBody,static fn()=>['replyText'=>'x'],'2026-09-26T13:06:00Z');}catch(HubLineOaGatewayException $e){$rejected=$e->codeName==='LINE_SIGNATURE_INVALID';}
 m24_assert($rejected,'invalid LINE signature fails closed');
 m24_assert($pdo->query('PRAGMA foreign_key_check')->fetchAll()===[],'M24 foreign keys remain clean');
 echo "AWH M24 LINE OA Gateway: PASS\n";
} finally {
 putenv('AWH_PROVIDER_CREDENTIAL_ROOT');
 if(is_dir($root)){foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST) as $f){$p=$f->getPathname();$f->isDir()&&!$f->isLink()?@rmdir($p):@unlink($p);}@rmdir($root);}
}
