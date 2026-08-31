import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const ROOT=process.cwd();
function run(command:string,args:string[]) { return new Promise<{code:number,stderr:string}>((resolve,reject)=>{ const child=spawn(command,args,{cwd:ROOT,shell:false,stdio:['ignore','ignore','pipe']}); let stderr=''; child.stderr.on('data',c=>stderr+=String(c)); child.once('error',reject); child.once('close',code=>resolve({code:code??1,stderr})); }); }
const revision='a'.repeat(40);
const valid={schemaVersion:1,revision,reviewer:'AIPass Fixture',verdict:'REVIEW',scores:{chat:90,mobile:88,agentic:86,artifact:92,recovery:84},findings:[{id:'mobile-safe-area',severity:'P2',scenario:'mobile review',problem:'Bottom action is visually crowded.',evidence:'390px capture shows reduced spacing.',expected:'Keep a comfortable safe-area gap.',fixLayer:'mobile-layout',confidence:.9,sourcePaths:['web/review.css']}]};

async function verdict(value:unknown,dir:string,name:string){ const file=join(dir,`${name}.json`); await writeFile(file,JSON.stringify(value)); const js=await run(process.execPath,['scripts/review/validate-aipass-findings.mjs',file,revision]); const phpCode=`require 'hub/src/HubCloudWorkflowService.php'; HubAiPassFindingsValidator::validateJson(file_get_contents(${JSON.stringify(file)}), ${JSON.stringify(revision)});`; const php=await run('php',['-r',phpCode]); return {js:js.code,php:php.code}; }

test('JS and PHP findings validators enforce the same authority contract',async()=>{ const dir=await mkdtemp(join(tmpdir(),'awh-findings-')); try {
  assert.deepEqual(await verdict(valid,dir,'valid'),{js:0,php:0});
  assert.deepEqual(await verdict({...valid,unexpected:true},dir,'extra'),{js:1,php:255});
  const p0={...valid,verdict:'PASS',findings:[{...valid.findings[0],severity:'P0'}]}; assert.deepEqual(await verdict(p0,dir,'p0-pass'),{js:1,php:255});
  const wrong={...valid,revision:'b'.repeat(40)}; assert.deepEqual(await verdict(wrong,dir,'wrong-revision'),{js:1,php:255});
  const long={...valid,findings:[{...valid.findings[0],problem:'x'.repeat(601)}]}; assert.deepEqual(await verdict(long,dir,'too-long'),{js:1,php:255});
} finally { await rm(dir,{recursive:true,force:true}); }});
