<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/src/HubCapabilityRegistryService.php';
function ep(bool $ok,string $m):void{if(!$ok)throw new RuntimeException($m);}
$p=HubCapabilityRegistryService::executionPolicy();
ep(($p['version']??null)==='1.3.0','version');
ep(($p['userRestatementRequired']??true)===false,'inheritance');
ep(($p['operatingModel']??null)==='KRUART_OWNER_OPERATING_MODEL' && ($p['operatingModelVersion']??null)==='2.0','owner operating model identity');
ep(is_array($p['policyFamilies']??null) && count($p['policyFamilies'])===11,'owner operating model policy families');
ep(($p['outcomeFirst']??false)===true && ($p['continuityRequired']??false)===true && ($p['sourceOfTruthFirst']??false)===true && ($p['toolFitRouting']??false)===true,'core operating model');
ep(($p['oneCoherentPass']??false)===true && ($p['realEvidenceRequired']??false)===true && ($p['realQaRequired']??false)===true,'closure operating model');
ep(($p['cleanEnvironmentLifecycle']??false)===true && ($p['maximumAutomationMinimumUserTouch']??false)===true,'lifecycle operating model');
ep(($p['oneSetupManyUsefulActions']??false)===true && ($p['batchFirst']??false)===true,'call efficiency');
ep(($p['remoteDesktopClass']??null)==='ALLOWED_HIGH_VALUE_ROUTE','remote semantics');
ep(($p['explicitRemoteIntentAllowed']??false)===true && ($p['headlessExhaustionRequiredBeforeRemote']??true)===false,'explicit remote remains available');
ep(($p['remoteMissionRequired']??false)===true && ($p['remotePrepareBeforeCall']??false)===true && ($p['remoteBatchRelatedActions']??false)===true && ($p['remoteReuseSession']??false)===true,'remote mission efficiency');
ep(($p['remoteVerifyRealOutput']??false)===true && ($p['remoteRecordDelta']??false)===true && ($p['cleanExit']??false)===true,'remote closure');
ep(($p['remoteTransitHopAllowed']??true)===false,'no device transit hop');
ep(($p['quotaAware']??false)===true && ($p['quotaStateMustBeObserved']??false)===true && ($p['quotaAdaptiveMode']??false)===true,'quota evidence policy');
ep(($p['remotePreferredOnNamedDevice']??false)===true && ($p['remotePreferredOnGuiState']??false)===true && ($p['remotePreferredOnNativeDesktopApp']??false)===true,'remote preferred triggers');
ep(($p['remotePreferredOnInstallPermissionState']??false)===true && ($p['remotePreferredOnRealClientState']??false)===true && ($p['remotePreferredOnFieldQa']??false)===true,'device evidence triggers');
ep(($p['deviceReferenceImpliesRemoteIntent']??false)===true && ($p['mixedBoundaryUsesDirectPlusRemote']??false)===true,'implicit device intent and mixed boundary');
ep(($p['permanentFixDefault']??false)===true && ($p['rootCauseRequired']??false)===true && ($p['adjacentBlockerAudit']??false)===true && ($p['regressionRequired']??false)===true,'permanent fix policy');
ep(($p['temporaryWorkaroundMustBeTracked']??false)===true,'temporary workaround tracking');
ep(($p['schoolVisualTruthRequired']??false)===true && ($p['schoolRealMediaFirst']??false)===true,'school visual truth');
ep(($p['generatedSchoolRealityAllowed']??true)===false && ($p['foreignSchoolSubstitutionAllowed']??true)===false,'no fabricated school reality');
ep(($p['unrestrictedWorkerShell']??true)===false,'worker shell boundary');
$src=file_get_contents(dirname(__DIR__).'/src/HubCapabilityRegistryService.php');
ep(!str_contains((string)$src,"system.shell';"),'generic shell mapping removed');
$ctl=file_get_contents(dirname(__DIR__).'/src/HubControlPlaneService.php');

ep(str_contains((string)$ctl,'KRUART OWNER OPERATING MODEL'),'worker owner model injection');
ep(str_contains((string)$ctl,'strlen($protocol) > 7800'),'worker owner model packet bound');
ep(str_contains((string)$ctl,"'executionPolicy' => HubCapabilityRegistryService::executionPolicy()"),'chat bootstrap');
echo "AWH Execution Resource Policy 1.3: PASS\n";
