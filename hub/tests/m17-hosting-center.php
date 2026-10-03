<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubManagedHostingService.php';

function hc(bool $ok,string $message): void { if(!$ok) throw new RuntimeException($message); }

$root=sys_get_temp_dir().'/awh-hosting-center-'.bin2hex(random_bytes(5));
mkdir($root,0700,true);
$path=$root.'/telemetry.json';
$now=gmdate('c');
$fixture=[
    'schemaVersion'=>1,'generatedAt'=>$now,
    'host'=>['name'=>'fixture','os'=>'Linux','uptimeSeconds'=>10],
    'cpu'=>['usedPercent'=>2.0,'load1'=>0.1,'load5'=>0.1,'load15'=>0.1],
    'memory'=>['totalBytes'=>1000,'usedBytes'=>200,'freeBytes'=>800,'availableBytes'=>800,'usedPercent'=>20.0],
    'swap'=>['totalBytes'=>0,'usedBytes'=>0,'freeBytes'=>0,'availableBytes'=>0,'usedPercent'=>0.0],
    'storage'=>['totalBytes'=>1000,'usedBytes'=>400,'freeBytes'=>600,'availableBytes'=>600,'usedPercent'=>40.0],
    'services'=>[],
    'domains'=>[
        ['name'=>'school.kruart.online','tls'=>true,'certificateExpiresAt'=>'2026-12-01T00:00:00Z','certificateDaysRemaining'=>58],
        ['name'=>'legacy.kruart.online','tls'=>true,'certificateExpiresAt'=>null,'certificateDaysRemaining'=>null],
        ['name'=>'www.kruart.online','tls'=>true,'certificateExpiresAt'=>null,'certificateDaysRemaining'=>null],
    ],
    'sites'=>[
        ['inventoryId'=>'nginx-11111111111111111111','primaryHost'=>'school.kruart.online','hosts'=>['school.kruart.online'],'tls'=>true,'routeType'=>'STATIC','upstreamPort'=>null,'redirectHost'=>null,'rootClass'=>'WEB_ROOT','configName'=>'school.conf'],
        ['inventoryId'=>'nginx-22222222222222222222','primaryHost'=>'legacy.kruart.online','hosts'=>['legacy.kruart.online'],'tls'=>true,'routeType'=>'PROXY','upstreamPort'=>9001,'redirectHost'=>null,'rootClass'=>null,'configName'=>'legacy.conf'],
        ['inventoryId'=>'nginx-33333333333333333333','primaryHost'=>'www.kruart.online','hosts'=>['www.kruart.online'],'tls'=>true,'routeType'=>'REDIRECT','upstreamPort'=>null,'redirectHost'=>'kruart.online','rootClass'=>null,'configName'=>'aliases.conf'],
    ],
    'security'=>['fail2ban'=>'ACTIVE','automaticUpdates'=>'ACTIVE'],
];
file_put_contents($path,json_encode($fixture,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR));
$telemetry=(new HubInfrastructureService($path))->status($now);
hc(($telemetry['state']??null)==='READY','telemetry ready');
hc(count($telemetry['server']['sites']??[])===3,'sanitized site inventory');

$reflection=new ReflectionClass(HubManagedHostingService::class);
$service=$reflection->newInstanceWithoutConstructor();
$method=$reflection->getMethod('hostingInventory');
$method->setAccessible(true);
$managed=[[
    'siteId'=>'11111111-1111-4111-8111-111111111111','projectId'=>'22222222-2222-4222-8222-222222222222',
    'projectName'=>'School Website','name'=>'เว็บไซต์โรงเรียน','slug'=>'school','environment'=>'PRODUCTION',
    'state'=>'READY','runtimeType'=>'STATIC','domainHost'=>'school.kruart.online','primaryHost'=>'school.kruart.online',
    'port'=>null,'url'=>'https://school.kruart.online/','source'=>['ready'=>true],'backupEnabled'=>true,
    'currentReleaseId'=>'release-school','rollbackReleaseId'=>null,'lastEvent'=>null,
]];
$result=$method->invoke($service,$managed,$telemetry,'kruart.online');
hc(($result['meta']['managedCount']??null)===1,'managed count');
hc(($result['meta']['discoveredCount']??null)===1,'discovered count');
hc(($result['meta']['aliasCount']??null)===1,'alias count');
hc(($result['meta']['domainCount']??null)===3,'domain count');
hc(($result['meta']['storageUsedPercent']??null)===40.0,'storage percent is summarized');
hc(($result['meta']['storageAvailableBytes']??null)===600,'storage availability is summarized');
$byHost=[]; foreach($result['sites'] as $row)$byHost[$row['primaryHost']]=$row;
hc(($byHost['school.kruart.online']['ownership']??null)==='MANAGED','managed reconciliation');
hc(($byHost['legacy.kruart.online']['ownership']??null)==='DISCOVERED','legacy remains read only');
hc(($byHost['legacy.kruart.online']['upstreamPort']??null)===9001,'safe upstream port detail');
hc(($byHost['www.kruart.online']['ownership']??null)==='ALIAS','redirect classified as alias');
hc(($result['meta']['readOnlyDiscovery']??null)===true,'discovery must be read only');
$encoded=json_encode($result,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
hc(!str_contains($encoded,'/var/www/')&&!str_contains($encoded,'/etc/nginx/'),'raw server paths are not exposed');

@unlink($path); @rmdir($root);
echo "AWH Hosting Center Inventory: PASS\n";
