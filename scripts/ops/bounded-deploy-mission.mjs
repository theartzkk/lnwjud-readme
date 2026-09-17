import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA=/^[0-9a-f]{40}$/;
const ROOT=process.env.AWH_SOURCE_ROOT||process.cwd();
const GUARDED=join(ROOT,'scripts/ops/guarded-control-plane-deploy.mjs');
const DESKTOP_ARTIFACTS=['dist-web/downloads/AWH-macOS-x64.zip','dist-web/downloads/AWH-Windows-x64.zip','dist-web/downloads/SHA256SUMS.txt'];
const DEPLOY_MODES=['--compat-refresh','--assistant-workstream','--workspace-continuity','--unified-workspace','--final-product','--founding-memory','--self-service','--central-project-authority','--anywhere-execution','--cost-aware-ai','--automations','--self-sufficient-ai','--account-hosting','--cloud-first','--conversation-lifecycle','--project-source-authority'];

export function desktopImpactForFiles(files){
  return files.some((file)=>/^desktop\//.test(file)||/^src\//.test(file)||file==='package.json'||file==='package-lock.json'||/^scripts\/desktop-/.test(file)||/^scripts\/release\/create-desktop-release-evidence\.mjs$/.test(file)||/^forge\./.test(file)||/^electron(?:\.|\/)/.test(file));
}

export function missionModeFromArgs(args){
  const modes=args.filter((arg)=>DEPLOY_MODES.includes(arg));
  if(modes.length>1) throw new Error('MISSION_MODE_AMBIGUOUS');
  return modes[0]??'--project-source-authority';
}

function run(command,args,{env={},forward=false}={}){
  return new Promise((resolve)=>{
    const child=spawn(command,args,{cwd:ROOT,env:{...process.env,...env},shell:false,stdio:['ignore','pipe','pipe']});
    let tail='';
    const ingest=(chunk,stream)=>{const text=chunk.toString();if(forward)stream.write(text);tail=(tail+text).slice(-262144);};
    child.stdout.on('data',(c)=>ingest(c,process.stdout)); child.stderr.on('data',(c)=>ingest(c,process.stderr));
    child.once('error',(error)=>resolve({code:1,tail,error})); child.once('close',(code)=>resolve({code:code??1,tail}));
  });
}

async function git(args){const r=await run('git',args);if(r.code!==0)throw new Error(`GIT_FAILED:${args[0]}`);return r.tail.trim();}
async function resolveProduction(){for(const ref of ['refs/heads/production','refs/remotes/vps/production','refs/remotes/origin/production']){const r=await run('git',['rev-parse','--verify',ref]);const sha=r.tail.trim();if(r.code===0&&SHA.test(sha))return sha;}throw new Error('MISSION_PRODUCTION_REF_UNRESOLVED');}

export async function runMission(rawArgs=process.argv.slice(2)){
  const approved=rawArgs.includes('--approve');
  if(rawArgs.includes('--deploy')||rawArgs.includes('--dry-run')) throw new Error('MISSION_INTERNAL_FLAG_FORBIDDEN');
  const mode=missionModeFromArgs(rawArgs); const cleanup=rawArgs.includes('--cleanup-topology');
  const unknown=rawArgs.filter((a)=>!['--approve','--cleanup-topology',...DEPLOY_MODES].includes(a));
  if(unknown.length) throw new Error(`MISSION_ARGUMENT_INVALID:${unknown[0]}`);
  const head=(await git(['rev-parse','HEAD'])).toLowerCase(); const main=(await git(['rev-parse','refs/heads/main'])).toLowerCase();
  if(!SHA.test(head)||head!==main) throw new Error('MISSION_HEAD_NOT_CANONICAL_MAIN');
  const dirty=await git(['status','--porcelain','--untracked-files=all']); if(dirty!=='') throw new Error('MISSION_SOURCE_NOT_CLEAN');
  const production=(await resolveProduction()).toLowerCase();
  if(production===head){console.log(`MISSION_RELEASE_SHA=${head}`);console.log('MISSION_STATE=ALREADY_CURRENT');console.log('MISSION_RESULT=PASS');return;}
  const changed=(await git(['diff','--name-only',`${production}..${head}`])).split(/\r?\n/).filter(Boolean);
  const desktopImpact=desktopImpactForFiles(changed); const completeArtifacts=DESKTOP_ARTIFACTS.every((f)=>existsSync(join(ROOT,f)));
  if(desktopImpact&&!completeArtifacts) throw new Error('MISSION_DESKTOP_ARTIFACT_BUILD_REQUIRED');
  const reuse=!desktopImpact;
  console.log(`MISSION_BASE_SHA=${production}`); console.log(`MISSION_RELEASE_SHA=${head}`); console.log(`MISSION_CHANGED_FILES=${changed.length}`);
  console.log(`MISSION_DESKTOP_MODE=${reuse?'REUSE_VERIFIED':'NEW_ARTIFACTS'}`); console.log(`MISSION_MODE=${mode.slice(2)}`);
  const npm=await run('npm',['run','qa:fast'],{forward:true}); if(npm.code!==0) throw new Error('MISSION_QA_FAILED'); console.log('MISSION_QA=PASS');
  const common=['--owner-auth',mode]; if(cleanup)common.push('--cleanup-topology');
  const env={AWH_RELEASE_COMMIT:head,...(reuse?{AWH_REUSE_REMOTE_DESKTOP_ARTIFACTS:'1'}:{})};
  const rehearsal=await run(process.execPath,[GUARDED,'--dry-run',...common],{env,forward:true});
  if(rehearsal.code!==0||!rehearsal.tail.includes('_DRY_RUN=PASS')) throw new Error('MISSION_REHEARSAL_FAILED');
  console.log('MISSION_REHEARSAL=PASS');
  if(!approved){console.log('MISSION_STATE=READY_FOR_APPROVAL');console.log('MISSION_APPROVAL_REQUIRED=1');return;}
  console.log('MISSION_APPROVALS_CONSUMED=1');
  const deploy=await run(process.execPath,[GUARDED,'--deploy','--approve',...common],{env,forward:true});
  if(deploy.code!==0||!deploy.tail.includes('DEPLOY_RESULT=PASS')||!deploy.tail.includes('DEPLOY_STAGE=BACKUP_VERIFIED')||!deploy.tail.includes('DEPLOY_STAGE=SOURCE_DRIFT_VERIFIED')) throw new Error('MISSION_DEPLOY_FAILED');
  const url=process.env.AWH_PUBLIC_RELEASE_URL||'https://kruart.online/release.json';
  const response=await fetch(url,{cache:'no-store'}); if(!response.ok)throw new Error('MISSION_PUBLIC_VERIFY_UNAVAILABLE');
  const release=await response.json(); if(release?.sourceSha!==head||release?.sourceState!=='COMMITTED')throw new Error('MISSION_PUBLIC_REVISION_MISMATCH');
  console.log('MISSION_BACKUP=PASS'); console.log('MISSION_SOURCE_DRIFT=PASS'); console.log('MISSION_PUBLIC_VERIFY=PASS'); console.log('MISSION_STATE=COMPLETED'); console.log('MISSION_RESULT=PASS');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){runMission().catch((error)=>{console.error(`MISSION_RESULT=BLOCKED`);console.error(`MISSION_REASON=${String(error?.message||error).replace(/[^A-Za-z0-9_.:-]/g,'_').slice(0,160)}`);process.exit(1);});}
