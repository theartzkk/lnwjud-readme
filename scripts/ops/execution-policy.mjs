import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_POLICY=fileURLToPath(new URL('../../config/execution-policy.json',import.meta.url));
function fail(code){throw new Error(code);}

export async function loadExecutionPolicy(path=process.env.AWH_EXECUTION_POLICY||DEFAULT_POLICY){
  const raw=JSON.parse(await readFile(path,'utf8'));
  if(raw?.schemaVersion!==2||raw?.mode!=='CONTEXT_ONLY'||raw?.prescriptivePolicy!==false)fail('EXECUTION_CONTEXT_SCHEMA');
  const runtime=raw.runtimeDefaults??{}, integrity=raw.integrity??{}, qa=raw.qa??{};
  if(!Number.isInteger(runtime.deviceLeaseMinutes)||runtime.deviceLeaseMinutes<1||runtime.deviceLeaseMinutes>240)fail('EXECUTION_CONTEXT_LEASE');
  if(!Number.isInteger(runtime.historyRetentionDays)||runtime.historyRetentionDays<1||runtime.historyRetentionDays>365)fail('EXECUTION_CONTEXT_HISTORY_RETENTION');
  if(!Number.isInteger(runtime.maxHistoryFiles)||runtime.maxHistoryFiles<10||runtime.maxHistoryFiles>5000)fail('EXECUTION_CONTEXT_HISTORY_LIMIT');
  if(integrity.singleWriterPerMutationScope!==true||integrity.readOnlyConcurrencyAllowed!==true||integrity.mutationAuthority!=='control_execution_envelopes'||integrity.secondWriterBehavior!=='WAIT_OR_JOIN'||integrity.parallelLockAuthorityAllowed!==false||integrity.localMissionAuthorityClass!=='DEVICE_TRANSPORT_LEASE')fail('EXECUTION_CONTEXT_INTEGRITY');
  if(!Array.isArray(integrity.globalMutationResources)||!integrity.globalMutationResources.includes('CANONICAL:DEPLOY'))fail('EXECUTION_CONTEXT_GLOBAL_RESOURCE');
  if(!Array.isArray(integrity.sameProjectInterlocks)||!integrity.sameProjectInterlocks.includes('CANONICAL:SOURCE<->CANONICAL:DEPLOY')||!integrity.sameProjectInterlocks.includes('RESOURCE:RELEASE_STAGE<->CANONICAL:DEPLOY'))fail('EXECUTION_CONTEXT_INTERLOCK');
  for(const risk of ['LOW','MEDIUM','HIGH','CRITICAL'])if(!['FAST','STANDARD','DEEP'].includes(qa.riskBudget?.[risk]))fail('EXECUTION_CONTEXT_QA_RISK');
  for(const budget of ['FAST','STANDARD','DEEP'])if(!/|qa:(?:fast|local|full)$/.test(String(qa.scriptByBudget?.[budget]??'')))fail('EXECUTION_CONTEXT_QA_SCRIPT');
  if(qa.singleFlight?.enabled!==true||qa.singleFlight?.scope!=='PROJECT'||qa.singleFlight?.serializeDeepTests!==true||qa.singleFlight?.reuseExactShaResult!==true)fail('EXECUTION_CONTEXT_QA_SINGLE_FLIGHT');
  const privilege=raw.privilegeRouting??{}, toolchain=raw.toolchainRouting??{};
  if(privilege.preflightRequired!==true||privilege.defaultPrivilegedLane!=='TYPED_OPERATOR'||privilege.noNewPrivilegesFailFast!==true)fail('EXECUTION_CONTEXT_PRIVILEGE_ROUTING');
  if(!Array.isArray(privilege.privilegedMutationLanes)||!['TYPED_OPERATOR','OWNER_RELAY'].every((lane)=>privilege.privilegedMutationLanes.includes(lane)))fail('EXECUTION_CONTEXT_PRIVILEGE_LANES');
  if(privilege.directSudoFromRestrictedSessionAllowed!==false||privilege.userConsoleFallbackAllowed!==false||privilege.ownerRelayRequiresExplicitApproval!==true)fail('EXECUTION_CONTEXT_PRIVILEGE_BOUNDARY');
  if(!Array.isArray(privilege.restrictedSessionIdentities)||!privilege.restrictedSessionIdentities.includes('awh-remote'))fail('EXECUTION_CONTEXT_RESTRICTED_IDENTITIES');
  if(toolchain.preserveVerifiedRuntimeAcrossPrivilegeBoundary!==true||!Number.isInteger(toolchain.releaseNodeMajorMin)||toolchain.releaseNodeMajorMin<20)fail('EXECUTION_CONTEXT_TOOLCHAIN');
  if(!Array.isArray(toolchain.releaseNodeCandidates)||toolchain.releaseNodeCandidates.length<3||!toolchain.releaseNodeCandidates.includes('/opt/awh-toolchain/node/bin/node'))fail('EXECUTION_CONTEXT_TOOLCHAIN_PATHS');
  if(toolchain.dependencyHydration?.requiredBeforeDeepQa!==true||toolchain.dependencyHydration?.strategy!=='NPM_CI_PREFER_OFFLINE'||toolchain.dependencyHydration?.lockfileExact!==true)fail('EXECUTION_CONTEXT_DEPENDENCY_HYDRATION');
  return raw;
}

export function privilegeLane(policy,{uid=typeof process.getuid==='function'?process.getuid():null,identity=process.env.USER||'',noNewPrivileges=false,explicitLane=process.env.AWH_PRIVILEGED_LANE||''}={}){
  const cfg=policy?.privilegeRouting??{};
  const lane=explicitLane||((uid===0)?'OWNER_RELAY':'UNPRIVILEGED');
  if(noNewPrivileges&&uid!==0&&cfg.noNewPrivilegesFailFast===true)return {lane:'RESTRICTED_SESSION',allowed:false,reason:'NO_NEW_PRIVILEGES'};
  if((cfg.restrictedSessionIdentities??[]).includes(identity)&&uid!==0)return {lane:'RESTRICTED_SESSION',allowed:false,reason:'RESTRICTED_IDENTITY'};
  if(uid===0&&!explicitLane)return {lane:'OWNER_RELAY',allowed:true,reason:'ROOT_OWNER_RELAY'};
  return {lane,allowed:(cfg.privilegedMutationLanes??[]).includes(lane),reason:'EXPLICIT'};
}

export function releaseNodeCandidates(policy){
  return (policy?.toolchainRouting?.releaseNodeCandidates??[]).filter((item)=>typeof item==='string'&&item.length>0);
}

export function dependencyHydrationRequired(policy,root){
  return policy?.toolchainRouting?.dependencyHydration?.requiredBeforeDeepQa===true&&!existsSync(String(root).replace(/\/$/,'')+'/node_modules');
}
export function qaScriptForBudget(policy,budget){
  const key=String(budget||'').toUpperCase();
  const script=policy?.qa?.scriptByBudget?.[key];
  if(!script)fail('EXECUTION_CONTEXT_QA_BUDGET');
  return script;
}
