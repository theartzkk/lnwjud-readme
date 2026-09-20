<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/src/HubCapabilityRegistryService.php';
function ep(bool $ok,string $m):void{if(!$ok)throw new RuntimeException($m);}
$p=HubCapabilityRegistryService::executionPolicy();
ep(($p['version']??null)==='2.0-context','context version');
ep(($p['mode']??null)==='CONTEXT_ONLY'&&($p['enforcement']??null)==='ADVISORY','context is non-prescriptive');
ep(($p['prescriptiveRouting']??true)===false&&($p['mandatoryToolOrder']??true)===false&&($p['quotaBudgetingRequired']??true)===false&&($p['remoteMissionRequired']??true)===false,'old execution rituals are disabled');
ep(($p['sourceAuthorityRequiredForMutation']??false)===true&&($p['singleWriterMutationBoundary']??false)===true&&($p['candidateWorkspaceIsolation']??false)===true,'real integrity boundaries remain');
ep(($p['ownerApprovalForCanonicalPromotion']??false)===true&&($p['actualOutcomeVerification']??false)===true,'promotion and outcome evidence boundaries remain');
ep(!isset($p['policyFamilies'])&&!isset($p['planBeforeCall'])&&!isset($p['quotaAware']),'retired owner-model fields are absent');
$ay=HubCapabilityRegistryService::workProfileForGoal('AY3 เด็กกดเริ่มภารกิจไม่ได้');
ep(($ay['primaryRoute']??null)==='REMOTE_DEVICE'&&($ay['requiresRealDeviceEvidence']??false)===true,'work profile remains advisory evidence');
$nginx=HubCapabilityRegistryService::workProfileForGoal('nginx บน VPS มีปัญหา');
ep(($nginx['primaryRoute']??null)==='VPS_DIRECT','server evidence profile remains available');
$ctl=file_get_contents(dirname(__DIR__).'/src/HubControlPlaneService.php');
ep(str_contains((string)$ctl,'AWH CENTRAL ENGINEERING TASK — CURRENT CONTEXT'),'worker receives current context');
ep(!str_contains((string)$ctl,'KRUART OWNER OPERATING MODEL'),'worker no longer receives mandatory owner model');
ep(str_contains((string)$ctl,"'executionPolicy' => HubCapabilityRegistryService::executionPolicy()"),'chat exposes context metadata');
echo "AWH Execution Context: PASS
";
