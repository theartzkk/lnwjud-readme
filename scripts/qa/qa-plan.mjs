import { spawn } from 'node:child_process';
import { loadExecutionPolicy, qaScriptForBudget } from '../ops/execution-policy.mjs';

function run(command,args,input){return new Promise((resolve)=>{const p=spawn(command,args,{stdio:['pipe','pipe','pipe'],shell:false});let out='',err='';p.stdout.on('data',c=>out+=c);p.stderr.on('data',c=>err+=c);p.on('close',code=>resolve({code,out,err}));p.stdin.end(input);});}
let raw='';for await(const chunk of process.stdin)raw+=chunk;
const input=raw.trim()?JSON.parse(raw):{};const files=Array.isArray(input.files)?input.files:[];
const php=process.env.AWH_PHP||'php';const r=await run(php,['hub/bin/verification-intelligence.php','plan'],JSON.stringify({files})+'\n');
if(r.code!==0)throw new Error('QA_PLAN_VERIFICATION_FAILED');
const intelligence=JSON.parse(r.out.trim());const policy=await loadExecutionPolicy();
const script=qaScriptForBudget(policy,intelligence.budget);
process.stdout.write(JSON.stringify({schemaVersion:1,...intelligence,script,fullSuiteRequired:intelligence.budget==='DEEP'&&Boolean(input.releaseBoundary)})+'\n');
