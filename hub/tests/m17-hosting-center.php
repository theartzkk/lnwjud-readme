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
        ['inventoryId'=>'nginx-33333333333333333333','primaryHost'=>'www.kruart.online','hosts'=>['www.kruart.online'],'tls'=>true,'routeType'=>'REDIRECT','upstreamPort'=>null,'redirectHost'=>'school.kruart.online','rootClass'=>null,'configName'=>'aliases.conf'],
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
    'currentReleaseId'=>'release-school','rollbackReleaseId'=>null,'lastEvent'=>null,'secretsState'=>'READY','secretsConfigured'=>true,
]];
$result=$method->invoke($service,$managed,$telemetry,'kruart.online');
hc(($result['meta']['managedCount']??null)===1,'managed count');
hc(($result['meta']['discoveredCount']??null)===1,'discovered count');
hc(($result['meta']['aliasCount']??null)===1,'alias count');
hc(($result['meta']['domainCount']??null)===3,'domain count');
hc(($result['meta']['storageUsedPercent']??null)===40.0,'storage percent is summarized');
hc(($result['meta']['storageAvailableBytes']??null)===600,'storage availability is summarized');
hc(($result['meta']['managedPortUsed']??null)===0,'managed port usage is summarized');
hc(($result['meta']['managedPortTotal']??null)===600,'managed port capacity is bounded');
hc(($result['meta']['managedPortRemaining']??null)===600,'managed port remaining capacity is summarized');
hc(($result['meta']['unroutedManagedCount']??null)===0,'managed route attention is summarized');
hc(($result['meta']['tlsAttentionCount']??null)===0,'tls attention is summarized');
$byHost=[]; foreach($result['sites'] as $row)$byHost[$row['primaryHost']]=$row;
hc(($byHost['school.kruart.online']['ownership']??null)==='MANAGED','managed reconciliation');
hc(($byHost['school.kruart.online']['secretsState']??null)==='READY'&&($byHost['school.kruart.online']['secretsConfigured']??null)===true,'secret configuration is summarized without values');
hc(($byHost['legacy.kruart.online']['ownership']??null)==='DISCOVERED','legacy remains read only');
hc(($byHost['legacy.kruart.online']['upstreamPort']??null)===9001,'safe upstream port detail');
hc(($byHost['www.kruart.online']['ownership']??null)==='ALIAS','redirect classified as alias');
hc(($result['meta']['readOnlyDiscovery']??null)===true,'discovery must be read only');

$adoptions=['legacy.kruart.online'=>['hostname'=>'legacy.kruart.online','projectId'=>'33333333-3333-4333-8333-333333333333','projectName'=>'Legacy App','mode'=>'OBSERVE_ONLY','executionId'=>'44444444-4444-4444-8444-444444444444','adoptedAt'=>$now]];
$adopted=$method->invoke($service,$managed,$telemetry,'kruart.online',$adoptions);
hc(($adopted['meta']['adoptedCount']??null)===1,'adopted count');
hc(($adopted['meta']['discoveredCount']??null)===0,'adopted host no longer counted as unmanaged discovery');
$adoptedByHost=[];foreach($adopted['sites'] as $row)$adoptedByHost[$row['primaryHost']]=$row;
hc(($adoptedByHost['legacy.kruart.online']['ownership']??null)==='ADOPTED','legacy host becomes observe-only adopted');
hc(($adoptedByHost['legacy.kruart.online']['projectName']??null)==='Legacy App','adoption projects are projected without route mutation');
hc(($adoptedByHost['legacy.kruart.online']['managementState']??null)==='OBSERVE_ONLY','adoption stays observe only');

$managedRedirect=[[
    'siteId'=>'55555555-5555-4555-8555-555555555555','projectId'=>'66666666-6666-4666-8666-666666666666',
    'projectName'=>'Legacy Managed','name'=>'Legacy Managed','slug'=>'www','environment'=>'PRODUCTION','state'=>'FAILED','runtimeType'=>'AUTO',
    'domainHost'=>'www.kruart.online','primaryHost'=>'www.kruart.online','port'=>null,'url'=>null,'source'=>['ready'=>false],'backupEnabled'=>true,
    'currentReleaseId'=>null,'rollbackReleaseId'=>null,'lastEvent'=>null,'recentEvents'=>[],
]];
$reconciled=$method->invoke($service,$managedRedirect,$telemetry,'kruart.online');
$managedByHost=[];foreach($reconciled['sites'] as $row)$managedByHost[$row['primaryHost']]=$row;
hc(($managedByHost['www.kruart.online']['managementState']??null)==='FAILED','management failure remains visible');
hc(($managedByHost['www.kruart.online']['liveState']??null)==='ONLINE','live redirect target keeps website online');
hc(($managedByHost['www.kruart.online']['liveHost']??null)==='school.kruart.online','live target is reconciled independently from managed record');

$staging=[[
    'siteId'=>'99999999-9999-4999-8999-999999999999','projectId'=>'12121212-1212-4212-8212-121212121212',
    'projectName'=>'Portal','name'=>'Portal Staging','slug'=>'portal','environment'=>'STAGING','state'=>'QUEUED','runtimeType'=>'STATIC',
    'domainHost'=>null,'primaryHost'=>null,'port'=>null,'url'=>null,'source'=>['ready'=>false],'backupEnabled'=>true,
    'currentReleaseId'=>null,'rollbackReleaseId'=>null,'lastEvent'=>null,'recentEvents'=>[],
]];
$stagingInventory=$method->invoke($service,$staging,$telemetry,'kruart.online');
hc(($stagingInventory['sites'][0]['primaryHost']??null)==='portal-staging.kruart.online','staging default hostname is isolated from production');
hc(($stagingInventory['sites'][0]['environment']??null)==='STAGING','staging environment is preserved');

$encoded=json_encode($adopted,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
hc(!str_contains($encoded,'/var/www/')&&!str_contains($encoded,'/etc/nginx/'),'raw server paths are not exposed');

$db=$root.'/adoption.sqlite';$pdo=new PDO('sqlite:'.$db,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE projects(project_id TEXT PRIMARY KEY,name TEXT NOT NULL)');
$pdo->exec('CREATE TABLE control_tasks(task_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,state TEXT NOT NULL)');
$pdo->exec('CREATE TABLE control_task_executions(execution_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,project_id TEXT NOT NULL,required_capability TEXT NOT NULL,state TEXT NOT NULL,checkpoint_json TEXT NOT NULL,updated_at TEXT NOT NULL)');
$owner='77777777-7777-4777-8777-777777777777';$project='88888888-8888-4888-8888-888888888888';$host='legacy.kruart.online';
$pdo->prepare('INSERT INTO projects VALUES(:id,:name)')->execute(['id'=>$project,'name'=>'Legacy App']);
$record=function(string $task,string $execution,string $action,string $at)use($pdo,$owner,$project,$host):void{
    $pdo->prepare("INSERT INTO control_tasks VALUES(:task,:owner,'COMPLETED')")->execute(['task'=>$task,'owner'=>$owner]);
    $cp=['schemaVersion'=>1,'mode'=>'HOSTING_OBSERVE_ADOPTION','action'=>$action,'hostname'=>$host,'projectId'=>$project,'observationOnly'=>true];
    $pdo->prepare("INSERT INTO control_task_executions VALUES(:execution,:task,:project,'hosting.site.observe_adopt','COMPLETED',:checkpoint,:at)")->execute(['execution'=>$execution,'task'=>$task,'project'=>$project,'checkpoint'=>json_encode($cp,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'at'=>$at]);
};
$record('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ADOPT','2026-10-03T10:00:00+00:00');
$record('cccccccc-cccc-4ccc-8ccc-cccccccccccc','dddddddd-dddd-4ddd-8ddd-dddddddddddd','RELEASE','2026-10-03T10:05:00+00:00');
$pdoProp=$reflection->getProperty('pdo');$pdoProp->setAccessible(true);$pdoProp->setValue($service,$pdo);
$adoptionState=$reflection->getMethod('adoptionState');$adoptionState->setAccessible(true);
hc($adoptionState->invoke($service,$owner)===[],'latest RELEASE clears observe-only adoption');
$record('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','ADOPT','2026-10-03T10:10:00+00:00');
$activeAdoption=$adoptionState->invoke($service,$owner);
hc(($activeAdoption[$host]['projectId']??null)===$project,'latest ADOPT restores observe-only adoption');
hc(($activeAdoption[$host]['mode']??null)==='OBSERVE_ONLY','adoption registry never implies managed authority');

@unlink($path);@unlink($db); @rmdir($root);
echo "AWH Hosting Center Inventory: PASS\n";
