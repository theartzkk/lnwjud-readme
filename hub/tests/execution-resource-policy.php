<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/src/HubCapabilityRegistryService.php';
function ep(bool $ok,string $m):void{if(!$ok)throw new RuntimeException($m);}
$p=HubCapabilityRegistryService::executionPolicy();
ep(($p['version']??null)==='1.3.0','version');
ep(($p['userRestatementRequired']??true)===false,'inheritance');
ep(($p['oneSetupManyUsefulActions']??false)===true && ($p['batchFirst']??false)===true,'call efficiency');
ep(($p['remoteDesktopClass']??null)==='ALLOWED_HIGH_VALUE_ROUTE','remote semantics');
ep(($p['explicitRemoteIntentAllowed']??false)===true && ($p['headlessExhaustionRequiredBeforeRemote']??true)===false,'explicit remote remains available');
ep(($p['remoteMissionRequired']??false)===true && ($p['remotePrepareBeforeCall']??false)===true && ($p['remoteBatchRelatedActions']??false)===true && ($p['remoteReuseSession']??false)===true,'remote mission efficiency');
ep(($p['remoteVerifyRealOutput']??false)===true && ($p['remoteRecordDelta']??false)===true && ($p['cleanExit']??false)===true,'remote closure');
ep(($p['remoteTransitHopAllowed']??true)===false,'no device transit hop');
ep(($p['quotaAware']??false)===true && ($p['quotaStateMustBeObserved']??false)===true && ($p['quotaAdaptiveMode']??false)===true,'quota evidence policy');
ep(($p['permanentFixDefault']??false)===true && ($p['rootCauseRequired']??false)===true && ($p['adjacentBlockerAudit']??false)===true && ($p['regressionRequired']??false)===true,'permanent fix policy');
ep(($p['temporaryWorkaroundMustBeTracked']??false)===true,'temporary workaround tracking');
ep(($p['schoolVisualTruthRequired']??false)===true && ($p['schoolRealMediaFirst']??false)===true,'school visual truth');
ep(($p['generatedSchoolRealityAllowed']??true)===false && ($p['foreignSchoolSubstitutionAllowed']??true)===false,'no fabricated school reality');
ep(($p['unrestrictedWorkerShell']??true)===false,'worker shell boundary');
$src=file_get_contents(dirname(__DIR__).'/src/HubCapabilityRegistryService.php');
ep(!str_contains((string)$src,"system.shell';"),'generic shell mapping removed');
$ctl=file_get_contents(dirname(__DIR__).'/src/HubControlPlaneService.php');
ep(str_contains((string)$ctl,"'executionPolicy' => HubCapabilityRegistryService::executionPolicy()"),'chat bootstrap');
echo "AWH Execution Resource Policy 1.3: PASS\n";
