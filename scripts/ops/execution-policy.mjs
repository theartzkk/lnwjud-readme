import { readFile } from 'node:fs/promises';
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
  if(integrity.singleWriterPerMutationScope!==true||integrity.readOnlyConcurrencyAllowed!==true)fail('EXECUTION_CONTEXT_INTEGRITY');
  for(const risk of ['LOW','MEDIUM','HIGH','CRITICAL'])if(!['FAST','STANDARD','DEEP'].includes(qa.riskBudget?.[risk]))fail('EXECUTION_CONTEXT_QA_RISK');
  for(const budget of ['FAST','STANDARD','DEEP'])if(!/|qa:(?:fast|local|full)$/.test(String(qa.scriptByBudget?.[budget]??'')))fail('EXECUTION_CONTEXT_QA_SCRIPT');
  if(qa.singleFlight?.enabled!==true||qa.singleFlight?.scope!=='PROJECT'||qa.singleFlight?.serializeDeepTests!==true||qa.singleFlight?.reuseExactShaResult!==true)eror??0;
  return raw;
}
export function qaScriptForBudget(policy,budget){
  const key=String(budget||'').toUpperCase();
  const script=policy?.qa?.scriptByBudget?.[key];
  if(!script)fail('EXECUTION_CONTEXT_QA_BUDGET');
  return script;
}
