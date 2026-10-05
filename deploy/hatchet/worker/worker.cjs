"use strict";
const fs=require("fs");
const {execFile}=require("child_process");
const {promisify}=require("util");
const {HatchetClient,ConcurrencyLimitStrategy,IdempotencyCollisionError}=require("@hatchet-dev/typescript-sdk/v1");
const execFileAsync=promisify(execFile);
const tokenPath=process.env.AWH_HATCHET_CREDENTIAL_FILE||"/var/lib/awh-hub/provider-credentials/hatchet.key";
const php=process.env.AWH_HATCHET_PHP||"/usr/bin/php";
const bridge=process.env.AWH_HATCHET_BRIDGE||"/opt/awh-hub/control-plane-current/hub/bin/awh-hatchet-execution.php";
const slots=Math.max(1,Math.min(16,Number(process.env.AWH_HATCHET_SLOTS||4)));
const dispatchIntervalMs=Math.max(1000,Math.min(30000,Number(process.env.AWH_HATCHET_DISPATCH_INTERVAL_MS||2000)));
function fail(code){console.error(code);process.exit(1);}
if(!fs.existsSync(tokenPath)) fail("AWH_HATCHET_CREDENTIAL_MISSING");
const token=fs.readFileSync(tokenPath,"utf8").trim();
if(!token||/\s/.test(token)) fail("AWH_HATCHET_CREDENTIAL_INVALID");
process.env.HATCHET_CLIENT_TOKEN=token;
async function bridgeCall(args,timeout=900000){
 const {stdout,stderr}=await execFileAsync(php,[bridge,...args],{env:process.env,timeout,maxBuffer:1024*1024});
 if(String(stderr||"").trim()!=="") throw new Error("AWH_BRIDGE_STDERR");
 const value=JSON.parse(String(stdout||"").trim());
 if(!value||value.schemaVersion!==1) throw new Error("AWH_BRIDGE_RESPONSE_INVALID");
 return value;
}
const hatchet=HatchetClient.init();
const workflow=hatchet.workflow({
 name:"awh-execution-v1",
 concurrency:{maxRuns:1,limitStrategy:ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,expression:"input.resource"},
 idempotency:{strategy:"status",expression:"input.executionId",fallbackTtlMs:86400000}
});
workflow.task({name:"awh-execution-envelope-v1",retries:2,fn:async(input,ctx)=>{
 if(!input||input.schemaVersion!==1) throw new Error("AWH_ENVELOPE_INVALID");
 if(typeof input.executionId!=="string"||!/^[0-9a-f-]{36}$/i.test(input.executionId)) throw new Error("AWH_EXECUTION_ID_INVALID");
 if(typeof input.resource!=="string"||input.resource.length<1||input.resource.length>160) throw new Error("AWH_RESOURCE_INVALID");
 if(input.productionMutationAuthority!==false) throw new Error("AWH_PRODUCTION_AUTHORITY_DENIED");
 const response=await bridgeCall(["execute",input.executionId]);
 const result=response.result;
 if(!result||result.executionId!==input.executionId) throw new Error("AWH_EXECUTION_NOT_READY");
 return {schemaVersion:1,executionId:input.executionId,resource:input.resource,canonicalState:String(result.state||"UNKNOWN"),idempotent:result.idempotent===true,retryCount:ctx.retryCount(),productionMutationAuthority:false,provider:"hatchet-readyidc"};
}});
let dispatching=false;
async function dispatchOnce(){
 if(dispatching)return;
 dispatching=true;
 try{
  const response=await bridgeCall(["candidates",String(Math.min(16,slots*2))],30000);
  const candidates=Array.isArray(response.items)?response.items:[];
  for(const candidate of candidates){
   try{await workflow.runNoWait(candidate);}
   catch(error){if(error instanceof IdempotencyCollisionError||error?.name==="IdempotencyCollisionError")continue;throw error;}
  }
 }finally{dispatching=false;}
}
(async()=>{
 const worker=await hatchet.worker("awh-readyidc",{workflows:[workflow],slots});
 const started=worker.start();
 await new Promise(resolve=>setTimeout(resolve,1000));
 console.log("AWH_HATCHET_WORKER_READY authority=execution-only dispatch=exact-id");
 await dispatchOnce().catch(()=>console.error("AWH_HATCHET_DISPATCH_FAILED"));
 const timer=setInterval(()=>dispatchOnce().catch(()=>console.error("AWH_HATCHET_DISPATCH_FAILED")),dispatchIntervalMs);
 try{await started;}finally{clearInterval(timer);}
})().catch(()=>fail("AWH_HATCHET_WORKER_FATAL"));
