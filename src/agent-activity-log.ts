import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentRuntimeMode } from './settings.js';
import type { AgentWorkPlane } from './agent-runtime-policy.js';

const MAX_EVENTS=250;
const MAX_BYTES=256*1024;
const SOURCES=new Set(['AWH_WEB','LINE','AUTOMATION','LOCAL','UNKNOWN']);
const OUTCOMES=new Set(['STARTED','SUCCESS','FAIL','STOPPED','DEFERRED']);
const ACTIVITY=new Set(['IDLE','READING_FILES','CHECKING_WEBSITE','USING_CHROME','USING_ADOBE','EXPORTING','UPDATING_TOOL_PACK','RUNNING_PROCESS','OTHER']);

export interface AgentActivityEvent {
  schemaVersion:1;
  at:string;
  source:'AWH_WEB'|'LINE'|'AUTOMATION'|'LOCAL'|'UNKNOWN';
  capability:string;
  provider:string|null;
  plane:AgentWorkPlane;
  outcome:'STARTED'|'SUCCESS'|'FAIL'|'STOPPED'|'DEFERRED';
  mode:AgentRuntimeMode;
  activity:'IDLE'|'READING_FILES'|'CHECKING_WEBSITE'|'USING_CHROME'|'USING_ADOBE'|'EXPORTING'|'UPDATING_TOOL_PACK'|'RUNNING_PROCESS'|'OTHER';
}

function pathFor(dataDir:string):string{return join(dataDir,'activity-log.json');}
function safeText(value:string,max:number):string{return value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/(?:Bearer\s+)[A-Za-z0-9._~-]+/gi,'Bearer [redacted]').replace(/((?:password|secret|token|api[_-]?key)\s*[=:]\s*)[^\s&]+/gi,'$1[redacted]').trim().slice(0,max);}

export async function readAgentActivity(dataDir:string):Promise<AgentActivityEvent[]>{
  try{
    const raw=await readFile(pathFor(dataDir),'utf8');
    if(Buffer.byteLength(raw)>MAX_BYTES) return [];
    const rows=JSON.parse(raw) as unknown;
    if(!Array.isArray(rows)) return [];
    return rows.filter((row):row is AgentActivityEvent=>Boolean(row&&typeof row==='object'&&!Array.isArray(row)&&row.schemaVersion===1&&typeof row.at==='string'&&SOURCES.has(String(row.source))&&typeof row.capability==='string'&&row.capability.length<=80&&(row.provider===null||typeof row.provider==='string')&&['BACKGROUND','FOREGROUND'].includes(String(row.plane))&&OUTCOMES.has(String(row.outcome))&&['OFF','ON','LIVE'].includes(String(row.mode))&&ACTIVITY.has(String(row.activity)))).slice(-MAX_EVENTS);
  }catch{return [];}
}

export async function appendAgentActivity(dataDir:string,event:Omit<AgentActivityEvent,'schemaVersion'|'at'>):Promise<void>{
  const normalized:AgentActivityEvent={schemaVersion:1,at:new Date().toISOString(),source:SOURCES.has(event.source)?event.source:'UNKNOWN',capability:safeText(event.capability,80),provider:event.provider===null?null:safeText(event.provider,80),plane:event.plane,outcome:event.outcome,mode:event.mode,activity:event.activity};
  const rows=[...(await readAgentActivity(dataDir)),normalized].slice(-MAX_EVENTS);
  await mkdir(dataDir,{recursive:true,mode:0o700});
  const target=pathFor(dataDir),temp=target+'.tmp-'+process.pid;
  await writeFile(temp,JSON.stringify(rows,null,2)+'\n',{encoding:'utf8',mode:0o600});
  await rename(temp,target);
}
