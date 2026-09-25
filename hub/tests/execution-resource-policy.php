<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/src/HubCapabilityRegistryService.php';
function ep(bool $ok,string $m):void{if(!$ok)throw new RuntimeException($m);}
$p=HubCapabilityRegistryService::executionPolicy();
ep(($p['version']??null)==='2.1-resource','resource concurrency policy version');
ep(($p['mode']??null)==='CONTEXT_ONLY'&&($p['enforcement']??null)==='ADVISORY','context is non-prescriptive');
ep(($p['prescriptiveRouting']??true)===false&&($p['mandatoryToolOrder']??true)===false&&($p['quotaBudgetingRequired']??true)===false&&($p['remoteMissionRequired']??true)===false,'old execution rituals are disabled');
ep(($p['sourceAuthorityRequiredForMutation']??false)===true&&($p['singleWriterMutationBoundary']??false)===true&&($p['mutationBoundary']??null)==='CONFLICTING_RESOURCE'&&($p['parallelNonConflictingMutationsAllowed']??false)===true&&($p['candidateWorkspaceIsolation']??false)===true,'real integrity boundaries remain resource scoped');
ep(($p['ownerApprovalForCanonicalPromotion']??false)===true&&($p['actualOutcomeVerification']??false)===true,'promotion and outcome evidence boundaries remain');
ep(HubCapabilityRegistryService::mutationScopeForExecution('source.promote','VPS')==='EXTERNAL','persisted scope remains schema-compatible');
ep(HubCapabilityRegistryService::mutationResourceForExecution('source.promote','VPS')==='CANONICAL:SOURCE','source promotion has a canonical source resource');
ep(HubCapabilityRegistryService::mutationResourceForExecution('project.mutate.assisted','VPS')==='CANDIDATE','candidate mutations are isolated parallel work');
ep(HubCapabilityRegistryService::mutationResourcesConflict('CANONICAL:SOURCE','CANONICAL:SOURCE')===true,'same canonical resource serializes');
ep(HubCapabilityRegistryService::mutationResourcesConflict('CANONICAL:SOURCE','CANONICAL:DEPLOY')===false,'different canonical resources can proceed independently');
ep(HubCapabilityRegistryService::mutationResourcesConflict('CANONICAL:PROJECT','CANDIDATE')===true,'unknown canonical mutations fail closed');
ep(HubCapabilityRegistryService::mutationResourceIsGlobal('CANONICAL:DEPLOY')===true,'deploy lane is a VPS-global mutation resource');
ep(HubCapabilityRegistryService::mutationResourceIsGlobal('CANONICAL:SOURCE')===false,'source lane stays project-local');
ep(HubCapabilityRegistryService::mutationResourcesConflictForProjects('CANONICAL:DEPLOY','project-a','CANONICAL:DEPLOY','project-b')===true,'deploys serialize across projects');
ep(HubCapabilityRegistryService::mutationResourcesConflictForProjects('CANONICAL:SOURCE','project-a','CANONICAL:DEPLOY','project-a')===true,'source promotion interlocks with same-project deploy');
ep(HubCapabilityRegistryService::mutationResourcesConflictForProjects('CANONICAL:SOURCE','project-a','CANONICAL:DEPLOY','project-b')===false,'source promotion remains independent from another project deploy');
ep(HubCapabilityRegistryService::mutationResourcesConflictForProjects('RESOURCE:RELEASE_STAGE','project-a','CANONICAL:DEPLOY','project-a')===true,'release staging interlocks with same-project deploy');
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
