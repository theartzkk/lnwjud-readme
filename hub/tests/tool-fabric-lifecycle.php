<?php
declare(strict_types=1);

require_once dirname(__DIR__).'/src/HubToolFabricService.php';

function tf_assert(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);}
function tf_expect(string $code,callable $fn,string $message):void{try{$fn();}catch(HubToolFabricException $e){tf_assert($e->codeName===$code,$message.' wrong '.$e->codeName);return;}throw new RuntimeException($message.' did not fail');}

$pdo=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$pdo->exec('PRAGMA foreign_keys=OFF');
$sql=file_get_contents(dirname(__DIR__).'/migrations/012_anywhere_execution_fabric.sql');
if(!is_string($sql))throw new RuntimeException('fixture migration missing');
$pdo->exec($sql);
$root=dirname(__DIR__,2);
$newHead=str_repeat('f',40);
$service=new HubToolFabricService($pdo,$root,static fn(string $repo):?string=>$repo==='github/github-mcp-server'?$newHead:str_repeat('e',40));

$sync=$service->syncCatalog('2026-09-28T00:00:00+00:00');
tf_assert(($sync['state']??null)==='SYNCED'&&(int)($sync['count']??0)>=24,'catalog sync');
$snapshot=$service->snapshot('2026-09-28T00:00:00+00:00');
$tools=[];foreach($snapshot['items'] as $item)$tools[$item['capability']]=$item;
tf_assert(($tools['code.repo']['lifecycleState']??null)==='APPROVED','semantic starts approved');
$pinned=(string)$tools['code.repo']['pinnedRevision'];

$preview=$service->transition('code.repo','PROMOTE_PREVIEW','2026-09-28T00:01:00+00:00');
tf_assert(($preview['tool']['lifecycleState']??null)==='PREVIEW','preview transition');
tf_expect('TOOL_FABRIC_QA_REQUIRED',fn()=>$service->transition('code.repo','PROMOTE_STABLE','2026-09-28T00:02:00+00:00'),'stable must fail closed without qa');
$service->recordQaEvidence('code.repo',$pinned,['license'=>'PASS','integrity'=>'PASS','smoke'=>'PASS','capabilityContract'=>'PASS','regression'=>'PASS','mcpQa'=>'PASS','rollback'=>'READY'],'2026-09-28T00:03:00+00:00');
$stable=$service->transition('code.repo','PROMOTE_STABLE','2026-09-28T00:04:00+00:00');
tf_assert(($stable['tool']['stableRevision']??null)===$pinned&&($stable['tool']['lifecycleState']??null)==='STABLE','first stable');

$pdo->exec("UPDATE control_capability_sources SET observed_at='1970-01-01T00:00:00+00:00' WHERE source_id='tool.github-mcp'");
$pdo->exec("UPDATE control_capability_sources SET observed_at='2026-09-28T12:00:00+00:00' WHERE source_id<>'tool.github-mcp'");
$discover=$service->discoverDue('2026-09-29T00:05:00+00:00',2);
tf_assert(($discover['mutatedRuntime']??true)===false&&($discover['checked']??0)===1,'metadata-only discovery');
$afterDiscover=$service->snapshot('2026-09-29T00:05:01+00:00');$semantic=null;foreach($afterDiscover['items'] as $item)if($item['capability']==='code.repo')$semantic=$item;
tf_assert(is_array($semantic)&&$semantic['lifecycleState']==='STABLE'&&$semantic['intakeState']==='DISCOVERED'&&$semantic['stableRevision']===$pinned&&$semantic['updateAvailable']===true&&$semantic['upstreamRevision']===$newHead,'discovery creates intake metadata without mutating stable runtime');

$service->transition('code.repo','REVIEW','2026-09-29T00:05:30+00:00');
$service->transition('code.repo','APPROVE','2026-09-29T00:05:45+00:00');
tf_expect('TOOL_FABRIC_PROVISION_PIN_REQUIRED',fn()=>$service->transition('code.repo','PROMOTE_PREVIEW','2026-09-29T00:06:00+00:00'),'changed upstream cannot reuse stale provision pin');

$fixtureRoot=sys_get_temp_dir().'/awh-tool-fabric-'.bin2hex(random_bytes(4));
mkdir($fixtureRoot.'/config',0700,true);
$fixture=json_decode((string)file_get_contents($root.'/config/external-capabilities.json'),true,64,JSON_THROW_ON_ERROR);
foreach($fixture['entries'] as &$entry)if(($entry['id']??null)==='github-mcp'){$entry['revision']=$newHead;$entry['provision']['revision']=$newHead;}unset($entry);
file_put_contents($fixtureRoot.'/config/external-capabilities.json',json_encode($fixture,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)."
");
$updatedService=new HubToolFabricService($pdo,$fixtureRoot,static fn(string $repo):?string=>$repo==='github/github-mcp-server'?$newHead:str_repeat('e',40));
$updatedService->transition('code.repo','PROMOTE_PREVIEW','2026-09-29T00:06:30+00:00');
$updatedService->recordQaEvidence('code.repo',$newHead,['license'=>'PASS','integrity'=>'PASS','smoke'=>'PASS','capabilityContract'=>'PASS','regression'=>'PASS','mcpQa'=>'PASS','rollback'=>'READY'],'2026-09-29T00:07:00+00:00');
$next=$updatedService->transition('code.repo','PROMOTE_STABLE','2026-09-29T00:08:00+00:00');
tf_assert(($next['tool']['stableRevision']??null)===$newHead&&($next['tool']['rollbackRevision']??null)===$pinned,'stable retains previous verified');
$rollback=$updatedService->transition('code.repo','ROLLBACK','2026-09-29T00:09:00+00:00');
tf_assert(($rollback['tool']['stableRevision']??null)===$pinned&&($rollback['tool']['rollbackRevision']??null)===$newHead,'rollback swaps verified revisions');
unlink($fixtureRoot.'/config/external-capabilities.json');rmdir($fixtureRoot.'/config');rmdir($fixtureRoot);

$rejectFixture=new HubToolFabricService($pdo,$root,static fn(string $repo):?string=>$repo==='github/github-mcp-server'?str_repeat('d',40):str_repeat('e',40));
$pdo->exec("UPDATE control_capability_sources SET observed_at='1970-01-01T00:00:00+00:00' WHERE source_id='tool.github-mcp'");
$rejectFixture->discoverDue('2026-09-30T00:10:00+00:00',1);
$rejectFixture->transition('code.repo','REVIEW','2026-09-30T00:11:00+00:00');
$rejected=$rejectFixture->transition('code.repo','REJECT','2026-09-30T00:12:00+00:00');
tf_assert(($rejected['tool']['lifecycleState']??null)==='STABLE'&&($rejected['tool']['intakeState']??null)==='REJECTED'&&($rejected['tool']['stableRevision']??null)===$pinned&&($rejected['tool']['disabled']??true)===false,'rejecting an update keeps verified Stable active');

tf_expect('TOOL_FABRIC_PROVISION_PIN_REQUIRED',fn()=>$service->transition('code.semantic','PROMOTE_PREVIEW','2026-09-30T00:20:00+00:00'),'unprovisioned executable adapter must not enter Preview');

echo "TOOL_FABRIC_HUB_TEST=PASS\n";
