import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DEFAULT_POLICY=fileURLToPath(new URL('../../config/execution-policy.json',import.meta.url));

function fail(code){throw new Error(code);}
export async function loadExecutionPolicy(path=process.env.AWH_EXECUTION_POLICY||DEFAULT_POLICY){
  const raw=JSON.parse(await readFile(path,'utf8'));
  if(raw?.schemaVersion!==1)fail('EXECUTION_POLICY_SCHEMA');
  const rm=raw.remoteMission??{}, qa=raw.qa??{}, gates=raw.gateTiers??{};
  if(!Number.isInteger(rm.targetMinutes)||rm.targetMinutes<10||rm.targetMinutes>180)fail('EXECUTION_POLICY_REMOTE_TARGET');
  if(rm.quotaIsTelemetryOnly!==true||rm.resumeFirst!==true||rm.allowLonger!==true)fail('EXECUTION_POLICY_REMOTE_FLAGS');
  if(!Number.isInteger(rm.progressHeartbeatMinutes?.min)||!Number.isInteger(rm.progressHeartbeatMinutes?.max)||rm.progressHeartbeatMinutes.min<1||rm.progressHeartbeatMinutes.max<rm.progressHeartbeatMinutes.min)fail('EXECUTION_POLICY_HEARTBEAT');
  if(!Number.isInteger(rm.processPollSeconds?.min)||!Number.isInteger(rm.processPollSeconds?.max)||rm.processPollSeconds.min<30||rm.processPollSeconds.max<rm.processPollSeconds.min)fail('EXECUTION_POLICY_POLL');
  if(!Number.isInteger(rm.deviceLeaseMinutes)||rm.deviceLeaseMinutes<rm.targetMinutes||rm.deviceLeaseMinutes>240)fail('EXECUTION_POLICY_LEASE');
  if(!Number.isInteger(rm.historyRetentionDays)||rm.historyRetentionDays<1||rm.historyRetentionDays>365)fail('EXECUTION_POLICY_HISTORY_RETENTION');
  if(!Number.isInteger(rm.maxHistoryFiles)||rm.maxHistoryFiles<10||rm.maxHistoryFiles>5000)fail('EXECUTION_POLICY_HISTORY_LIMIT');
  if(rm.heartbeatDetailLevel!=='DETAILED'||rm.heartbeatMustContinueAfterSend!==true||rm.heartbeatProgressMode!=='STAGE_BASED_NO_FALSE_PERCENT')fail('EXECUTION_POLICY_HEARTBEAT_DETAIL');
  if(rm.assistantVisibleHeartbeatRequired!==true||rm.internalStatusUiCountsAsHeartbeat!==false||rm.heartbeatMayBeReplacedBySpinner!==false)fail('EXECUTION_POLICY_HEARTBEAT_VISIBILITY');
  if(!Array.isArray(rm.heartbeatRequiredFields)||rm.heartbeatRequiredFields.length<9)fail('EXECUTION_POLICY_HEARTBEAT_FIELDS');
  if(!Number.isInteger(rm.fastPath?.firstProductiveActionTargetSeconds)||rm.fastPath.firstProductiveActionTargetSeconds<15||rm.fastPath.firstProductiveActionTargetSeconds>180||rm.fastPath.maxPreflightProbes!==2||rm.fastPath.preferBatchMutation!==true)fail('EXECUTION_POLICY_FAST_PATH');
  if(rm.errorRecovery?.classifyBeforeRetry!==true||rm.errorRecovery.sameActionBlindRetryMax!==0||rm.errorRecovery.transportTimeoutResumeFirst!==true||rm.errorRecovery.maxApplicationRestartAttemptsPerMission!==1)fail('EXECUTION_POLICY_ERROR_RECOVERY');
  if(rm.creativeApplicationSafety?.routineForceQuitForbidden!==true||rm.creativeApplicationSafety.forceQuitRequiresConfirmedHang!==true||rm.creativeApplicationSafety.confirmedHangMinSeconds<30||rm.creativeApplicationSafety.confirmedHangSignalsRequired<2||rm.creativeApplicationSafety.checkpointBeforeTermination!==true||rm.creativeApplicationSafety.directScriptLaunchWhileGuiInstanceActiveForbidden!==true)fail('EXECUTION_POLICY_CREATIVE_SAFETY');
  if(rm.heartbeatDetailLevel!=='DETAILED'||rm.heartbeatMustContinueAfterSend!==true||rm.heartbeatProgressMode!=='STAGE_BASED_NO_FALSE_PERCENT')fail('EXECUTION_POLICY_HEARTBEAT_DETAIL');
  if(!Number.isInteger(rm.heartbeatProofMaxAgeSeconds)||rm.heartbeatProofMaxAgeSeconds<60||rm.heartbeatProofMaxAgeSeconds>1800)fail('EXECUTION_POLICY_HEARTBEAT_PROOF_AGE');
  const requiredHeartbeatFields=['elapsed','doneSinceLast','currentOperation','stage','proofOfWork','activePidOrApp','lastSaveOrArtifact','nextSteps','blocker'];
  if(!Array.isArray(rm.heartbeatRequiredFields)||requiredHeartbeatFields.some((field)=>!rm.heartbeatRequiredFields.includes(field)))fail('EXECUTION_POLICY_HEARTBEAT_FIELDS');
  for(const key of ['G0','G1','G2','G3'])if(!gates[key])fail('EXECUTION_POLICY_GATES');
  for(const risk of ['LOW','MEDIUM','HIGH','CRITICAL'])if(!['FAST','STANDARD','DEEP'].includes(qa.riskBudget?.[risk]))fail('EXECUTION_POLICY_QA_RISK');
  for(const budget of ['FAST','STANDARD','DEEP'])if(!/^qa:(?:fast|local|full)$/.test(String(qa.scriptByBudget?.[budget]??'')))fail('EXECUTION_POLICY_QA_SCRIPT');
  if(qa.singleFlight?.enabled!==true||qa.singleFlight.scope!=='PROJECT'||qa.singleFlight.serializeDeepTests!==true||qa.singleFlight.reuseExactShaResult!==true)fail('EXECUTION_POLICY_QA_SINGLEFLIGHT');
  return raw;
}
export function qaScriptForBudget(policy,budget){
  const key=String(budget||'').toUpperCase();
  const script=policy?.qa?.scriptByBudget?.[key];
  if(!script)fail('EXECUTION_POLICY_QA_BUDGET');
  return script;
}
