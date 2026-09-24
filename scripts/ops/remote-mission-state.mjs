import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadExecutionPolicy } from './execution-policy.mjs';

const SAFE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_RESOURCE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROOT=process.env.AWH_REMOTE_MISSION_ROOT||'/var/lib/awh-remote/remote-missions';
function cleanText(v,max=240){if(typeof v!=='string')return null;v=v.trim();if(!v||v.length>max||/[\0\r\n]/.test(v))return null;return v;}
function cleanList(v,{maxItems=8,maxLength=500}={}){if(!Array.isArray(v))return [];const out=[];for(const item of v){const text=cleanText(item,maxLength);if(text)out.push(text);if(out.length>=maxItems)break;}return out;}
function cleanStage(v){if(!v||typeof v!=='object')return null;const current=Number(v.current),total=Number(v.total),label=cleanText(v.label,160);if(!Number.isInteger(current)||!Number.isInteger(total)||current<1||total<1||current>total||total>100||!label)return null;return {current,total,label};}
function id(v){if(!SAFE.test(String(v??'')))throw new Error('MISSION_ID_INVALID');return String(v);}
function device(v){if(!UUID.test(String(v??'')))throw new Error('MISSION_DEVICE_INVALID');return String(v).toLowerCase();}
function resource(v){if(!SAFE_RESOURCE.test(String(v??'')))throw new Error('MISSION_RESOURCE_INVALID');return String(v);}
function legacyFileForDevice(deviceId){return join(ROOT,'active',deviceId+'.json');}
function fileForMission(missionId){return join(ROOT,'active',missionId+'.json');}
function fileForResource(resourceKey){return join(ROOT,'resources',resourceKey+'.json');}
function historyFile(missionId){return join(ROOT,'history',missionId+'.json');}
async function atomicJson(path,value){await mkdir(dirname(path),{recursive:true,mode:0o700});const tmp=path+'.tmp-'+process.pid;await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(tmp,path);}
async function readJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch{return null;}}
async function withResourceGuard(resourceKey,operation){
  const dir=join(ROOT,'resource-guards');await mkdir(dir,{recursive:true,mode:0o700});
  const guard=join(dir,resourceKey+'.lock');const deadline=Date.now()+2000;
  for(;;){
    try{await mkdir(guard,{mode:0o700});break;}
    catch(error){
      if(error?.code!=='EEXIST')throw error;
      try{const info=await stat(guard);if(Date.now()-info.mtimeMs>30000){await rm(guard,{recursive:true,force:true});continue;}}catch{}
      if(Date.now()>=deadline)throw new Error('MISSION_RESOURCE_BUSY');
      await new Promise((resolve)=>setTimeout(resolve,25));
    }
  }
  try{return await operation();}finally{await rm(guard,{recursive:true,force:true});}
}
async function migrateLegacyDeviceMission(deviceId){
  const legacy=legacyFileForDevice(deviceId),row=await readJson(legacy);
  if(!row||!SAFE.test(String(row.missionId??'')))return;
  const target=fileForMission(String(row.missionId));
  if(!existsSync(target))await atomicJson(target,row);
  await rm(legacy,{force:true});
}
async function missionRowsForDevice(deviceId){
  await migrateLegacyDeviceMission(deviceId);
  let entries=[];try{entries=await readdir(join(ROOT,'active'),{withFileTypes:true});}catch{return [];}
  const rows=[];
  for(const entry of entries){if(!entry.isFile()||!entry.name.endsWith('.json'))continue;const path=join(ROOT,'active',entry.name),row=await readJson(path);if(row?.status==='ACTIVE'&&row.deviceId===deviceId)rows.push({path,row});}
  rows.sort((a,b)=>String(a.row.startedAt??'').localeCompare(String(b.row.startedAt??''))||String(a.row.missionId).localeCompare(String(b.row.missionId)));
  return rows;
}
async function resolveMission(payload){
  const deviceId=device(payload.deviceId);await migrateLegacyDeviceMission(deviceId);
  if(payload.missionId){const missionId=id(payload.missionId),path=fileForMission(missionId),row=await readJson(path);if(!row)throw new Error('MISSION_NOT_FOUND');if(row.deviceId!==deviceId)throw new Error('MISSION_DEVICE_MISMATCH');return {deviceId,path,row};}
  const rows=await missionRowsForDevice(deviceId);if(rows.length===0)throw new Error('MISSION_NOT_FOUND');if(rows.length>1)throw new Error('MISSION_ID_REQUIRED');return {deviceId,...rows[0]};
}
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
  const cutoff=Date.now()-policy.runtimeDefaults.historyRetentionDays*86400000;
  for(let i=0;i<rows.length;i++)if(i>=policy.runtimeDefaults.maxHistoryFiles||rows[i].mtimeMs<cutoff)await rm(rows[i].path,{force:true});
}

export async function runRemoteMissionCommand(command,payload,policy=null){
  policy=policy??await loadExecutionPolicy();
  await mkdir(join(ROOT,'active'),{recursive:true,mode:0o700});await mkdir(join(ROOT,'history'),{recursive:true,mode:0o700});await mkdir(join(ROOT,'resources'),{recursive:true,mode:0o700});
  await cleanupHistory(policy);
  const leaseMinutes=policy.runtimeDefaults.deviceLeaseMinutes;
  if(command==='start'){
    const missionId=id(payload.missionId),deviceId=device(payload.deviceId);
    await migrateLegacyDeviceMission(deviceId);
    const path=fileForMission(missionId),current=await readJson(path);
    if(current&&current.deviceId!==deviceId)throw new Error('MISSION_ID_MISMATCH');
    const mutationMode=payload.mutationMode==='MUTATE'?'MUTATE':'READ_ONLY';
    const resourceKey=payload.resourceKey?resource(payload.resourceKey):null;
    const ownerKey=cleanText(payload.ownerKey,160);
    if(policy.integrity?.singleWriterPerMutationScope===true&&mutationMode==='MUTATE'&&!resourceKey)throw new Error('MISSION_RESOURCE_REQUIRED');
    const resourcePath=resourceKey?fileForResource(resourceKey):null;
    const at=now().toISOString();
    const row={schemaVersion:1,authorityClass:'DEVICE_TRANSPORT_LEASE',missionId,deviceId,deviceName:cleanText(payload.deviceName,120),project:cleanText(payload.project,120),objective:cleanText(payload.objective,500),mutationMode,resourceKey,ownerKey,status:'ACTIVE',startedAt:current?.missionId===missionId?current.startedAt:at,updatedAt:at,lastHeartbeatAt:at,leaseExpiresAt:expiry(leaseMinutes),heartbeatSequence:current?.missionId===missionId?(Number(current.heartbeatSequence)||0):0,app:cleanText(payload.app,120),pid:Number.isInteger(payload.pid)&&payload.pid>0?payload.pid:null,checkpoint:cleanText(payload.checkpoint,500),nextStep:cleanText(payload.nextStep,500),currentOperation:cleanText(payload.currentOperation,500),stage:cleanStage(payload.stage),doneSinceLast:cleanList(payload.doneSinceLast),proofOfWork:cleanList(payload.proofOfWork),lastSaveOrArtifact:cleanText(payload.lastSaveOrArtifact,500),nextSteps:cleanList(payload.nextSteps,{maxItems:3,maxLength:500}),blocker:null};
    if(!row.deviceName||!row.project||!row.objective)throw new Error('MISSION_METADATA_INVALID');
    if(resourcePath&&mutationMode==='MUTATE')return withResourceGuard(resourceKey,async()=>{
      const resourceCurrent=await readJson(resourcePath);
      if(active(resourceCurrent)&&resourceCurrent.missionId!==missionId)throw new Error('MISSION_RESOURCE_LEASE_HELD');
      await atomicJson(resourcePath,{schemaVersion:1,authorityClass:'DEVICE_TRANSPORT_LEASE',missionId,resourceKey,project:row.project,ownerKey:row.ownerKey,status:'ACTIVE',updatedAt:at,leaseExpiresAt:row.leaseExpiresAt});
      try{await atomicJson(path,row);}catch(error){const held=await readJson(resourcePath);if(held?.missionId===missionId)await rm(resourcePath,{force:true});throw error;}
      return row;
    });
    await atomicJson(path,row);return row;
  }
  const deviceId=device(payload.deviceId);
  if(command==='status'&&!payload.missionId){
    const rows=await missionRowsForDevice(deviceId);
    if(rows.length===0)throw new Error('MISSION_NOT_FOUND');
    if(rows.length>1)return {schemaVersion:1,deviceId,parallelMissionsAllowed:true,count:rows.length,missions:rows.map(({row})=>({...row,leaseActive:active(row)}))};
  }
  const resolved=await resolveMission(payload),path=resolved.path,row=resolved.row;
  if(command==='status'){
    const resourceLease=row.resourceKey&&row.mutationMode==='MUTATE'?await readJson(fileForResource(row.resourceKey)):null;
    return {...row,parallelMissionsAllowed:true,leaseActive:active(row),resourceLeaseActive:resourceLease?.missionId===row.missionId&&active(resourceLease)};
  }
  if(command==='heartbeat'){
    if(!active(row))throw new Error('MISSION_LEASE_EXPIRED');
    const at=now().toISOString();
    const proofOfWork=cleanList(payload.proofOfWork);
    const updated={...row,updatedAt:at,lastHeartbeatAt:at,leaseExpiresAt:expiry(leaseMinutes),heartbeatSequence:(Number(row.heartbeatSequence)||0)+1,
      checkpoint:cleanText(payload.checkpoint,500)??row.checkpoint,nextStep:cleanText(payload.nextStep,500)??row.nextStep,
      currentOperation:cleanText(payload.currentOperation,500)??row.currentOperation,stage:cleanStage(payload.stage)??row.stage,
      doneSinceLast:cleanList(payload.doneSinceLast),proofOfWork,lastSaveOrArtifact:cleanText(payload.lastSaveOrArtifact,500)??row.lastSaveOrArtifact,
      nextSteps:cleanList(payload.nextSteps,{maxItems:3,maxLength:500}),blocker:payload.blocker===null?null:(cleanText(payload.blocker,500)??row.blocker),
      app:cleanText(payload.app,120)??row.app,pid:Number.isInteger(payload.pid)&&payload.pid>0?payload.pid:row.pid};
    if(updated.resourceKey&&updated.mutationMode==='MUTATE')return withResourceGuard(updated.resourceKey,async()=>{
      const resourcePath=fileForResource(updated.resourceKey),held=await readJson(resourcePath);
      if(held?.missionId!==updated.missionId||!active(held))throw new Error('MISSION_RESOURCE_LEASE_LOST');
      await atomicJson(path,updated);
      await atomicJson(resourcePath,{schemaVersion:1,authorityClass:'DEVICE_TRANSPORT_LEASE',missionId:updated.missionId,resourceKey:updated.resourceKey,project:updated.project,ownerKey:updated.ownerKey,status:'ACTIVE',updatedAt:at,leaseExpiresAt:updated.leaseExpiresAt});
      return updated;
    });
    await atomicJson(path,updated);return updated;
  }
  if(command==='finish'){
    const at=now().toISOString();const status=payload.result==='BLOCKED'?'BLOCKED':'COMPLETED';
    const cleanupStatus=String(payload.cleanupStatus??'');
    const completionProof=cleanList(payload.completionProof,{maxItems:8,maxLength:500});
    const completed={...row,status,updatedAt:at,completedAt:at,leaseExpiresAt:at,objectiveComplete:status==='COMPLETED'?true:false,completionProof,cleanupStatus,checkpoint:cleanText(payload.checkpoint,500)??row.checkpoint,nextStep:null,blocker:status==='BLOCKED'?(cleanText(payload.blocker,500)??'BLOCKED'):null};
    if(row.resourceKey&&row.mutationMode==='MUTATE')return withResourceGuard(row.resourceKey,async()=>{
      const resourcePath=fileForResource(row.resourceKey),held=await readJson(resourcePath);
      if(held?.missionId!==row.missionId)throw new Error('MISSION_RESOURCE_LEASE_LOST');
      await atomicJson(historyFile(row.missionId),completed);await rm(path,{force:true});await rm(resourcePath,{force:true});return completed;
    });
    await atomicJson(historyFile(row.missionId),completed);await rm(path,{force:true});return completed;
  }
  throw new Error('MISSION_COMMAND_INVALID');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const command=process.argv[2]||'status';
  runRemoteMissionCommand(command,await input()).then((r)=>process.stdout.write(JSON.stringify(r)+'\n')).catch((e)=>{process.stderr.write(String(e?.message||e)+'\n');process.exit(2);});
}
