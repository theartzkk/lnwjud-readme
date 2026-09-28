import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, win32 as pathWin32 } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { WorkerToolProviderPacket, WorkerToolProvisionPlan } from './control-plane-worker-client.js';
import { execFile } from './process.js';
import { ToolPackClient } from './tool-pack-client.js';
import {
  activateVerifiedToolRelease,
  inspectToolLifecycle,
  readToolReleaseManifest,
  toolFabricCapabilityRoot,
  toolFabricReleaseRoot,
  writeVerifiedToolReleaseManifest,
} from './tool-fabric-lifecycle.js';

const NODE_VERSION='24.21.0';
const MAX_DOWNLOAD_BYTES=160*1024*1024;

export interface ManagedToolReady {
  capability:string;
  providerId:string;
  releaseKey:string;
  root:string;
  command:string;
  args:string[];
  env:NodeJS.ProcessEnv;
  runtimeKind:WorkerToolProvisionPlan['runtimeKind'];
}

function pathJoin(platform:NodeJS.Platform,...parts:string[]):string { return platform==='win32'?pathWin32.join(...parts):join(...parts); }
async function exists(path:string):Promise<boolean>{try{await access(path);return true;}catch{return false;}}

function releaseKey(plan:WorkerToolProvisionPlan):string {
  if(!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(plan.version)||!/^[0-9a-f]{40}$/.test(plan.revision)) throw new Error('MANAGED_TOOL_RELEASE_INVALID');
  return `${plan.version}-${plan.revision.slice(0,16)}`;
}

function localBase(platform:NodeJS.Platform,home:string,env:NodeJS.ProcessEnv):string {
  if(platform==='darwin') return join(home,'Library','Application Support','AWH');
  if(platform==='win32'&&env.LOCALAPPDATA) return pathWin32.join(env.LOCALAPPDATA,'AWH');
  if(platform==='linux') return join(home,'.local','share','AWH');
  throw new Error('MANAGED_TOOL_PLATFORM_UNSUPPORTED');
}

function toolchain(platform:NodeJS.Platform,arch:string,home:string,env:NodeJS.ProcessEnv):{node:string;npmCli:string} {
  const root=pathJoin(platform,localBase(platform,home,env),'Toolchain',`node-${NODE_VERSION}-${arch}`);
  return platform==='win32'
    ? {node:pathWin32.join(root,'node.exe'),npmCli:pathWin32.join(root,'node_modules','npm','bin','npm-cli.js')}
    : {node:join(root,'bin','node'),npmCli:join(root,'lib','node_modules','npm','bin','npm-cli.js')};
}

async function sha256File(path:string):Promise<string>{
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function acquireInstallLock(capability:string,key:string,platform:NodeJS.Platform,home:string,env:NodeJS.ProcessEnv):Promise<()=>Promise<void>>{
  const parent=pathJoin(platform,toolFabricCapabilityRoot(capability,platform,home,env),'locks');
  const lock=pathJoin(platform,parent,key+'.lock');
  await mkdir(parent,{recursive:true,mode:0o700});
  const deadline=Date.now()+330_000;
  for(;;){
    try{
      await mkdir(lock,{mode:0o700});
      await writeFile(pathJoin(platform,lock,'owner.json'),JSON.stringify({schemaVersion:1,pid:process.pid,acquiredAt:new Date().toISOString(),release:key})+'\n',{encoding:'utf8',mode:0o600});
      return async()=>{await rm(lock,{recursive:true,force:true});};
    }catch(error){
      const code=error&&typeof error==='object'&&'code' in error?String((error as {code?:unknown}).code??''):'';
      if(code!=='EEXIST')throw error;
      try{const info=await stat(lock);if(Date.now()-info.mtimeMs>600_000){await rm(lock,{recursive:true,force:true});continue;}}catch{continue;}
      if(Date.now()>=deadline)throw new Error('MANAGED_TOOL_INSTALL_LOCK_TIMEOUT');
      await new Promise((resolve)=>setTimeout(resolve,250));
    }
  }
}

async function downloadArtifact(url:string,destination:string,expectedSha:string):Promise<void>{
  if(!/^https:\/\/github\.com\//.test(url)||!/^[0-9a-f]{64}$/.test(expectedSha))throw new Error('MANAGED_TOOL_DOWNLOAD_CONTRACT_INVALID');
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),90_000);
  try{
    const response=await fetch(url,{redirect:'follow',signal:controller.signal,headers:{'User-Agent':'AWH-Agent-Tool-Fabric'}});
    if(!response.ok||!response.body)throw new Error('MANAGED_TOOL_DOWNLOAD_FAILED');
    const declared=Number(response.headers.get('content-length'));
    if(Number.isFinite(declared)&&(declared<1||declared>MAX_DOWNLOAD_BYTES))throw new Error('MANAGED_TOOL_DOWNLOAD_SIZE_INVALID');
    let bytes=0;
    const meter=new Transform({transform(chunk,_encoding,callback){bytes+=Buffer.byteLength(chunk);if(bytes>MAX_DOWNLOAD_BYTES){callback(new Error('MANAGED_TOOL_DOWNLOAD_TOO_LARGE'));return;}callback(null,chunk);}});
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),meter,createWriteStream(destination,{flags:'wx',mode:0o600}));
    if(bytes<1)throw new Error('MANAGED_TOOL_DOWNLOAD_EMPTY');
    const actual=await sha256File(destination);
    if(actual!==expectedSha)throw new Error('MANAGED_TOOL_INTEGRITY_MISMATCH');
  }catch(error){await rm(destination,{force:true}).catch(()=>undefined);throw error;}
  finally{clearTimeout(timer);}
}

async function extractBinary(plan:WorkerToolProvisionPlan,stage:string,archivePath:string,platform:NodeJS.Platform,home:string,env:NodeJS.ProcessEnv):Promise<string>{
  if(plan.provisionKind!=='GITHUB_RELEASE_BINARY'||!plan.artifact||!plan.executable)throw new Error('MANAGED_TOOL_BINARY_PLAN_INVALID');
  if(plan.artifact.archive==='tar.gz'){
    if(!['darwin','linux'].includes(platform))throw new Error('MANAGED_TOOL_ARCHIVE_PLATFORM_INVALID');
    const result=await execFile('/usr/bin/tar',['-xzf',archivePath,'-C',stage],home,60_000,env);
    if(result.code!==0)throw new Error('MANAGED_TOOL_EXTRACT_FAILED');
  }else{
    if(platform!=='win32')throw new Error('MANAGED_TOOL_ARCHIVE_PLATFORM_INVALID');
    const systemRoot=env.SystemRoot||env.SYSTEMROOT||'C:\\Windows';
    const powershell=pathWin32.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
    const result=await execFile(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command','Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force',archivePath,stage],home,60_000,env);
    if(result.code!==0)throw new Error('MANAGED_TOOL_EXTRACT_FAILED');
  }
  const executable=pathJoin(platform,stage,plan.executable);
  if(!await exists(executable))throw new Error('MANAGED_TOOL_EXECUTABLE_MISSING');
  if(platform!=='win32')await chmod(executable,0o700);
  return executable;
}

function safePackageParts(name:string):string[]{
  if(!/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(name))throw new Error('MANAGED_TOOL_PACKAGE_INVALID');
  return name.split('/');
}

async function installNpmCli(plan:WorkerToolProvisionPlan,stage:string,platform:NodeJS.Platform,arch:string,home:string,env:NodeJS.ProcessEnv):Promise<{command:string;args:string[]}>{
  if(plan.provisionKind!=='NPM_CLI'||!plan.packageName||!plan.integrity||!plan.bin)throw new Error('MANAGED_TOOL_NPM_PLAN_INVALID');
  const tc=toolchain(platform,arch,home,env);
  if(!await exists(tc.node)||!await exists(tc.npmCli))throw new Error('MANAGED_TOOL_NODE_TOOLCHAIN_UNAVAILABLE');
  await writeFile(pathJoin(platform,stage,'package.json'),JSON.stringify({private:true,dependencies:{[plan.packageName]:plan.version}},null,2)+'\n',{encoding:'utf8',mode:0o600});
  const result=await execFile(tc.node,[tc.npmCli,'install','--ignore-scripts','--no-audit','--no-fund','--save-exact'],stage,240_000,{...env,npm_config_update_notifier:'false',npm_config_fund:'false',npm_config_audit:'false'});
  if(result.code!==0)throw new Error('MANAGED_TOOL_NPM_INSTALL_FAILED');
  const lock=JSON.parse(await readFile(pathJoin(platform,stage,'package-lock.json'),'utf8')) as {packages?:Record<string,{version?:string;integrity?:string}>};
  const key='node_modules/'+plan.packageName;
  if(lock.packages?.[key]?.version!==plan.version||lock.packages?.[key]?.integrity!==plan.integrity)throw new Error('MANAGED_TOOL_NPM_INTEGRITY_MISMATCH');
  const packageRoot=pathJoin(platform,stage,'node_modules',...safePackageParts(plan.packageName));
  const packageJson=JSON.parse(await readFile(pathJoin(platform,packageRoot,'package.json'),'utf8')) as {bin?:string|Record<string,string>};
  const relative=typeof packageJson.bin==='string'?packageJson.bin:packageJson.bin?.[plan.bin];
  if(typeof relative!=='string'||relative.startsWith('/')||relative.startsWith('\\')||relative.split(/[\\/]+/).includes('..'))throw new Error('MANAGED_TOOL_NPM_BIN_INVALID');
  const entry=pathJoin(platform,packageRoot,...relative.split(/[\\/]+/));
  if(!await exists(entry))throw new Error('MANAGED_TOOL_NPM_BIN_MISSING');
  return {command:tc.node,args:[entry]};
}

function relocateLaunch(value:string,from:string,to:string):string {
  return value===from?to:value.startsWith(from)?to+value.slice(from.length):value;
}

function packetEnv(packet:WorkerToolProviderPacket,base:NodeJS.ProcessEnv):NodeJS.ProcessEnv {
  const extra:NodeJS.ProcessEnv={};
  if(packet.credential){
    if(packet.plan.credentialEnv!==packet.credential.envName)throw new Error('MANAGED_TOOL_CREDENTIAL_MISMATCH');
    extra[packet.credential.envName]=packet.credential.value;
  }else if(packet.plan.authProviderId!==null)throw new Error('MANAGED_TOOL_CREDENTIAL_REQUIRED');
  return {...base,...extra,AWH_TOOL_FABRIC_CAPABILITY:packet.capability,AWH_TOOL_FABRIC_PROVIDER:packet.plan.providerId,AWH_TOOL_FABRIC_REVISION:packet.plan.revision};
}

async function smokeManaged(plan:WorkerToolProvisionPlan,command:string,args:string[],root:string,extraEnv:NodeJS.ProcessEnv):Promise<void>{
  if(plan.runtimeKind==='MCP'){
    const client=await ToolPackClient.openManaged(plan.providerId,command,args,root,extraEnv);
    try{const tools=await client.listTools();if(tools.length<1)throw new Error('MANAGED_TOOL_MCP_SMOKE_EMPTY');}
    finally{client.close();}
    return;
  }
  if(plan.runtimeKind==='CLI'){
    const result=await execFile(command,[...args,'--help'],root,30_000,extraEnv);
    if(result.code!==0)throw new Error('MANAGED_TOOL_CLI_SMOKE_FAILED');
    return;
  }
  throw new Error('MANAGED_TOOL_RUNTIME_KIND_UNSUPPORTED');
}

export async function ensureManagedToolReady(
  packet:WorkerToolProviderPacket,
  platform:NodeJS.Platform=process.platform,
  arch:string=process.arch,
  home=homedir(),
  env:NodeJS.ProcessEnv=process.env,
):Promise<ManagedToolReady>{
  if(packet.capability!==packet.plan.capability)throw new Error('MANAGED_TOOL_CAPABILITY_MISMATCH');
  const plan=packet.plan;const key=releaseKey(plan);
  const root=toolFabricReleaseRoot(plan.capability,key,platform,home,env);
  const runtimeEnv=packetEnv(packet,env);
  const existing=await readToolReleaseManifest(plan.capability,key,platform,home,env);
  if(existing){
    if(existing.providerId!==plan.providerId||existing.version!==plan.version||existing.revision!==plan.revision||!existing.launch)throw new Error('MANAGED_TOOL_VERIFIED_RELEASE_MISMATCH');
    await activateVerifiedToolRelease(plan.capability,key,platform,home,env);
    return {capability:plan.capability,providerId:plan.providerId,releaseKey:key,root,command:existing.launch.command,args:[...existing.launch.args],env:runtimeEnv,runtimeKind:plan.runtimeKind};
  }
  const release=await acquireInstallLock(plan.capability,key,platform,home,env);
  try{
    const afterLock=await readToolReleaseManifest(plan.capability,key,platform,home,env);
    if(afterLock?.launch){
      if(afterLock.providerId!==plan.providerId||afterLock.version!==plan.version||afterLock.revision!==plan.revision)throw new Error('MANAGED_TOOL_VERIFIED_RELEASE_MISMATCH');
      await activateVerifiedToolRelease(plan.capability,key,platform,home,env);
      return {capability:plan.capability,providerId:plan.providerId,releaseKey:key,root,command:afterLock.launch.command,args:[...afterLock.launch.args],env:runtimeEnv,runtimeKind:plan.runtimeKind};
    }
    const parent=platform==='win32'?pathWin32.dirname(root):dirname(root);
    await mkdir(parent,{recursive:true,mode:0o700});
    if(await exists(root))await rm(root,{recursive:true,force:true});
    const stage=root+`.stage-${process.pid}-${Date.now()}`;
    const download=root+`.download-${process.pid}-${Date.now()}`;
    await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true,mode:0o700});
    let stagedLaunch:{command:string;args:string[]};
    try{
      if(plan.provisionKind==='GITHUB_RELEASE_BINARY'){
        if(!plan.artifact)throw new Error('MANAGED_TOOL_BINARY_ARTIFACT_MISSING');
        await downloadArtifact(plan.artifact.url,download,plan.artifact.sha256);
        const executable=await extractBinary(plan,stage,download,platform,home,env);
        stagedLaunch={command:executable,args:[...(plan.args??[])]};
      }else{
        stagedLaunch=await installNpmCli(plan,stage,platform,arch,home,env);
      }
      await rm(download,{force:true});
      await rename(stage,root);
    }catch(error){await rm(download,{force:true}).catch(()=>undefined);await rm(stage,{recursive:true,force:true}).catch(()=>undefined);throw error;}
    const command=relocateLaunch(stagedLaunch.command,stage,root);
    const args=stagedLaunch.args.map((value)=>relocateLaunch(value,stage,root));
    try{await smokeManaged(plan,command,args,root,runtimeEnv);}
    catch(error){await rm(root,{recursive:true,force:true}).catch(()=>undefined);throw error;}
    await writeVerifiedToolReleaseManifest({
      schemaVersion:1,kind:'AWH_TOOL_RELEASE',capability:plan.capability,providerId:plan.providerId,releaseKey:key,channel:'stable',
      version:plan.version,revision:plan.revision,license:plan.license,verificationState:'VERIFIED',
      checks:{integrity:'PASS',smoke:'PASS',capabilityContract:'PASS',rollback:'READY'},launch:{command,args},
    },platform,home,env);
    await activateVerifiedToolRelease(plan.capability,key,platform,home,env);
    return {capability:plan.capability,providerId:plan.providerId,releaseKey:key,root,command,args,env:runtimeEnv,runtimeKind:plan.runtimeKind};
  }finally{await release();}
}

export async function openManagedMcpTool(packet:WorkerToolProviderPacket):Promise<{ready:ManagedToolReady;client:ToolPackClient}>{
  const ready=await ensureManagedToolReady(packet);
  if(ready.runtimeKind!=='MCP')throw new Error('MANAGED_TOOL_NOT_MCP');
  const client=await ToolPackClient.openManaged(ready.providerId,ready.command,ready.args,ready.root,ready.env);
  return {ready,client};
}
