"use strict";
const fs=require("fs");
const {HatchetClient,ConcurrencyLimitStrategy}=require("@hatchet-dev/typescript-sdk/v1");
const tokenPath=process.env.AWH_HATCHET_CREDENTIAL_FILE||"/var/lib/awh-hub/provider-credentials/hatchet.key";
function fail(code){console.error(code);process.exit(1);}
if(!fs.existsSync(tokenPath)) fail("AWH_HATCHET_CREDENTIAL_MISSING");
const token=fs.readFileSync(tokenPath,"utf8").trim();
if(!token||/\s/.test(token)) fail("AWH_HATCHET_CREDENTIAL_INVALID");
process.env.HATCHET_CLIENT_TOKEN=token;
const hatchet=HatchetClient.init();
const workflow=hatchet.workflow({name:"awh-execution-v1",concurrency:{maxRuns:1,limitStrategy:ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,expression:"input.resource"}});
workflow.task({name:"awh-execution-envelope-v1",retries:2,fn:async(input,ctx)=>{
 if(!input||input.schemaVersion!==1) throw new Error("AWH_ENVELOPE_INVALID");
 if(typeof input.executionId!=="string"||!/^[0-9a-f-]{36}$/i.test(input.executionId)) throw new Error("AWH_EXECUTION_ID_INVALID");
 if(typeof input.resource!=="string"||input.resource.length<1||input.resource.length>160) throw new Error("AWH_RESOURCE_INVALID");
 if(input.productionMutationAuthority!==false) throw new Error("AWH_PRODUCTION_AUTHORITY_DENIED");
 return {schemaVersion:1,executionId:input.executionId,resource:input.resource,retryCount:ctx.retryCount(),productionMutationAuthority:false,provider:"hatchet-readyidc"};
}});
(async()=>{const worker=await hatchet.worker("awh-readyidc",{workflows:[workflow],slots:Number(process.env.AWH_HATCHET_SLOTS||4)});console.log("AWH_HATCHET_WORKER_READY authority=execution-only");await worker.start();})().catch(e=>fail("AWH_HATCHET_WORKER_FATAL:"+String(e?.message||e)));
