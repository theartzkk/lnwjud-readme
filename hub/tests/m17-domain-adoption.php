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
$result=$method->invoke($op,'learn.kruart.online','2026-09-06T16:30:00Z');a($result===true,'redirect alias adopted');
$after=file_get_contents($alias);a(is_string($after)&&!str_contains($after,'learn.kruart.online')&&str_contains($after,'unknown'),'only exact legacy block removed');
$backups=glob($config.'/legacy-route-backups/*.conf')?:[];a(count($backups)===1&&file_get_contents($backups[0])===$legacy,'legacy backup retained');
a(in_array('/usr/sbin/nginx -t',$calls,true)&&in_array('/bin/systemctl reload nginx',$calls,true),'nginx validation and reload executed');
$unsafe="server {\n listen 80;\n server_name learn.kruart.online;\n location / { proxy_pass http://127.0.0.1:9999; }\n}\n";file_put_contents($alias,$unsafe);$blocked=false;
try{$method->invoke($op,'learn.kruart.online','2026-09-06T16:31:00Z');}catch(Throwable $e){$blocked=$e instanceof HubManagedHostingOperatorException&&$e->codeName==='DOMAIN_ROUTE_CONFLICT';}
a($blocked&&file_get_contents($alias)===$unsafe,'complex legacy route fails closed');
echo "AWH M17 Domain Adoption: PASS\n";
