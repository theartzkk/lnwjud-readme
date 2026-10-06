"use strict";
const fs=require("fs");
const {execFile}=require("child_process");
const {promisify}=require("util");
const {HatchetClient,ConcurrencyLimitStrategy,IdempotencyCollisionError}=require("@hatchet-dev/typescript-sdk/v1");
const {HatchetEmbeddedClient}=require("@hatchet-dev/typescript-sdk/v1/embedded");
const execFileAsync=promisify(execFile);
const providerMode=String(process.env.AWH_HATCHET_MODE||"embedded").trim().toLowerCase();
const tokenPath=process.env.AWH_HATCHET_CREDENTIAL_FILE||"/var/lib/awh-hub/provider-credentials/hatchet.key";
const php=process.env.AWH_HATCHET_PHP||"/usr/bin/php";
const bridge=process.env.AWH_HATCHET_BRIDGE||"/opt/awh-hub/control-plane-current/hub/bin/awh-hatchet-execution.php";
const slots=Math.max(1,Math.min(16,Number(process.env.AWH_HATCHET_SLOTS||4)));
const dispatchIntervalMs=Math.max(1000,Math.min(30000,Number(process.env.AWH_HATCHET_DISPATCH_INTERVAL_MS||2000)));
const heartbeatPath=process.env.AWH_HATCHET_HEARTBEAT_FILE||"/var/lib/awh-hub/hatchet-worker-heartbeat.json";
const embeddedVersion=process.env.AWH_HATCHET_EMBEDDED_VERSION||"v0.110.5";
const embeddedChecksum=process.env.AWH_HATCHET_EMBEDDED_CHECKSUM||"18ddacae0005042bd982328bcb8d370cca6907352a1ab2a3c8406001d31e7dee";
const embeddedDataDir=process.env.AWH_HATCHET_EMBEDDED_DATA_DIR||"/var/lib/awh-hub/hatchet-embedded/postgres";
const embeddedGrpcPort=Math.max(1024,Math.min(65535,Number(process.env.AWH_HATCHET_EMBEDDED_GRPC_PORT||7070)));
const embeddedApiPort=Math.max(1024,Math.min(65535,Number(process.env.AWH_HATCHET_EMBEDDED_API_PORT||28243)));
let lastDispatchAt=null;
let lastExecutionId=null;
let lastCandidateCount=0;
let lastErrorCode=null;
let worker=null;
let hatchet=null;
let timer=null;
let stopping=false;
function fail(code){console.error(code);process.exit(1);}
function heartbeat(state,extra={}){
 try{
  const now=new Date().toISOString();
  const value={schemaVersion:1,worker:"awh-readyidc",pid:process.pid,state,lastSeenAt:now,providerMode,slots,dispatchIntervalMs,lastDispatchAt,lastExecutionId,lastCandidateCount,lastErrorCode,...extra};
  const temp=heartbeatPath+".tmp-"+process.pid;
  fs.writeFileSync(temp,JSON.stringify(value)+"\n",{encoding:"utf8",mode:0o600});
  fs.renameSync(temp,heartbeatPath);
 }catch{console.error("AWH_HATCHET_HEARTBEAT_WRITE_FAILED");}
}
if(!["embedded","cloud"].includes(providerMode)) fail("AWH_HATCHET_MODE_INVALID");
async function bridgeCall(args,timeout=900000){
 const {stdout,stderr}=await execFileAsync(php,[bridge,...args],{env:process.env,timeout,maxBuffer:1024*1024});
 if(String(stderr||"").trim()!=="") throw new Error("AWH_BRIDGE_STDERR");
 const value=JSON.parse(String(stdout||"").trim());
 if(!value||value.schemaVersion!==1) throw new Error("AWH_BRIDGE_RESPONSE_INVALID");
 return value;
}
async function initHatchet(){
 if(providerMode==="embedded"){
  delete process.env.HATCHET_CLIENT_TOKEN;
  fs.mkdirSync(embeddedDataDir,{recursive:true,mode:0o700});
  return HatchetEmbeddedClient.init({version:embeddedVersion,checksum:embeddedChecksum,postgresDataDir:embeddedDataDir,grpcPort:embeddedGrpcPort,apiPort:embeddedApiPort,logLevel:"warn",readyTimeoutMs:180000});
 }
 if(!fs.existsSync(tokenPath)) fail("AWH_HATCHET_CREDENTIAL_MISSING");
 const token=fs.readFileSync(tokenPath,"utf8").trim();
 if(!token||/\s/.test(token)) fail("AWH_HATCHET_CREDENTIAL_INVALID");
 process.env.HATCHET_CLIENT_TOKEN=token;
 return HatchetClient.init();
}
async function shutdown(signal){
 if(stopping)return;
 stopping=true;
 if(timer){clearInterval(timer);timer=null;}
 heartbeat("STOPPING",{signal});
 try{if(worker)await worker.stop();}catch{lastErrorCode="AWH_HATCHET_WORKER_STOP_FAILED";}
 try{if(providerMode==="embedded"&&hatchet&&typeof hatchet.stopEmbedded==="function")await hatchet.stopEmbedded();}catch{lastErrorCode="AWH_HATCHET_EMBEDDED_STOP_FAILED";}
 heartbeat("STOPPED",{signal});
 process.exit(0);
}
process.once("SIGTERM",()=>{void shutdown("SIGTERM");});
process.once("SIGINT",()=>{void shutdown("SIGINT");});
let dispatching=false;
async function main(){
 hatchet=await initHatchet();
 const workflow=hatchet.workflow({
  name:"awh-execution-v1",
  concurrency:{maxRuns:1,limitStrategy:ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,expression:"input.resource"},
  idempotency:{strategy:"status",expression:"input.executionId",fallbackTtlMs:86400000}
 });
 workflow.task({name:"awh-execution-envelope-v1",retries:16,backoff:{factor:2,maxSeconds:3600},fn:async(input,ctx)=>{
  if(!input||input.schemaVersion!==1) throw new Error("AWH_ENVELOPE_INVALID");
  if(typeof input.executionId!=="string"||!/^[0-9a-f-]{36}$/i.test(input.executionId)) throw new Error("AWH_EXECUTION_ID_INVALID");
  if(typeof input.resource!=="string"||input.resource.length<1||input.resource.length>160) throw new Error("AWH_RESOURCE_INVALID");
  if(input.productionMutationAuthority!==false) throw new Error("AWH_PRODUCTION_AUTHORITY_DENIED");
  const response=await bridgeCall(["execute",input.executionId]);
  const result=response.result;
  if(!result||result.executionId!==input.executionId) throw new Error("AWH_EXECUTION_NOT_READY");
  const canonicalState=String(result.state||"UNKNOWN");
  if(canonicalState==="QUEUED") throw new Error("AWH_CANONICAL_RETRY_PENDING");
  if(!["COMPLETED","FAILED","CANCELLED","WAITING_FOR_APPROVAL","WAITING_FOR_CAPABILITY"].includes(canonicalState)) throw new Error("AWH_CANONICAL_STATE_NOT_TERMINAL");
  return {schemaVersion:1,executionId:input.executionId,resource:input.resource,canonicalState,idempotent:result.idempotent===true,retryCount:ctx.retryCount(),productionMutationAuthority:false,provider:providerMode==="embedded"?"hatchet-readyidc-embedded":"hatchet-cloud"};
 }});
 async function dispatchOnce(){
  if(dispatching||stopping)return;
  dispatching=true;
  heartbeat("DISPATCHING");
  try{
   const response=await bridgeCall(["candidates",String(Math.min(16,slots*2))],30000);
   const candidates=Array.isArray(response.items)?response.items:[];
   lastCandidateCount=candidates.length;
   lastDispatchAt=new Date().toISOString();
   lastErrorCode=null;
   for(const candidate of candidates){
    lastExecutionId=typeof candidate?.executionId==="string"?candidate.executionId:lastExecutionId;
    try{await workflow.runNoWait(candidate);}
    catch(error){
     if(error instanceof IdempotencyCollisionError||error?.name==="IdempotencyCollisionError"){
      const existingRunExternalId=typeof error?.existingRunExternalId==="string"?error.existingRunExternalId.trim():"";
      if(existingRunExternalId==="")throw error;
      const status=String(await hatchet.runs.get_status(existingRunExternalId)||"").toUpperCase();
      if(status==="FAILED"||status==="CANCELLED")await hatchet.runs.replay({ids:[existingRunExternalId]});
      continue;
     }
     throw error;
    }
   }
   heartbeat(candidates.length>0?"DISPATCHED":"IDLE");
  }catch(error){
   lastErrorCode=String(error?.message||"AWH_HATCHET_DISPATCH_FAILED").slice(0,120);
   heartbeat("DEGRADED");
   throw error;
  }finally{dispatching=false;}
 }
 worker=await hatchet.worker("awh-readyidc",{workflows:[workflow],slots,handleKill:false});
 const started=worker.start();
 await worker.waitUntilReady(15000);
 heartbeat("READY",{embeddedVersion:providerMode==="embedded"?embeddedVersion:null});
 console.log("AWH_HATCHET_WORKER_READY authority=execution-only dispatch=exact-id provider="+providerMode);
 await dispatchOnce().catch(()=>console.error("AWH_HATCHET_DISPATCH_FAILED"));
 timer=setInterval(()=>dispatchOnce().catch(()=>console.error("AWH_HATCHET_DISPATCH_FAILED")),dispatchIntervalMs);
 await started;
 if(!stopping)throw new Error("AWH_HATCHET_WORKER_STOPPED");
}
main().catch(error=>{
 lastErrorCode=String(error?.message||"AWH_HATCHET_WORKER_FATAL").slice(0,120);
 heartbeat("FATAL",{lastErrorCode});
 fail("AWH_HATCHET_WORKER_FATAL");
});
