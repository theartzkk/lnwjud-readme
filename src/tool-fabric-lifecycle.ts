import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, win32 as pathWin32 } from 'node:path';

const CAPABILITY=/^[a-z][a-z0-9:._-]{0,63}$/;
const RELEASE=/^[A-Za-z0-9._-]{1,160}$/;
const SHA=/^[0-9a-f]{40,64}$/;
const LICENSE=/^[A-Za-z0-9.+-]{2,80}$/;

export type ToolLifecycleState='DISCOVERED'|'REVIEWED'|'APPROVED'|'PREVIEW'|'STABLE'|'REJECTED'|'RETIRED';
export type ToolReleaseChannel='preview'|'stable';

export interface ToolReleaseManifest {
  schemaVersion:1;
  kind:'AWH_TOOL_RELEASE';
  capability:string;
  providerId:string;
  releaseKey:string;
  channel:ToolReleaseChannel;
  version:string|null;
  revision:string|null;
  license:string;
  verificationState:'VERIFIED';
  checks:{
    integrity:'PASS';
    smoke:'PASS';
    capabilityContract:'PASS';
    rollback:'READY';
  };
  launch?:{
    command:string;
    args:string[];
  };
}

export interface ToolLifecycleStatus {
  capability:string;
  current:ToolReleaseManifest|null;
  previous:ToolReleaseManifest|null;
  state:'UNINSTALLED'|'PREVIEW'|'STABLE';
}

function localBase(platform:NodeJS.Platform,home:string,env:NodeJS.ProcessEnv):string {
  if(platform==='darwin') return join(home,'Library','Application Support','AWH');
  if(platform==='win32'&&env.LOCALAPPDATA) return pathWin32.join(env.LOCALAPPDATA,'AWH');
  if(platform==='linux') return join(home,'.local','share','AWH');
  throw new Error('TOOL_FABRIC_PLATFORM_UNSUPPORTED');
}

function pathJoin(platform:NodeJS.Platform,...parts:string[]):string {
  return platform==='win32'?pathWin32.join(...parts):join(...parts);
}

function validCapability(value:string):string {
  if(!CAPABILITY.test(value)) throw new Error('TOOL_FABRIC_CAPABILITY_INVALID');
  return value;
}

function validRelease(value:string):string {
  if(!RELEASE.test(value)||value==='.'||value==='..') throw new Error('TOOL_FABRIC_RELEASE_INVALID');
  return value;
}

export function toolFabricCapabilityRoot(capability:string,platform:NodeJS.Platform=process.platform,home=homedir(),env:NodeJS.ProcessEnv=process.env):string {
  return pathJoin(platform,localBase(platform,home,env),'ToolPacks',validCapability(capability));
}

export function toolFabricReleaseRoot(capability:string,releaseKey:string,platform:NodeJS.Platform=process.platform,home=homedir(),env:NodeJS.ProcessEnv=process.env):string {
  return pathJoin(platform,toolFabricCapabilityRoot(capability,platform,home,env),'releases',validRelease(releaseKey));
}

function manifestPath(capability:string,releaseKey:string,platform:NodeJS.Platform,home:string,env:NodeJS.ProcessEnv):string {
  return pathJoin(platform,toolFabricReleaseRoot(capability,releaseKey,platform,home,env),'awh-tool-release.json');
}

function pointerPath(capability:string,name:'current'|'previous',platform:NodeJS.Platform,home:string,env:NodeJS.ProcessEnv):string {
  return pathJoin(platform,toolFabricCapabilityRoot(capability,platform,home,env),name);
}

export function validateToolReleaseManifest(value:unknown):ToolReleaseManifest {
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('TOOL_FABRIC_RELEASE_MANIFEST_INVALID');
  const row=value as Record<string,unknown>;
  if(row.schemaVersion!==1||row.kind!=='AWH_TOOL_RELEASE') throw new Error('TOOL_FABRIC_RELEASE_MANIFEST_INVALID');
  if(typeof row.capability!=='string'||!CAPABILITY.test(row.capability)) throw new Error('TOOL_FABRIC_RELEASE_CAPABILITY_INVALID');
  if(typeof row.providerId!=='string'||!RELEASE.test(row.providerId)) throw new Error('TOOL_FABRIC_PROVIDER_INVALID');
  if(typeof row.releaseKey!=='string'||!RELEASE.test(row.releaseKey)) throw new Error('TOOL_FABRIC_RELEASE_INVALID');
  if(!['preview','stable'].includes(String(row.channel))) throw new Error('TOOL_FABRIC_RELEASE_CHANNEL_INVALID');
  if(row.version!==null&&(typeof row.version!=='string'||row.version.length<1||row.version.length>80)) throw new Error('TOOL_FABRIC_RELEASE_VERSION_INVALID');
  if(row.revision!==null&&(typeof row.revision!=='string'||!SHA.test(row.revision))) throw new Error('TOOL_FABRIC_RELEASE_REVISION_INVALID');
  if(typeof row.license!=='string'||!LICENSE.test(row.license)) throw new Error('TOOL_FABRIC_RELEASE_LICENSE_INVALID');
  if(row.verificationState!=='VERIFIED') throw new Error('TOOL_FABRIC_RELEASE_NOT_VERIFIED');
  if(!row.checks||typeof row.checks!=='object'||Array.isArray(row.checks)) throw new Error('TOOL_FABRIC_RELEASE_CHECKS_INVALID');
  const checks=row.checks as Record<string,unknown>;
  if(checks.integrity!=='PASS'||checks.smoke!=='PASS'||checks.capabilityContract!=='PASS'||checks.rollback!=='READY') throw new Error('TOOL_FABRIC_RELEASE_CHECKS_INVALID');
  if(row.launch!==undefined){
    if(!row.launch||typeof row.launch!=='object'||Array.isArray(row.launch)) throw new Error('TOOL_FABRIC_RELEASE_LAUNCH_INVALID');
    const launch=row.launch as Record<string,unknown>;
    if(typeof launch.command!=='string'||launch.command.length<1||launch.command.length>300||!Array.isArray(launch.args)||launch.args.length>32||launch.args.some((v)=>typeof v!=='string'||v.length>500)) throw new Error('TOOL_FABRIC_RELEASE_LAUNCH_INVALID');
  }
  return row as unknown as ToolReleaseManifest;
}

async function atomicText(path:string,value:string):Promise<void> {
  await mkdir(pathJoin(process.platform==='win32'?'win32':process.platform, path.substring(0,path.lastIndexOf(process.platform==='win32'?'\\':'/'))),{recursive:true,mode:0o700}).catch(()=>undefined);
  const temp=path+'.tmp-'+process.pid+'-'+Date.now();
  await writeFile(temp,value,{encoding:'utf8',mode:0o600});
  await rename(temp,path);
}

async function readPointer(capability:string,name:'current'|'previous',platform:NodeJS.Platform,home:string,env:NodeJS.ProcessEnv):Promise<string|null> {
  try {
    const value=(await readFile(pointerPath(capability,name,platform,home,env),'utf8')).trim();
    return RELEASE.test(value)?value:null;
  } catch { return null; }
}

export async function writeVerifiedToolReleaseManifest(manifest:ToolReleaseManifest,platform:NodeJS.Platform=process.platform,home=homedir(),env:NodeJS.ProcessEnv=process.env):Promise<string> {
  const verified=validateToolReleaseManifest(manifest);
  const root=toolFabricReleaseRoot(verified.capability,verified.releaseKey,platform,home,env);
  await mkdir(root,{recursive:true,mode:0o700});
  await writeFile(manifestPath(verified.capability,verified.releaseKey,platform,home,env),JSON.stringify(verified,null,2)+'\n',{encoding:'utf8',mode:0o600});
  return root;
}

export async function readToolReleaseManifest(capability:string,releaseKey:string,platform:NodeJS.Platform=process.platform,home=homedir(),env:NodeJS.ProcessEnv=process.env):Promise<ToolReleaseManifest|null> {
  try {
    const parsed=JSON.parse(await readFile(manifestPath(validCapability(capability),validRelease(releaseKey),platform,home,env),'utf8'));
    const manifest=validateToolReleaseManifest(parsed);
    return manifest.capability===capability&&manifest.releaseKey===releaseKey?manifest:null;
  } catch { return null; }
}

export async function activateVerifiedToolRelease(capability:string,releaseKey:string,platform:NodeJS.Platform=process.platform,home=homedir(),env:NodeJS.ProcessEnv=process.env):Promise<void> {
  validCapability(capability); validRelease(releaseKey);
  const manifest=await readToolReleaseManifest(capability,releaseKey,platform,home,env);
  if(!manifest) throw new Error('TOOL_FABRIC_RELEASE_NOT_VERIFIED');
  const root=toolFabricCapabilityRoot(capability,platform,home,env);
  await mkdir(root,{recursive:true,mode:0o700});
  const current=await readPointer(capability,'current',platform,home,env);
  if(current===releaseKey) return;
  if(current){
    const currentManifest=await readToolReleaseManifest(capability,current,platform,home,env);
    if(currentManifest) await atomicText(pointerPath(capability,'previous',platform,home,env),current+'\n');
  }
  await atomicText(pointerPath(capability,'current',platform,home,env),releaseKey+'\n');
}

export async function rollbackVerifiedToolRelease(capability:string,platform:NodeJS.Platform=process.platform,home=homedir(),env:NodeJS.ProcessEnv=process.env):Promise<ToolReleaseManifest> {
  validCapability(capability);
  const previous=await readPointer(capability,'previous',platform,home,env);
  if(!previous) throw new Error('TOOL_FABRIC_ROLLBACK_UNAVAILABLE');
  const previousManifest=await readToolReleaseManifest(capability,previous,platform,home,env);
  if(!previousManifest) throw new Error('TOOL_FABRIC_ROLLBACK_UNVERIFIED');
  const current=await readPointer(capability,'current',platform,home,env);
  await atomicText(pointerPath(capability,'current',platform,home,env),previous+'\n');
  if(current){
    const currentManifest=await readToolReleaseManifest(capability,current,platform,home,env);
    if(currentManifest) await atomicText(pointerPath(capability,'previous',platform,home,env),current+'\n');
  }
  return previousManifest;
}

export async function inspectToolLifecycle(capability:string,platform:NodeJS.Platform=process.platform,home=homedir(),env:NodeJS.ProcessEnv=process.env):Promise<ToolLifecycleStatus> {
  validCapability(capability);
  const currentKey=await readPointer(capability,'current',platform,home,env);
  const previousKey=await readPointer(capability,'previous',platform,home,env);
  const current=currentKey?await readToolReleaseManifest(capability,currentKey,platform,home,env):null;
  const previous=previousKey?await readToolReleaseManifest(capability,previousKey,platform,home,env):null;
  return {capability,current,previous,state:current?.channel==='stable'?'STABLE':current?.channel==='preview'?'PREVIEW':'UNINSTALLED'};
}

export async function managedStableCapabilities(platform:NodeJS.Platform=process.platform,home=homedir(),env:NodeJS.ProcessEnv=process.env):Promise<string[]> {
  const root=pathJoin(platform,localBase(platform,home,env),'ToolPacks');
  let names:string[]=[];
  try { names=(await readdir(root,{withFileTypes:true})).filter((entry)=>entry.isDirectory()&&CAPABILITY.test(entry.name)).map((entry)=>entry.name); }
  catch { return []; }
  const capabilities:string[]=[];
  for(const capability of names){
    const status=await inspectToolLifecycle(capability,platform,home,env);
    if(status.current?.channel==='stable'&&status.current.verificationState==='VERIFIED') capabilities.push(capability);
  }
  return capabilities.sort();
}
