#!/usr/bin/env node
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { npmLaunchSpec } from './lib/npm-runtime.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const safe=(v)=>String(v||'project').replace(/[^A-Za-z0-9._-]+/g,'-').slice(0,80)||'project';
async function readableJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch{return null;}}
function alive(pid){if(!Number.isInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch{return false;}}
function nowIso(){return new Date().toISOString();}

async function sharedRoot(){
  const explicit=process.env.AWH_QA_SINGLEFLIGHT_ROOT;
  if(explicit){await mkdir(explicit,{recursive:true,mode:0o700});return explicit;}
  const vps='/var/lib/awh-remote/qa-singleflight';
  try{await mkdir(vps,{recursive:true,mode:0o700});await access(vps,constants.W_OK);return vps;}catch{}
  const local=join(ROOT,'.awh-local','qa-singleflight');await mkdir(local,{recursive:true,mode:0o700});return local;
}
async function gitSourceIdentity(){
  const headRun=spawnSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8',shell:false});
  const head=headRun.status===0?headRun.stdout.trim().toLowerCase():'unknown';
  const statusRun=spawnSync('git',['status','--porcelain=v1','--untracked-files=all'],{cwd:ROOT,encoding:'utf8',shell:false,maxBuffer:16*1024*1024});
  const status=statusRun.status===0?statusRun.stdout:'';
  if(!status.trim())return head;
  const diffRun=spawnSync('git',['diff','--binary','HEAD'],{cwd:ROOT,encoding:null,shell:false,maxBuffer:64*1024*1024});
  const hash=createHash('sha256').update(head).update(status);
  if(diffRun.status===0&&diffRun.stdout)hash.update(diffRun.stdout);
  const untrackedRun=spawnSync('git',['ls-files','--others','--exclude-standard','-z'],{cwd:ROOT,encoding:'utf8',shell:false,maxBuffer:8*1024*1024});
  if(untrackedRun.status===0){for(const rel of untrackedRun.stdout.split('\0').filter(Boolean).sort()){hash.update(rel);try{hash.update(await readFile(join(ROOT,rel)));}catch{}}}
  return `${head}-dirty-${hash.digest('hex').slice(0,16)}`;
}
async function projectKey(){
  try{const p=JSON.parse(await readFile(join(ROOT,'package.json'),'utf8'));return safe(p.name||'awh');}catch{return 'awh';}
}
async function atomicJson(path,value){const tmp=path+'.tmp-'+process.pid;await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await import('node:fs/promises').then(fs=>fs.rename(tmp,path));}

export async function withSingleFlight({lockRoot,key,sha,mode='test',runner,waitTimeoutMs=20*60_000,staleMs=30*60_000,pollMs=500}){
  await mkdir(lockRoot,{recursive:true,mode:0o700});
  const lock=join(lockRoot,safe(key)+'.lock');
  const resultDir=join(lockRoot,'results');await mkdir(resultDir,{recursive:true,mode:0o700});
  const result=join(resultDir,createHash('sha256').update(`${key}:${sha}:${mode}`).digest('hex')+'.json');
  const deadline=Date.now()+waitTimeoutMs;
  for(;;){
    try{
      await mkdir(lock,{mode:0o700});
      const owner={schemaVersion:1,pid:process.pid,key,sha,mode,startedAt:nowIso()};
      await atomicJson(join(lock,'owner.json'),owner);
      const started=Date.now();let code=1;
      try{code=Number(await runner())||0;}catch{code=1;}
      const capsule={schemaVersion:1,key,sha,mode,code,completedAt:nowIso(),durationMs:Date.now()-started};
      await atomicJson(result,capsule);
      await rm(lock,{recursive:true,force:true});
      return {...capsule,reused:false};
    }catch(e){
      if(e?.code!=='EEXIST')throw e;
      const owner=await readableJson(join(lock,'owner.json'));
      const ownerStarted=Date.parse(owner?.startedAt||'');
      let lockAge=0;try{lockAge=Date.now()-(await stat(lock)).mtimeMs;}catch{continue;}
      if(!owner&&lockAge<5_000){await sleep(pollMs);continue;}
      const stale=(!owner&&lockAge>=5_000)||(!alive(Number(owner?.pid))&&(!Number.isFinite(ownerStarted)||Date.now()-ownerStarted>5_000))||(Number.isFinite(ownerStarted)&&Date.now()-ownerStarted>staleMs);
      if(stale){await rm(lock,{recursive:true,force:true});continue;}
      if(Date.now()>deadline)throw new Error('QA_SINGLEFLIGHT_WAIT_TIMEOUT');
      if(owner.sha===sha&&owner.mode===mode){
        while(existsSync(lock)&&Date.now()<=deadline)await sleep(pollMs);
        const capsule=await readableJson(result);
        if(capsule?.sha===sha&&capsule?.mode===mode&&Number.isInteger(capsule.code))return {...capsule,reused:true};
        continue;
      }
      while(existsSync(lock)&&Date.now()<=deadline)await sleep(pollMs);
    }
  }
}

async function npmRunner(){
  const npmPath=process.env.npm_execpath;
  let executable='npm',args=['run','test:raw'];
  if(npmPath){const spec=npmLaunchSpec(npmPath,process.execPath);executable=spec.executable;args=[...spec.argsPrefix,'run','test:raw'];}
  return await new Promise((resolveCode)=>{
    const c=spawn(executable,args,{cwd:ROOT,env:process.env,stdio:'inherit',shell:false});
    c.once('error',()=>resolveCode(1));c.once('close',code=>resolveCode(code??1));
  });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=await sharedRoot(),key=await projectKey(),sha=await gitSourceIdentity();
  const result=await withSingleFlight({lockRoot:root,key,sha,runner:npmRunner});
  if(result.reused)console.log(`QA_SINGLEFLIGHT=REUSED sha=${sha} result=${result.code===0?'PASS':'FAIL'}`);
  process.exit(result.code);
}
