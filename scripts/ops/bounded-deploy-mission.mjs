import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadExecutionPolicy, privilegeLane, qaScriptForBudget } from './execution-policy.mjs';
import { hydrateDesktopReleaseArtifacts, verifyDesktopReleaseArtifacts } from '../release/hydrate-desktop-release-artifacts.mjs';

const SHA=/^[0-9a-f]{40}$/;
const AWH_PROJECT_ID='113b45c0-23e1-408d-ae0f-ac5eca7f6900';
const ROOT=process.env.AWH_SOURCE_ROOT||process.cwd();
const GUARDED=join(ROOT,'scripts/ops/guarded-control-plane-deploy.mjs');
const INTELLIGENCE=join(ROOT,'hub/bin/verification-intelligence.php');
const EVIDENCE_DIR=join(ROOT,'.awh-build','verification');
const EVAL_CATALOG=join(ROOT,'config/kruart-engineering-eval.json');
const DESKTOP_ARTIFACTS=['dist-web/downloads/AWH-macOS-arm64.zip','dist-web/downloads/AWH-macOS-x64.zip','dist-web/downloads/AWH-Windows-x64.zip','dist-web/downloads/SHA256SUMS.txt'];
const DEPLOY_MODES=['--compat-refresh','--awh-core','--assistant-workstream','--workspace-continuity','--unified-workspace','--final-product','--founding-memory','--self-service','--central-project-authority','--anywhere-execution','--cost-aware-ai','--automations','--self-sufficient-ai','--account-hosting','--cloud-first','--conversation-lifecycle','--project-source-authority','--identity-convergence','--platform-hardening'];
let missionContext={};

const CONNECTOR_ONLY_SRC = new Set(['src/worker-capability-discovery.ts']);

export function desktopImpactForFiles(files){
  return files.some((file)=>/^desktop\//.test(file)||( /^src\//.test(file) && !CONNECTOR_ONLY_SRC.has(file) )||file==='package.json'||file==='package-lock.json'||/^scripts\/desktop-/.test(file)||/^scripts\/release\/create-desktop-release-evidence\.mjs$/.test(file)||/^forge\./.test(file)||/^electron(?:\.|\/)/.test(file));
}

export function missionModeFromArgs(args){
  const modes=args.filter((arg)=>DEPLOY_MODES.includes(arg));
  if(modes.length>1) throw new Error('MISSION_MODE_AMBIGUOUS');
  return modes[0]??'--platform-hardening';
}

export function desktopReleaseRequested(args){
  return args.includes('--desktop-agent-release');
}

function run(command,args,{env={},forward=false,input=null}={}){
  return new Promise((resolve)=>{
    const child=spawn(command,args,{cwd:ROOT,env:{...process.env,...env},shell:false,stdio:['pipe','pipe','pipe']});
    let tail='';let stdoutTail='';let stderrTail='';
    const ingest=(chunk,stream,kind)=>{const text=chunk.toString();if(forward)stream.write(text);tail=(tail+text).slice(-262144);if(kind==='stdout')stdoutTail=(stdoutTail+text).slice(-65536);else stderrTail=(stderrTail+text).slice(-65536);};
    child.stdout.on('data',(c)=>ingest(c,process.stdout,'stdout')); child.stderr.on('data',(c)=>ingest(c,process.stderr,'stderr'));
    child.once('error',(error)=>resolve({code:1,tail,stdoutTail,stderrTail,error})); child.once('close',(code)=>resolve({code:code??1,tail,stdoutTail,stderrTail}));
    if(input===null)child.stdin.end();else child.stdin.end(String(input));
  });
}

export function deployEvidenceFromResult(result){
  const combined=String(result?.tail??'').slice(-32768);
  const stdoutTail=String(result?.stdoutTail??'').slice(-16384);
  const stderrTail=String(result?.stderrTail??'').slice(-16384);
  const lines=combined.split(/\r?\n/).filter(Boolean);
  const lastValue=(prefix)=>{for(let i=lines.length-1;i>=0;i--){if(lines[i].startsWith(prefix))return lines[i].slice(prefix.length).slice(0,240);}return null;};
  const failedAt=lastValue('DEPLOY_FAILED_AT=');
  const lastStage=lastValue('DEPLOY_STAGE=');
  const diagnostic=lastValue('DEPLOY_DIAGNOSTIC=');
  const rollback=lastValue('ROLLBACK=');
  const passed=Number(result?.code??1)===0&&combined.includes('DEPLOY_RESULT=PASS');
  return {
    status:passed?'PASS':'FAIL',
    exitCode:Number.isInteger(result?.code)?result.code:null,
    stage:failedAt??lastStage??'UNKNOWN',
    failureCode:passed?null:(diagnostic??(failedAt?`DEPLOY_FAILED_AT:${failedAt}`:'DEPLOY_FAILED')),
    stdoutTail,stderrTail,
    rollbackState:rollback??(passed?'NOT_REQUIRED':'UNKNOWN'),
  };
}

async function git(args){const r=await run('git',args);if(r.code!==0)throw new Error(`GIT_FAILED:${args[0]}`);return r.tail.trim();}
async function canonicalRemote(){
  const configured=await run('git',['config','--get','branch.main.remote']);
  const name=configured.code===0?configured.tail.trim():'';
  if(name&&name!=='.'){const probe=await run('git',['remote','get-url',name]);if(probe.code===0&&probe.tail.trim()!=='')return name;}
  for(const candidate of ['vps','origin']){const probe=await run('git',['remote','get-url',candidate]);if(probe.code===0&&probe.tail.trim()!=='')return candidate;}
  throw new Error('MISSION_CANONICAL_REMOTE_UNRESOLVED');
}
async function canonicalOperatorHost(){
  if(process.env.AWH_OPERATOR_HOST&&/^[A-Za-z0-9._@-]{1,160}$/.test(process.env.AWH_OPERATOR_HOST))return process.env.AWH_OPERATOR_HOST;
  const remote=await canonicalRemote();const probe=await run('git',['remote','get-url',remote]);if(probe.code!==0)return null;
  const match=probe.tail.trim().match(/^ssh:\/\/([^/]+)\//i);return match&&/^[A-Za-z0-9._@-]{1,160}$/.test(match[1])?match[1]:null;
}

export function localOperatorInvocation(local,args,{uid=typeof process.getuid==='function'?process.getuid():null}={}){
  if(uid===0)return {command:'/usr/sbin/runuser',args:['-u','awh-remote','--',local,...args],identity:'awh-remote'};
  return {command:local,args:[...args],identity:'current'};
}

async function operatorRequest(command,payload,{confirm=false}={}){
  const local=process.env.AWH_OPERATOR_CLIENT||'/usr/local/bin/awh-operator';
  if(existsSync(local)){
    const args=[command];if(confirm)args.push('--confirm');
    const invocation=localOperatorInvocation(local,args);
    if(!existsSync(invocation.command))return null;
    for(let attempt=1;attempt<=3;attempt++){
      const response=await run(invocation.command,invocation.args,{input:`${JSON.stringify(payload)}\n`});
      if(response.code===0){
        try{const decoded=JSON.parse(response.tail.trim());if(decoded?.ok===true)return decoded.result;}catch{}
      }
      if(attempt<3)await new Promise((resolve)=>setTimeout(resolve,attempt*250));
    }
    return null;
  }
  const host=await canonicalOperatorHost();if(!host)return null;
  const args=['-o','BatchMode=yes',host,'sudo','-n','-u','awh-remote','/usr/local/bin/awh-operator',command];if(confirm)args.push('--confirm');
  const response=await run('ssh',args,{input:`${JSON.stringify(payload)}\n`});if(response.code!==0)return null;
  try{const decoded=JSON.parse(response.tail.trim());return decoded?.ok===true?decoded.result:null;}catch{return null;}
}

async function durableRegressions(changedPaths,context={}){
  const result=await operatorRequest('verification-regressions',{changedPaths,...context});
  if(!result){console.log('MISSION_DURABLE_REGISTRY=BOOTSTRAP_UNAVAILABLE');return {ids:[],requiredChecks:[]};}
  missionContext.registryAvailable=true;const rows=Array.isArray(result.regressions)?result.regressions:[];
  const ids=rows.map((row)=>typeof row?.regressionId==='string'?row.regressionId:'').filter((id)=>/^reg-[a-f0-9]{12}$/.test(id));
  const requiredChecks=rows.flatMap((row)=>Array.isArray(row?.requiredChecks)?row.requiredChecks:[]).filter((check)=>typeof check==='string'&&/^[a-z0-9][a-z0-9._:-]{1,79}$/.test(check));
  console.log(`MISSION_DURABLE_REGISTRY=READY`);console.log(`MISSION_DURABLE_REGRESSIONS=${ids.join(',')}`);
  console.log(`MISSION_DURABLE_LESSON_CHECKS=${[...new Set(requiredChecks)].sort().join(',')}`);
  return {ids:[...new Set(ids)].sort(),requiredChecks:[...new Set(requiredChecks)].sort()};
}

async function persistDurable(document){
  if(missionContext.registryAvailable!==true)return null;
  const result=await operatorRequest('verification-store',document,{confirm:true});
  if(!result||result.state!=='STORED')throw new Error('MISSION_DURABLE_EVIDENCE_FAILED');
  console.log(`MISSION_DURABLE_EVIDENCE=${result.relativePath}`);return result;
}

export function productionStateForRefs(mode,head,observed={}){
  const clean=(value)=>typeof value==='string'&&SHA.test(value)?value.toLowerCase():null;
  const target=clean(head); if(!target)throw new Error('MISSION_SOURCE_IDENTITY_INVALID');
  const runtime=clean(observed['runtime/production'])||clean(observed.production);
  const trackRef=mode==='--awh-core'?'production':(mode==='--platform-hardening'?'platform/production':null);
  if(trackRef!==null){
    const track=clean(observed[trackRef]);
    const allCurrent=track===target&&runtime===target;
    const base=runtime||track;
    if(!base)throw new Error('MISSION_RUNTIME_PRODUCTION_REF_UNRESOLVED');
    return {baseSha:base,allCurrent,trackRef,trackSha:track,runtimeSha:runtime};
  }
  if(!runtime)throw new Error('MISSION_RUNTIME_PRODUCTION_REF_UNRESOLVED');
  return {baseSha:runtime,allCurrent:runtime===target,trackRef:null,trackSha:null,runtimeSha:runtime};
}

async function resolveProduction(mode,head){
  const remote=await canonicalRemote();
  const trackRef=mode==='--awh-core'?'production':(mode==='--platform-hardening'?'platform/production':null);
  const refs=[...new Set([...(trackRef?[trackRef]:[]),'runtime/production','production'])];
  const observed={};
  for(const ref of refs){
    const live=await run('git',['ls-remote','--exit-code',remote,`refs/heads/${ref}`]);
    const match=live.code===0?live.tail.trim().match(new RegExp(`^([0-9a-f]{40})\\s+refs/heads/${ref.replaceAll('/','\\/')}$`,'i')):null;
    if(match&&SHA.test(match[1]))observed[ref]=match[1].toLowerCase();
  }
  return productionStateForRefs(mode,head,observed);
}

async function policy(mode,payload){
  const result=await run(process.env.AWH_PHP||'php',[INTELLIGENCE,mode],{input:`${JSON.stringify(payload)}\n`});
  if(result.code!==0)throw new Error('MISSION_VERIFICATION_POLICY_FAILED');
  try{return JSON.parse(result.tail.trim().split(/\r?\n/).filter(Boolean).at(-1));}catch{throw new Error('MISSION_VERIFICATION_POLICY_INVALID');}
}

export async function verificationPlanForFiles(files){return policy('plan',{files});}
export async function stabilityForStatuses(statuses){return policy('stability',{statuses});}

async function evalScenariosForFiles(files){
  const catalog=JSON.parse(await readFile(EVAL_CATALOG,'utf8'));
  const rows=Array.isArray(catalog?.scenarios)?catalog.scenarios:[];
  const selected=[];
  for(const row of rows){
    if(row?.project!=='AWH'||typeof row?.id!=='string'||!Array.isArray(row?.triggerPatterns))continue;
    const matched=row.triggerPatterns.some((pattern)=>{
      try{const re=new RegExp(String(pattern),'i');return files.some((file)=>re.test(file));}catch{return false;}
    });
    if(matched)selected.push(row.id);
  }
  return [...new Set(selected)].sort();
}

async function saveCapsule(capsule){
  await mkdir(EVIDENCE_DIR,{recursive:true});
  const body=`${JSON.stringify(capsule,null,2)}\n`;
  const sha=createHash('sha256').update(body).digest('hex');
  const release=typeof capsule.releaseSha==='string'&&SHA.test(capsule.releaseSha)?capsule.releaseSha.slice(0,12):'unresolved';
  const path=join(EVIDENCE_DIR,`release-${release}.json`);
  await writeFile(path,body,{encoding:'utf8',mode:0o600});
  await writeFile(join(EVIDENCE_DIR,'latest-release-evidence.json'),body,{encoding:'utf8',mode:0o600});
  console.log(`MISSION_EVIDENCE_CAPSULE=${path}`); console.log(`MISSION_EVIDENCE_SHA256=${sha}`);
  await persistDurable(capsule);
  return {path,sha};
}

async function recordIncident(code,context={}){
  let incident;
  try{incident=await policy('incident',{code,context});}
  catch{
    const canonical=JSON.stringify({code:String(code||'MISSION_FAILED'),context});
    const fingerprint=createHash('sha256').update(canonical).digest('hex');
    incident={schemaVersion:1,fingerprint,regressionId:`reg-${fingerprint.slice(0,12)}`,code:String(code||'MISSION_FAILED'),context,required:true,policyFallback:true};
  }
  try{
    await mkdir(join(EVIDENCE_DIR,'incidents'),{recursive:true});
    const path=join(EVIDENCE_DIR,'incidents',`${incident.regressionId}.json`);
    const document={...incident,kind:'verification-incident',createdAt:new Date().toISOString()};
    await writeFile(path,`${JSON.stringify(document,null,2)}\n`,{encoding:'utf8',mode:0o600});
    try{await persistDurable(document);}catch{/* primary incident remains locally durable for this run */}
    console.error(`MISSION_INCIDENT_FINGERPRINT=${incident.fingerprint}`);
    console.error(`MISSION_REGRESSION_CASE=${incident.regressionId}`);
    return incident;
  }catch{return incident;}
}

async function runQa(script,forward=true){
  const isolated=join(ROOT,'scripts/ops/run-release-qa-isolated.sh');
  const result=existsSync(isolated)
    ? await run(isolated,[ROOT,script],{forward})
    : await run('npm',['run',script],{forward});
  return result.code===0?'PASS':'FAIL';
}

async function runtimePrivilegeState(policy){
  let noNewPrivileges=false;
  if(process.platform==='linux'){
    try{const status=await readFile('/proc/self/status','utf8');noNewPrivileges=/^NoNewPrivs:\s+1$/m.test(status);}catch{}
  }
  const state=privilegeLane(policy,{noNewPrivileges});
  console.log(`MISSION_PRIVILEGE_LANE=${state.lane}`);
  if(!state.allowed)throw new Error(`MISSION_PRIVILEGE_LANE_REQUIRED:${state.reason}`);
  return state;
}

async function ensureDependencies(policy){
  const isolated=join(ROOT,'scripts/ops/run-release-qa-isolated.sh');
  if(existsSync(isolated)&&policy?.toolchainRouting?.dependencyHydration?.requiredBeforeDeepQa===true){
    console.log('MISSION_DEPENDENCIES=ISOLATED_QA');
    return;
  }
  if(existsSync(join(ROOT,'node_modules'))){console.log('MISSION_DEPENDENCIES=READY');return;}
  if(policy?.toolchainRouting?.dependencyHydration?.requiredBeforeDeepQa!==true)throw new Error('MISSION_DEPENDENCIES_MISSING');
  throw new Error('MISSION_ISOLATED_QA_RUNNER_MISSING');
}

async function ensureRehearsalDependencies(policy){
  if(existsSync(join(ROOT,'node_modules','tsx'))){console.log('MISSION_REHEARSAL_DEPENDENCIES=READY');return;}
  if(policy?.toolchainRouting?.dependencyHydration?.requiredBeforeDeepQa!==true)throw new Error('MISSION_REHEARSAL_DEPENDENCIES_MISSING');
  console.log('MISSION_REHEARSAL_DEPENDENCIES=HYDRATING');
  const hydration=await run('npm',['ci','--ignore-scripts','--no-audit','--no-fund','--prefer-offline'],{forward:true});
  if(hydration.code!==0||!existsSync(join(ROOT,'node_modules','tsx')))throw new Error('MISSION_REHEARSAL_DEPENDENCIES_FAILED');
  console.log('MISSION_REHEARSAL_DEPENDENCIES=HYDRATED');
}

async function assertCanonicalMainStable(expected){
  const current=(await git(['rev-parse','refs/heads/main'])).toLowerCase();
  if(current!==expected)throw new Error('MISSION_CANONICAL_MAIN_MOVED');
  console.log(`MISSION_CANONICAL_MAIN_STABLE=${current}`);
}

async function verifyByBudget(plan){
  const budget=String(plan?.budget||'').toUpperCase();
  const executionPolicy=await loadExecutionPolicy();
  await runtimePrivilegeState(executionPolicy);
  await ensureDependencies(executionPolicy);
  const qaMode=qaScriptForBudget(executionPolicy,budget);
  console.log(`MISSION_QA_MODE=${qaMode}`);
  const breadth=await runQa(qaMode,true);
  if(breadth!=='PASS')throw new Error('MISSION_QA_FAILED');
  let stability={schemaVersion:1,status:'PASS',samples:1,pass:1,fail:0};
  if(budget==='DEEP'){
    const samples=[await runQa('qa:fast',true),await runQa('qa:fast',true)];
    stability=await stabilityForStatuses(samples);
    console.log(`MISSION_STABILITY_SAMPLES=${stability.samples}`);
    console.log(`MISSION_STABILITY=${stability.status}`);
    if(stability.status==='UNSTABLE')throw new Error('MISSION_QA_UNSTABLE');
    if(stability.status!=='PASS')throw new Error('MISSION_QA_FAILED');
  }else console.log('MISSION_STABILITY=PASS');
  console.log('MISSION_QA=PASS');
  return {mode:qaMode,status:'PASS',stability};
}

async function goldenJourneys(plan,head,deployTail,release,releaseUrl){
  const required=Array.isArray(plan?.goldenJourneys)?plan.goldenJourneys:[];
  const base=new URL(releaseUrl); base.pathname='/'; base.search=''; base.hash='';
  const results=[];
  for(const name of required){
    let pass=false; let evidence='';
    if(name==='production-identity'){
      pass=release?.sourceSha===head&&release?.sourceState==='COMMITTED'; evidence=pass?'public release identity matches exact source':'public release identity mismatch';
    }else if(name==='public-shell'){
      const r=await fetch(base,{cache:'no-store',redirect:'follow'}); pass=r.status===200; evidence=`HTTP_${r.status}`;
    }else if(name==='auth-boundary'){
      const login=new URL('/api/v1/auth/login',base); const session=new URL('/api/v1/control/session',base);
      const [a,b]=await Promise.all([fetch(login,{cache:'no-store',redirect:'manual'}),fetch(session,{cache:'no-store',redirect:'manual'})]);
      pass=a.status===405&&b.status===401; evidence=`login=${a.status},session=${b.status}`;
    }else if(name==='vault-source-authority'){
      pass=deployTail.includes('DEPLOY_STAGE=PROJECT_VAULT_SOURCE_SYNC')&&deployTail.includes('DEPLOY_STAGE=SOURCE_DRIFT_VERIFIED'); evidence=pass?'vault sync and drift verification passed':'vault/source proof missing';
    }else if(name==='desktop-release-identity'){
      const rows=Array.isArray(release?.desktopReleases)?release.desktopReleases:[]; pass=rows.length>0&&rows.every((row)=>row?.packageVerification==='VERIFIED'); evidence=pass?`verified=${rows.length}`:'desktop release evidence incomplete';
    }else{evidence='unknown journey';}
    results.push({name,status:pass?'PASS':'FAIL',evidence});
  }
  const status=results.every((item)=>item.status==='PASS')?'PASS':'FAIL';
  console.log(`MISSION_GOLDEN_JOURNEYS=${status}`);
  for(const item of results)console.log(`MISSION_JOURNEY_${item.name.replace(/[^A-Za-z0-9]+/g,'_').toUpperCase()}=${item.status}`);
  if(status!=='PASS')throw new Error('MISSION_GOLDEN_JOURNEY_FAILED');
  return {status,results};
}

export async function runMission(rawArgs=process.argv.slice(2)){
  const approved=rawArgs.includes('--approve');
  if(rawArgs.includes('--deploy')||rawArgs.includes('--dry-run')) throw new Error('MISSION_INTERNAL_FLAG_FORBIDDEN');
  const mode=missionModeFromArgs(rawArgs); const cleanup=rawArgs.includes('--cleanup-topology');
  const desktopRelease=desktopReleaseRequested(rawArgs);
  const trackRelease=mode==='--awh-core'||mode==='--platform-hardening';
  const unknown=rawArgs.filter((a)=>!['--approve','--cleanup-topology','--desktop-agent-release',...DEPLOY_MODES].includes(a));
  if(unknown.length) throw new Error(`MISSION_ARGUMENT_INVALID:${unknown[0]}`);
  const releaseTrack=mode==='--platform-hardening'?'vps-platform':'awh';
  const executionId=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(process.env.AWH_RELEASE_EXECUTION_ID??'')?String(process.env.AWH_RELEASE_EXECUTION_ID).toLowerCase():null;
  const scopeId=/^[a-z0-9][a-z0-9._:-]{7,127}$/i.test(process.env.AWH_SCOPE_ID??'')?String(process.env.AWH_SCOPE_ID):null;
  const startedAt=new Date().toISOString();
  missionContext={projectId:AWH_PROJECT_ID,releaseTrack,executionId,scopeId,startedAt};
  const head=(await git(['rev-parse','HEAD'])).toLowerCase(); const main=(await git(['rev-parse','refs/heads/main'])).toLowerCase();
  missionContext={projectId:AWH_PROJECT_ID,releaseTrack,executionId,scopeId,startedAt,releaseSha:head,canonicalMainAtStart:main};
  if(!SHA.test(head)||!SHA.test(main)) throw new Error('MISSION_SOURCE_IDENTITY_INVALID');
  if(head!==main){
    if(!trackRelease)throw new Error('MISSION_HEAD_NOT_CANONICAL_MAIN');
    const ancestor=await run('git',['merge-base','--is-ancestor',head,main]);
    if(ancestor.code!==0)throw new Error('MISSION_RELEASE_NOT_CANONICAL_ANCESTOR');
  }
  const dirty=await git(['status','--porcelain','--untracked-files=all']); if(dirty!=='') throw new Error('MISSION_SOURCE_NOT_CLEAN');
  const productionState=await resolveProduction(mode,head); const production=productionState.baseSha.toLowerCase();
  missionContext.baseSha=production; missionContext.trackRef=productionState.trackRef; missionContext.trackProductionSha=productionState.trackSha; missionContext.runtimeProductionSha=productionState.runtimeSha;
  if(productionState.allCurrent){console.log(`MISSION_RELEASE_SHA=${head}`);console.log('MISSION_STATE=ALREADY_CURRENT');console.log('MISSION_RESULT=PASS');return;}
  const forward=await run('git',['merge-base','--is-ancestor',production,head]);
  if(forward.code!==0)throw new Error('MISSION_RELEASE_NOT_FORWARD_FROM_RUNTIME');
  const changed=(await git(['diff','--name-only',`${production}..${head}`])).split(/\r?\n/).filter(Boolean); missionContext.changedFiles=changed.length; missionContext.changedPaths=changed.slice(0,80);
  let plan=await verificationPlanForFiles(changed); const staticEvalScenarios=await evalScenariosForFiles(changed); const durable=await durableRegressions(missionContext.changedPaths,{projectId:missionContext.projectId,releaseTrack:missionContext.releaseTrack}); const durableEvalScenarios=durable.ids; const evalScenarios=[...new Set([...staticEvalScenarios,...durableEvalScenarios])].sort();
  if(durableEvalScenarios.length>0){plan={...plan,riskLevel:plan.riskLevel==='CRITICAL'?'CRITICAL':'HIGH',budget:'DEEP',reasons:[...new Set([...(plan.reasons??[]),'durable-incident-regression'])],requiredChecks:[...new Set([...(plan.requiredChecks??[]),'regression','repeat-regression',...durable.requiredChecks])]};console.log('MISSION_REGRESSION_REPLAY=DEEP');} missionContext.riskLevel=plan.riskLevel; missionContext.budget=plan.budget;
  const desktopImpact=desktopImpactForFiles(changed);
  // Core/Web and Desktop Agent are independent release tracks. A source delta may
  // affect the desktop product without forcing every Core/Web cutover to rebuild
  // all native packages. Native desktop publication is explicit and continues to
  // require exact-SHA verified artifacts; otherwise Production carries forward
  // the already-verified desktop lineage from the active manifest.
  const publishDesktopArtifacts=desktopRelease;
  if(publishDesktopArtifacts){
    const downloads=join(ROOT,'dist-web','downloads');
    const completeArtifacts=DESKTOP_ARTIFACTS.every((f)=>existsSync(join(ROOT,f)));
    try{
      if(completeArtifacts){
        await verifyDesktopReleaseArtifacts(downloads,head);
        console.log('MISSION_DESKTOP_ARTIFACTS=VERIFIED_EXISTING');
      }else{
        console.log('MISSION_DESKTOP_ARTIFACTS=HYDRATING');
        const hydrated=await hydrateDesktopReleaseArtifacts({sourceRoot:ROOT,sourceSha:head});
        if(!DESKTOP_ARTIFACTS.every((f)=>existsSync(join(ROOT,f)))||hydrated.verified.length!==3)throw new Error('DESKTOP_ARTIFACT_MISSING');
        console.log(`MISSION_DESKTOP_ARTIFACTS=HYDRATED:${hydrated.verified.length}`);
      }
    }catch(error){
      const code=String(error?.code||error?.message||'DESKTOP_ARTIFACT_INVALID');
      if(code.startsWith('DESKTOP_ARTIFACT_MISSING'))throw new Error('MISSION_DESKTOP_ARTIFACT_BUILD_REQUIRED');
      throw new Error(`MISSION_DESKTOP_ARTIFACT_INVALID:${code}`);
    }
  }
  const reuse=!publishDesktopArtifacts;
  console.log(`MISSION_BASE_SHA=${production}`); console.log(`MISSION_RELEASE_SHA=${head}`); console.log(`MISSION_CHANGED_FILES=${changed.length}`);
  console.log(`MISSION_RISK=${plan.riskLevel}`); console.log(`MISSION_VERIFICATION_BUDGET=${plan.budget}`); console.log(`MISSION_REQUIRED_CHECKS=${plan.requiredChecks.join(',')}`); console.log(`MISSION_EVAL_SCENARIOS=${evalScenarios.join(',')}`);
  console.log(`MISSION_DESKTOP_DELTA=${desktopImpact?'YES':'NO'}`); console.log(`MISSION_DESKTOP_MODE=${reuse?'REUSE_VERIFIED':'NEW_ARTIFACTS'}`); console.log(`MISSION_MODE=${mode.slice(2)}`);
  const qa=await verifyByBudget(plan);
  await assertCanonicalMainStable(main);
  await ensureRehearsalDependencies(await loadExecutionPolicy());
  const common=['--owner-auth',mode]; if(cleanup)common.push('--cleanup-topology');
  const env={AWH_RELEASE_COMMIT:head,...(reuse?{AWH_REUSE_REMOTE_DESKTOP_ARTIFACTS:'1'}:{})};
  const rehearsal=await run(process.execPath,[GUARDED,'--dry-run',...common],{env,forward:true});
  if(rehearsal.code!==0||!rehearsal.tail.includes('_DRY_RUN=PASS')) throw new Error('MISSION_REHEARSAL_FAILED');
  console.log('MISSION_REHEARSAL=PASS');
  const baseCapsule={schemaVersion:1,kind:'release-verification',executionId,scopeId,projectId:AWH_PROJECT_ID,releaseTrack,baseSha:production,releaseSha:head,changedFileCount:changed.length,changedPaths:missionContext.changedPaths??[],intelligence:plan,evalScenarios,qa,rehearsal:'PASS',desktopMode:reuse?'REUSE_VERIFIED':'NEW_ARTIFACTS',startedAt,createdAt:new Date().toISOString()};
  if(!approved){await saveCapsule({...baseCapsule,state:'READY_FOR_APPROVAL',result:'REVIEW'});console.log('MISSION_STATE=READY_FOR_APPROVAL');console.log('MISSION_APPROVAL_REQUIRED=1');return;}
  console.log('MISSION_APPROVALS_CONSUMED=1');
  await assertCanonicalMainStable(main);
  const deploy=await run(process.execPath,[GUARDED,'--deploy','--approve',...common],{env,forward:true});
  const deployEvidence=deployEvidenceFromResult(deploy);
  missionContext.deploy=deployEvidence;
  if(deploy.code!==0||!deploy.tail.includes('DEPLOY_RESULT=PASS')||!deploy.tail.includes('DEPLOY_STAGE=BACKUP_VERIFIED')||!deploy.tail.includes('DEPLOY_STAGE=SOURCE_DRIFT_VERIFIED')) throw new Error('MISSION_DEPLOY_FAILED');
  missionContext.deploy={...deployEvidence,status:'PASS',backup:'PASS',sourceDrift:'PASS',failureCode:null};
  if(missionContext.registryAvailable!==true){const registry=await operatorRequest('verification-regressions',{changedPaths:missionContext.changedPaths??[]});if(!registry)throw new Error('MISSION_DURABLE_REGISTRY_UNAVAILABLE');missionContext.registryAvailable=true;console.log('MISSION_DURABLE_REGISTRY=READY_AFTER_CUTOVER');}
  const url=process.env.AWH_PUBLIC_RELEASE_URL||'https://kruart.online/release.json';
  const response=await fetch(url,{cache:'no-store'}); if(!response.ok)throw new Error('MISSION_PUBLIC_VERIFY_UNAVAILABLE');
  const release=await response.json(); if(release?.sourceSha!==head||release?.sourceState!=='COMMITTED')throw new Error('MISSION_PUBLIC_REVISION_MISMATCH');
  missionContext.publicRelease={releaseId:release.releaseId??null,sourceSha:release.sourceSha,sourceState:release.sourceState};
  const journeys=await goldenJourneys(plan,head,deploy.tail,release,url);
  await saveCapsule({...baseCapsule,state:'COMPLETED',result:'PASS',deploy:missionContext.deploy,publicRelease:{releaseId:release.releaseId??null,sourceSha:release.sourceSha,sourceState:release.sourceState},goldenJourneys:journeys,completedAt:new Date().toISOString()});
  console.log('MISSION_BACKUP=PASS'); console.log('MISSION_SOURCE_DRIFT=PASS'); console.log('MISSION_PUBLIC_VERIFY=PASS'); console.log('MISSION_STATE=COMPLETED'); console.log('MISSION_RESULT=PASS');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runMission().catch(async(error)=>{
    const code=String(error?.message||error).replace(/[^A-Za-z0-9_.:-]/g,'_').slice(0,160)||'MISSION_FAILED';
    const incident=await recordIncident(code,missionContext);
    try { await saveCapsule({schemaVersion:1,kind:'release-verification',...missionContext,state:'BLOCKED',result:'BLOCK',failure:{code,incident},completedAt:new Date().toISOString()}); } catch { /* incident evidence remains authoritative */ }
    console.error('MISSION_RESULT=BLOCKED'); console.error(`MISSION_REASON=${code}`); process.exit(1);
  });
}
