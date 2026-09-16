<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/src/HubCapabilityRegistryService.php';
function ep(bool $ok,string $m):void{if(!$ok)throw new RuntimeException($m);}
$p=HubCapabilityRegistryService::executionPolicy();
ep(($p['version']??null)==='1.2.0','version');
ep(($p['userRestatementRequired']??true)===false,'inheritance');
ep(($p['oneSetupManyUsefulActions']??false)===true && ($p['batchFirst']??false)===true,'call efficiency');
ep(($p['remoteDesktopClass']??null)==='EXPENSIVE_JUSTIFIED_ROUTE','remote semantics');
ep(($p['unrestrictedWorkerShell']??true)===false,'worker shell boundary');
$src=file_get_contents(dirname(__DIR__).'/src/HubCapabilityRegistryService.php');
ep(!str_contains((string)$src,"system.shell';"),'generic shell mapping removed');
$ctl=file_get_contents(dirname(__DIR__).'/src/HubControlPlaneService.php');
ep(str_contains((string)$ctl,"'executionPolicy' => HubCapabilityRegistryService::executionPolicy()"),'chat bootstrap');
echo "AWH Execution Resource Policy 1.2: PASS\n";
