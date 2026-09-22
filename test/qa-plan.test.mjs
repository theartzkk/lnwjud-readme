import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';

const script=new URL('../scripts/qa/qa-plan.mjs',import.meta.url);
const phpAvailable = spawnSync(process.env.AWH_PHP || 'php', ['--version'], { stdio: 'ignore', shell: false }).status === 0;
const qaTest = phpAvailable ? test : test.skip;
function plan(payload){return new Promise((resolve)=>{const p=spawn(process.execPath,[script.pathname],{cwd:new URL('..',import.meta.url),stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',c=>out+=c);p.stderr.on('data',c=>err+=c);p.on('close',code=>resolve({code,out,err}));p.stdin.end(JSON.stringify(payload));});}

qaTest('risk-based QA keeps documentation/policy changes fast',async()=>{
  const r=await plan({files:['ART_AI_WORKING_PROTOCOL.md','docs/BLOCK_FREE_OPERATIONS.md']});assert.equal(r.code,0);const row=JSON.parse(r.out);assert.equal(row.riskLevel,'LOW');assert.equal(row.budget,'FAST');assert.equal(row.script,'qa:fast');assert.equal(row.fullSuiteRequired,false);
});

qaTest('machine-readable execution policy is treated as critical runtime policy',async()=>{
  const r=await plan({files:['config/execution-policy.json'],releaseBoundary:false});assert.equal(r.code,0);const row=JSON.parse(r.out);assert.equal(row.riskLevel,'CRITICAL');assert.equal(row.budget,'DEEP');assert.equal(row.script,'qa:local');
});

qaTest('authority/deploy changes select deep QA and require full suite only at release boundary',async()=>{
  let r=await plan({files:['hub/src/HubOperatorBridgeService.php'],releaseBoundary:false});assert.equal(r.code,0);let row=JSON.parse(r.out);assert.equal(row.budget,'DEEP');assert.equal(row.script,'qa:local');assert.equal(row.fullSuiteRequired,false);
  r=await plan({files:['hub/src/HubOperatorBridgeService.php'],releaseBoundary:true});row=JSON.parse(r.out);assert.equal(row.fullSuiteRequired,true);
});
