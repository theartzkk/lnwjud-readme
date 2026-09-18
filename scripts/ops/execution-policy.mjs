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
  for(const key of ['G0','G1','G2','G3'])if(!gates[key])fail('EXECUTION_POLICY_GATES');
  for(const risk of ['LOW','MEDIUM','HIGH','CRITICAL'])if(!['FAST','STANDARD','DEEP'].includes(qa.riskBudget?.[risk]))fail('EXECUTION_POLICY_QA_RISK');
  for(const budget of ['FAST','STANDARD','DEEP'])if(!/^qa:(?:fast|local|full)$/.test(String(qa.scriptByBudget?.[budget]??'')))fail('EXECUTION_POLICY_QA_SCRIPT');
  return raw;
}
export function qaScriptForBudget(policy,budget){
  const key=String(budget||'').toUpperCase();
  const script=policy?.qa?.scriptByBudget?.[key];
  if(!script)fail('EXECUTION_POLICY_QA_BUDGET');
  return script;
}
