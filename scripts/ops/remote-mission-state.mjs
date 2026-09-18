import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadExecutionPolicy } from './execution-policy.mjs';

const SAFE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROOT=process.env.AWH_REMOTE_MISSION_ROOT||'/var/lib/awh-remote/remote-missions';
function cleanText(v,max=240){if(typeof v!=='string')return null;v=v.trim();if(!v||v.length>max||/[\0\r\n]/.test(v))return null;return v;}
function cleanList(v,{maxItems=8,maxLength=500}={}){if(!Array.isArray(v))return [];const out=[];for(const item of v){const text=cleanText(item,maxLength);if(text)out.push(text);if(out.length>=maxItems)break;}return out;}
function cleanStage(v){if(!v||typeof v!=='object')return null;const current=Number(v.current),total=Number(v.total),label=cleanText(v.label,160);if(!Number.isInteger(current)||!Number.isInteger(total)||current<1||total<1||current>total||total>100||!label)return null;return {current,total,label};}
function id(v){if(!SAFE.test(String(v??'')))throw new Error('MISSION_ID_INVALID');return String(v);}
function device(v){if(!UUID.test(String(v??'')))throw new Error('MISSION_DEVICE_INVALID');return String(v).toLowerCase();}
function fileForDevice(deviceId){return join(ROOT,'active',deviceId+'.json');}
function historyFile(missionId){return join(ROOT,'history',missionId+'.json');}
async function atomicJson(path,value){await mkdir(join(ROOT,'active'),{recursive:true,mode:0o700});await mkdir(join(ROOT,'history'),{recursive:true,mode:0o700});const tmp=path+'.tmp-'+process.pid;await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(tmp,path);}
async function readJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch{return null;}}
function now(){return new Date();}
function expiry(minutes){return new Date(Date.now()+minutes*60000).toISOString();}
function active(row){return row?.status==='ACTIVE'&&Date.parse(row.leaseExpiresAt)>Date.now();}
async function input(){let raw='';for await(const chunk of process.stdin)raw+=chunk;return raw.trim()?JSON.parse(raw):{};}

async function cleanupHistory(policy){
  const dir=join(ROOT,'history');await mkdir(dir,{recursive:true,mode:0o700});
  let entries=[];try{entries=await readdir(dir,{withFileTypes:true});}catch{return;}
  const rows=[];
  for(const entry of entries){
    if(!entry.isFile()||!entry.name.endsWith('.json'))continue;
    const path=join(dir,entry.name);try{const info=await stat(path);rows.push({path,mtimeMs:info.mtimeMs});}catch{}
  }
  rows.sort((a,b)=>b.mtimeMs-a.mtimeMs);
  const cutoff=Date.now()-policy.remoteMission.historyRetentionDays*86400000;
  for(let i=0;i<rows.length;i++)if(i>=policy.remoteMission.maxHistoryFiles||rows[i].mtimeMs<cutoff)await rm(rows[i].path,{force:true});
}

export async function runRemoteMissionCommand(command,payload,policy=null){
  policy=policy??await loadExecutionPolicy();
  await mkdir(join(ROOT,'active'),{recursive:true,mode:0o700});await mkdir(join(ROOT,'history'),{recursive:true,mode:0o700});
  await cleanupHistory(policy);
  const leaseMinutes=policy.remoteMission.deviceLeaseMinutes;
  if(command==='start'){
    const missionId=id(payload.missionId), deviceId=device(payload.deviceId), path=fileForDevice(deviceId), current=await readJson(path);
    if(active(current)&&current.missionId!==missionId)throw new Error('MISSION_DEVICE_LEASE_HELD');
    const at=now().toISOString();
    const row={schemaVersion:1,missionId,deviceId,deviceName:cleanText(payload.deviceName,120),project:cleanText(payload.project,120),objective:cleanText(payload.objective,500),status:'ACTIVE',startedAt:current?.missionId===missionId?current.startedAt:at,updatedAt:at,lastHeartbeatAt:at,leaseExpiresAt:expiry(leaseMinutes),heartbeatSequence:current?.missionId===missionId?(Number(current.heartbeatSequence)||0):0,app:cleanText(payload.app,120),pid:Number.isInteger(payload.pid)&&payload.pid>0?payload.pid:null,checkpoint:cleanText(payload.checkpoint,500),nextStep:cleanText(payload.nextStep,500),currentOperation:cleanText(payload.currentOperation,500),stage:cleanStage(payload.stage),doneSinceLast:cleanList(payload.doneSinceLast),proofOfWork:cleanList(payload.proofOfWork),lastSaveOrArtifact:cleanText(payload.lastSaveOrArtifact,500),nextSteps:cleanList(payload.nextSteps,{maxItems:3,maxLength:500}),blocker:null};
    if(!row.deviceName||!row.project||!row.objective)throw new Error('MISSION_METADATA_INVALID');
    await atomicJson(path,row);return row;
  }
  const deviceId=device(payload.deviceId), path=fileForDevice(deviceId), row=await readJson(path);
  if(!row)throw new Error('MISSION_NOT_FOUND');
  if(payload.missionId&&row.missionId!==id(payload.missionId))throw new Error('MISSION_ID_MISMATCH');
  if(command==='status')return {...row,leaseActive:active(row)};
  if(command==='heartbeat'){
    if(!active(row))throw new Error('MISSION_LEASE_EXPIRED');
    const at=now().toISOString();
    const proofOfWork=cleanList(payload.proofOfWork);if(policy.remoteMission.heartbeatRequiresProofOfWork===true&&proofOfWork.length===0)throw new Error('MISSION_HEARTBEAT_PROOF_REQUIRED');
    const updated={...row,updatedAt:at,lastHeartbeatAt:at,leaseExpiresAt:expiry(leaseMinutes),heartbeatSequence:(Number(row.heartbeatSequence)||0)+1,
      checkpoint:cleanText(payload.checkpoint,500)??row.checkpoint,nextStep:cleanText(payload.nextStep,500)??row.nextStep,
      currentOperation:cleanText(payload.currentOperation,500)??row.currentOperation,stage:cleanStage(payload.stage)??row.stage,
      doneSinceLast:cleanList(payload.doneSinceLast),proofOfWork,lastSaveOrArtifact:cleanText(payload.lastSaveOrArtifact,500)??row.lastSaveOrArtifact,
      nextSteps:cleanList(payload.nextSteps,{maxItems:3,maxLength:500}),blocker:payload.blocker===null?null:(cleanText(payload.blocker,500)??row.blocker),
      app:cleanText(payload.app,120)??row.app,pid:Number.isInteger(payload.pid)&&payload.pid>0?payload.pid:row.pid};
    await atomicJson(path,updated);return updated;
  }
  if(command==='finish'){
    const at=now().toISOString();const status=payload.result==='BLOCKED'?'BLOCKED':'COMPLETED';
    const completed={...row,status,updatedAt:at,completedAt:at,leaseExpiresAt:at,checkpoint:cleanText(payload.checkpoint,500)??row.checkpoint,nextStep:null,blocker:status==='BLOCKED'?(cleanText(payload.blocker,500)??'BLOCKED'):null};
    await atomicJson(historyFile(row.missionId),completed);await rm(path,{force:true});return completed;
  }
  throw new Error('MISSION_COMMAND_INVALID');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const command=process.argv[2]||'status';
  runRemoteMissionCommand(command,await input()).then((r)=>process.stdout.write(JSON.stringify(r)+'\n')).catch((e)=>{process.stderr.write(String(e?.message||e)+'\n');process.exit(2);});
}
