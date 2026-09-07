<?php
declare(strict_types=1);
require_once __DIR__.'/../src/HubManagedHostingOperator.php';
function a(bool $ok,string $m): void { if(!$ok){fwrite(STDERR,"FAIL $m\n");exit(1);} }
$root=sys_get_temp_dir().'/awh-domain-adopt-'.bin2hex(random_bytes(5));
$available=$root.'/available';$enabled=$root.'/enabled';$sites=$root.'/sites';$config=$root.'/config';
foreach([$available,$enabled,$sites,$config] as $dir) mkdir($dir,0700,true);
$alias=$available.'/kruart-domain-aliases.conf';
$legacy="server {\n    listen 80;\n    server_name learn.kruart.online;\n    return 302 https://legacy.example/learn;\n}\n\nserver {\n    listen 80;\n    server_name ~^(?<unknown>[a-z0-9-]+)\\.kruart\\.online$;\n    return 404;\n}\n";
file_put_contents($alias,$legacy);symlink($alias,$enabled.'/kruart-domain-aliases.conf');
$pdo=new PDO('sqlite::memory:');$vault=(new ReflectionClass(HubProjectVault::class))->newInstanceWithoutConstructor();$calls=[];
$runner=function(array $cmd,?string $stdin=null) use (&$calls): array {$calls[]=implode(' ',$cmd);return ['code'=>0,'out'=>'','err'=>''];};
$op=new HubManagedHostingOperator($pdo,$vault,$sites,$available,$enabled,$config,$runner);
$method=(new ReflectionClass($op))->getMethod('adoptLegacyAlias');$method->setAccessible(true);
$result=$method->invoke($op,'learn.kruart.online','2026-09-06T16:30:00Z');a(is_array($result)&&isset($result['target'],$result['original'],$result['backup']),'redirect alias adopted with rollback evidence');
$after=file_get_contents($alias);a(is_string($after)&&!str_contains($after,'learn.kruart.online')&&str_contains($after,'unknown'),'only exact legacy block removed');
$backups=glob($config.'/legacy-route-backups/*.conf')?:[];a(count($backups)===1&&file_get_contents($backups[0])===$legacy,'legacy backup retained');
a(in_array('/usr/sbin/nginx -t',$calls,true)&&in_array('/bin/systemctl reload nginx',$calls,true),'nginx validation and reload executed');
$restore=(new ReflectionClass($op))->getMethod('restoreLegacyAlias');$restore->setAccessible(true);$restore->invoke($op,$result);a(file_get_contents($alias)===$legacy,'legacy route restored when later activation needs compensation');
$result2=$method->invoke($op,'learn.kruart.online','2026-09-06T16:30:30Z');a(is_array($result2),'legacy route can be adopted again after compensation');
$unsafe="server {\n listen 80;\n server_name learn.kruart.online;\n location / { proxy_pass http://127.0.0.1:9999; }\n}\n";file_put_contents($alias,$unsafe);$blocked=false;
try{$method->invoke($op,'learn.kruart.online','2026-09-06T16:31:00Z');}catch(Throwable $e){$blocked=$e instanceof HubManagedHostingOperatorException&&$e->codeName==='DOMAIN_ROUTE_CONFLICT';}
a($blocked&&file_get_contents($alias)===$unsafe,'complex legacy route fails closed');
$healthRunner=function(array $cmd,?string $stdin=null): array { $url=(string)end($cmd); return ['code'=>0,'out'=>str_contains($url,'/bad')?'404':'204','err'=>'']; };
$healthOp=new HubManagedHostingOperator($pdo,$vault,$sites,$available,$enabled,$config,$healthRunner);$health=(new ReflectionClass($healthOp))->getMethod('domainHealth');$health->setAccessible(true);
a($health->invoke($healthOp,'learn.kruart.online','/')==='204','domain health accepts 2xx');$healthBlocked=false;
try{$health->invoke($healthOp,'learn.kruart.online','/bad');}catch(Throwable $e){$healthBlocked=$e instanceof HubManagedHostingOperatorException&&$e->codeName==='HOSTING_HEALTH_FAILED';}
a($healthBlocked,'domain health rejects 4xx');
$tlsPdo=new PDO('sqlite::memory:');
$tlsPdo->exec("CREATE TABLE control_executor_capabilities(executor_id TEXT NOT NULL,executor_kind TEXT NOT NULL,capability TEXT NOT NULL,version TEXT NOT NULL,observed_at TEXT NOT NULL,expires_at TEXT NOT NULL,PRIMARY KEY(executor_id,capability))");
$timerReadyRunner=function(array $cmd,?string $stdin=null): array {
    if($cmd===['/bin/systemctl','is-enabled','certbot.timer'])return ['code'=>0,'out'=>"enabled\n",'err'=>''];
    if($cmd===['/bin/systemctl','is-active','certbot.timer'])return ['code'=>0,'out'=>"active\n",'err'=>''];
    return ['code'=>0,'out'=>'','err'=>''];
};
$tlsOp=new HubManagedHostingOperator($tlsPdo,$vault,$sites,$available,$enabled,$config,$timerReadyRunner);$advertise=(new ReflectionClass($tlsOp))->getMethod('advertise');$advertise->setAccessible(true);$advertise->invoke($tlsOp,'2026-09-07T05:30:00Z');
$tlsRow=$tlsPdo->query("SELECT version FROM control_executor_capabilities WHERE executor_id='vps-hosting' AND capability='hosting.tls.renewal'")->fetchColumn();a($tlsRow==='certbot-timer','renewal capability is advertised only from healthy certbot timer evidence');
$timerDownRunner=function(array $cmd,?string $stdin=null): array {
    if($cmd===['/bin/systemctl','is-enabled','certbot.timer'])return ['code'=>0,'out'=>"enabled\n",'err'=>''];
    if($cmd===['/bin/systemctl','is-active','certbot.timer'])return ['code'=>3,'out'=>"inactive\n",'err'=>''];
    return ['code'=>0,'out'=>'','err'=>''];
};
$tlsDownOp=new HubManagedHostingOperator($tlsPdo,$vault,$sites,$available,$enabled,$config,$timerDownRunner);$advertiseDown=(new ReflectionClass($tlsDownOp))->getMethod('advertise');$advertiseDown->setAccessible(true);$advertiseDown->invoke($tlsDownOp,'2026-09-07T05:31:00Z');
$tlsCount=(int)$tlsPdo->query("SELECT COUNT(*) FROM control_executor_capabilities WHERE executor_id='vps-hosting' AND capability='hosting.tls.renewal'")->fetchColumn();a($tlsCount===0,'renewal capability is withdrawn immediately when certbot timer is not active');
echo "AWH M17 Domain Adoption: PASS\n";
