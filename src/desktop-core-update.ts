import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, chmod, cp, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 as pathWin32 } from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { extractFile } from '@electron/asar';
import { compareVersions, parseVersion, type DesktopUpdateChannel } from './desktop-update-policy.js';

const SHA256=/^[0-9a-f]{64}$/;
const GIT_SHA=/^[0-9a-f]{40}$/;
const MAX_PACKAGE_BYTES=1024*1024*1024;
const UPDATE_DIR='core-updates';

export interface DesktopCoreUpdateCandidate {
  schemaVersion:1; channel:DesktopUpdateChannel; version:string; sourceSha:string;
  packageSha256:string; sizeBytes:number; packagePath:string; packageUrl:string;
  releaseId:string; publishedAt:string;
}
export interface StagedDesktopCoreUpdate extends DesktopCoreUpdateCandidate {
  stageRoot:string; packageFile:string; extractedAppRoot:string;
}

export function effectiveDesktopUpdateChannel(version:string):DesktopUpdateChannel{
  return parseVersion(version)[3]===null?'stable':'preview';
}

export function desktopPackagePath(platform:NodeJS.Platform,arch:string):string{
  if(platform==='darwin'&&arch==='arm64')return 'downloads/AWH-macOS-arm64.zip';
  if(platform==='darwin'&&arch==='x64')return 'downloads/AWH-macOS-x64.zip';
  if(platform==='win32'&&arch==='x64')return 'downloads/AWH-Windows-x64.zip';
  throw new Error('CORE_UPDATE_PLATFORM_UNSUPPORTED');
}

function exactObject(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('CORE_UPDATE_RELEASE_INVALID');
  return value as Record<string,unknown>;
}

export function resolveDesktopCoreUpdateCandidate(
  value:unknown,currentVersion:string,platform:NodeJS.Platform=process.platform,
  arch:string=process.arch,origin='https://kruart.online',
):DesktopCoreUpdateCandidate|null{
  const release=exactObject(value);
  if(release.schemaVersion!==1||release.sourceState!=='COMMITTED'||typeof release.releaseId!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(release.releaseId)||typeof release.sourceSha!=='string'||!GIT_SHA.test(release.sourceSha)||typeof release.generatedAt!=='string'||!Number.isFinite(Date.parse(release.generatedAt)))throw new Error('CORE_UPDATE_RELEASE_INVALID');
  if(!Array.isArray(release.files)||!Array.isArray(release.desktopReleases))throw new Error('CORE_UPDATE_RELEASE_INVALID');
  const packagePath=desktopPackagePath(platform,arch);
  const files=release.files.filter((item)=>item&&typeof item==='object'&&!Array.isArray(item)&&(item as Record<string,unknown>).path===packagePath);
  const proofs=release.desktopReleases.filter((item)=>item&&typeof item==='object'&&!Array.isArray(item)&&(item as Record<string,unknown>).path===packagePath);
  if(files.length!==1||proofs.length!==1)return null;
  const file=files[0] as Record<string,unknown>,proof=proofs[0] as Record<string,unknown>;
  if(typeof file.sha256!=='string'||!SHA256.test(file.sha256)||!Number.isSafeInteger(file.sizeBytes)||Number(file.sizeBytes)<1||Number(file.sizeBytes)>MAX_PACKAGE_BYTES)throw new Error('CORE_UPDATE_PACKAGE_EVIDENCE_INVALID');
  if(proof.packageVerification!=='VERIFIED'||typeof proof.sourceSha!=='string'||!GIT_SHA.test(proof.sourceSha)||proof.packageSha256!==file.sha256||proof.sizeBytes!==file.sizeBytes||typeof proof.productVersion!=='string')throw new Error('CORE_UPDATE_PACKAGE_EVIDENCE_INVALID');
  parseVersion(proof.productVersion);
  const channel=effectiveDesktopUpdateChannel(proof.productVersion);
  if(channel==='preview'&&effectiveDesktopUpdateChannel(currentVersion)!=='preview')return null;
  if(compareVersions(currentVersion,proof.productVersion)>=0)return null;
  const currentMajor=parseVersion(currentVersion)[0],nextMajor=parseVersion(proof.productVersion)[0];
  if(currentMajor!==nextMajor)throw new Error('CORE_UPDATE_MAJOR_REINSTALL_REQUIRED');
  const base=new URL(origin);
  if(base.protocol!=='https:'||base.username||base.password)throw new Error('CORE_UPDATE_ORIGIN_INVALID');
  return {schemaVersion:1,channel,version:proof.productVersion,sourceSha:proof.sourceSha,packageSha256:file.sha256,sizeBytes:Number(file.sizeBytes),packagePath,packageUrl:new URL('/'+packagePath,base.origin).toString(),releaseId:release.releaseId,publishedAt:release.generatedAt};
}

export function coreUpdateRoot(dataDir:string):string{return join(dataDir,UPDATE_DIR);}

async function sha256File(path:string):Promise<string>{
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path))hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function downloadVerified(candidate:DesktopCoreUpdateCandidate,destination:string,fetchImpl:typeof fetch):Promise<void>{
  const response=await fetchImpl(candidate.packageUrl,{redirect:'follow',cache:'no-store',credentials:'omit'});
  if(!response.ok||!response.body)throw new Error('CORE_UPDATE_DOWNLOAD_FAILED');
  const finalUrl=new URL(response.url||candidate.packageUrl);
  if(finalUrl.protocol!=='https:'||finalUrl.origin!==new URL(candidate.packageUrl).origin)throw new Error('CORE_UPDATE_DOWNLOAD_ORIGIN_CHANGED');
  const length=Number(response.headers.get('content-length')??'0');
  if(length>0&&length!==candidate.sizeBytes)throw new Error('CORE_UPDATE_DOWNLOAD_SIZE_MISMATCH');
  await pipeline(Readable.fromWeb(response.body as never),createWriteStream(destination,{flags:'wx',mode:0o600}));
  const info=await stat(destination);
  if(!info.isFile()||info.size!==candidate.sizeBytes||await sha256File(destination)!==candidate.packageSha256)throw new Error('CORE_UPDATE_DOWNLOAD_INTEGRITY_FAILED');
}

async function runFixed(command:string,args:string[],timeoutMs=120000):Promise<void>{
  await new Promise<void>((resolveRun,rejectRun)=>{
    const child=spawn(command,args,{shell:false,windowsHide:true,stdio:['ignore','ignore','pipe']});
    let stderr='',settled=false;
    const timer=setTimeout(()=>{if(settled)return;settled=true;child.kill();rejectRun(new Error('CORE_UPDATE_PROCESS_TIMEOUT'));},timeoutMs);
    child.stderr.on('data',(chunk)=>{if(stderr.length<2048)stderr+=String(chunk).slice(0,2048-stderr.length);});
    child.once('error',()=>{if(settled)return;settled=true;clearTimeout(timer);rejectRun(new Error('CORE_UPDATE_PROCESS_FAILED'));});
    child.once('close',(code)=>{if(settled)return;settled=true;clearTimeout(timer);if(code===0)resolveRun();else rejectRun(new Error('CORE_UPDATE_PROCESS_FAILED_'+String(code??-1)+'_'+stderr.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,80)));});
  });
}

async function extractPackage(archive:string,destination:string,platform:NodeJS.Platform):Promise<void>{
  await mkdir(destination,{recursive:true,mode:0o700});
  if(platform==='darwin'){await runFixed('/usr/bin/ditto',['-x','-k',archive,destination]);return;}
  if(platform==='win32'){
    const powershell='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    const script='param([string]$Archive,[string]$Destination) $ErrorActionPreference="Stop"; Expand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force';
    await runFixed(powershell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script,'-Archive',archive,'-Destination',destination]);
    return;
  }
  throw new Error('CORE_UPDATE_PLATFORM_UNSUPPORTED');
}

async function findStagedApp(root:string,platform:NodeJS.Platform,depth=4):Promise<string|null>{
  if(depth<0)return null;
  const entries=await readdir(root,{withFileTypes:true});
  for(const entry of entries){
    if(platform==='darwin'&&entry.isDirectory()&&entry.name==='AWH Agent.app')return join(root,entry.name);
    if(platform==='win32'&&entry.isFile()&&entry.name==='AWH.exe')return root;
  }
  for(const entry of entries){if(entry.isDirectory()){const found=await findStagedApp(join(root,entry.name),platform,depth-1);if(found)return found;}}
  return null;
}

function asarPath(appRoot:string,platform:NodeJS.Platform):string{
  return platform==='darwin'?join(appRoot,'Contents','Resources','app.asar'):join(appRoot,'resources','app.asar');
}

async function verifyStagedApp(appRoot:string,candidate:DesktopCoreUpdateCandidate,platform:NodeJS.Platform):Promise<void>{
  const archive=asarPath(appRoot,platform);
  const info=await lstat(archive);
  if(!info.isFile()||info.isSymbolicLink())throw new Error('CORE_UPDATE_APP_ASAR_INVALID');
  let pkg:Record<string,unknown>;
  try{pkg=JSON.parse(extractFile(archive,'package.json').toString('utf8')) as Record<string,unknown>;}catch{throw new Error('CORE_UPDATE_APP_ASAR_INVALID');}
  if(pkg.version!==candidate.version||pkg.productName!=='Art’s Workspace Hub')throw new Error('CORE_UPDATE_APP_IDENTITY_MISMATCH');
}

export async function stageDesktopCoreUpdate(candidate:DesktopCoreUpdateCandidate,dataDir:string,fetchImpl:typeof fetch=fetch,platform:NodeJS.Platform=process.platform):Promise<StagedDesktopCoreUpdate>{
  const key=candidate.version+'-'+candidate.sourceSha.slice(0,12);
  const stageRoot=join(coreUpdateRoot(dataDir),'staging',key);
  await rm(stageRoot,{recursive:true,force:true});await mkdir(stageRoot,{recursive:true,mode:0o700});
  const packageFile=join(stageRoot,'package.zip');await downloadVerified(candidate,packageFile,fetchImpl);
  const extracted=join(stageRoot,'extracted');await extractPackage(packageFile,extracted,platform);
  const extractedAppRoot=await findStagedApp(extracted,platform);
  if(!extractedAppRoot)throw new Error('CORE_UPDATE_APP_NOT_FOUND');
  await verifyStagedApp(extractedAppRoot,candidate,platform);
  await writeFile(join(stageRoot,'stage.json'),JSON.stringify({kind:'AWH_CORE_UPDATE_STAGE',...candidate,verifiedAt:new Date().toISOString()},null,2)+'\n',{encoding:'utf8',mode:0o600});
  return {...candidate,stageRoot,packageFile,extractedAppRoot};
}

export function currentApplicationRoot(platform:NodeJS.Platform=process.platform,execPath=process.execPath):string{
  if(platform==='win32')return pathWin32.dirname(execPath);
  if(platform==='darwin'){
    const marker='.app'+sep+'Contents'+sep+'MacOS'+sep,index=execPath.indexOf(marker);
    if(index<0)throw new Error('CORE_UPDATE_APP_ROOT_UNAVAILABLE');
    return execPath.slice(0,index+4);
  }
  throw new Error('CORE_UPDATE_PLATFORM_UNSUPPORTED');
}

function executableRelative(appRoot:string,execPath:string):string{
  const value=relative(appRoot,execPath);
  if(!value||value.startsWith('..')||isAbsolute(value))throw new Error('CORE_UPDATE_EXECUTABLE_INVALID');
  return value;
}

const MAC_HELPER=[
  '#!/bin/sh','set -eu',
  'PID="$1"; CURRENT="$2"; NEXT="$3"; PREVIOUS="$4"; EXE_REL="$5"; HEALTH="$6"; RESULT="$7"',
  'i=0','while kill -0 "$PID" 2>/dev/null; do i=$((i+1)); [ "$i" -gt 240 ] && exit 30; sleep 0.25; done',
  'rm -rf "$PREVIOUS"',
  'if ! mv "$CURRENT" "$PREVIOUS"; then printf \'{"state":"SWAP_FAILED"}\\n\' > "$RESULT"; exit 31; fi',
  'if ! mv "$NEXT" "$CURRENT"; then mv "$PREVIOUS" "$CURRENT"; printf \'{"state":"ROLLBACK","reason":"SWAP_FAILED"}\\n\' > "$RESULT"; exit 32; fi',
  'rm -f "$HEALTH"',
  '"$CURRENT/$EXE_REL" --awh-core-update-health "$HEALTH" >/dev/null 2>&1 &','NEWPID=$!','i=0',
  'while [ "$i" -lt 120 ]; do if [ -f "$HEALTH" ] && grep -q \'"ok":true\' "$HEALTH"; then printf \'{"state":"UPDATED"}\\n\' > "$RESULT"; exit 0; fi; if ! kill -0 "$NEWPID" 2>/dev/null; then break; fi; i=$((i+1)); sleep 0.25; done',
  'kill "$NEWPID" 2>/dev/null || true','wait "$NEWPID" 2>/dev/null || true','rm -rf "$CURRENT"','mv "$PREVIOUS" "$CURRENT"',
  '"$CURRENT/$EXE_REL" >/dev/null 2>&1 &','printf \'{"state":"ROLLBACK","reason":"HEALTH_FAILED"}\\n\' > "$RESULT"','exit 33'
].join('\n')+'\n';

const WINDOWS_HELPER=[
  'param([int]$Pid,[string]$Current,[string]$Next,[string]$Previous,[string]$ExeRelative,[string]$Health,[string]$Result)',
  '$ErrorActionPreference="Stop"',
  'for($i=0;$i -lt 240;$i++){if(-not (Get-Process -Id $Pid -ErrorAction SilentlyContinue)){break};Start-Sleep -Milliseconds 250}',
  'if(Get-Process -Id $Pid -ErrorAction SilentlyContinue){exit 30}',
  'if(Test-Path -LiteralPath $Previous){Remove-Item -LiteralPath $Previous -Recurse -Force}',
  'try{Rename-Item -LiteralPath $Current -NewName ([IO.Path]::GetFileName($Previous)) -ErrorAction Stop}catch{Set-Content -LiteralPath $Result -Value \'{"state":"SWAP_FAILED"}\';exit 31}',
  'try{Rename-Item -LiteralPath $Next -NewName ([IO.Path]::GetFileName($Current)) -ErrorAction Stop}catch{Rename-Item -LiteralPath $Previous -NewName ([IO.Path]::GetFileName($Current));Set-Content -LiteralPath $Result -Value \'{"state":"ROLLBACK","reason":"SWAP_FAILED"}\';exit 32}',
  'Remove-Item -LiteralPath $Health -Force -ErrorAction SilentlyContinue','$exe=Join-Path $Current $ExeRelative',
  '$child=Start-Process -FilePath $exe -ArgumentList @("--awh-core-update-health",$Health) -PassThru',
  'for($i=0;$i -lt 120;$i++){if(Test-Path -LiteralPath $Health){$text=Get-Content -Raw -LiteralPath $Health;if($text -match \'"ok":true\'){Set-Content -LiteralPath $Result -Value \'{"state":"UPDATED"}\';exit 0}};if($child.HasExited){break};Start-Sleep -Milliseconds 250}',
  'if(-not $child.HasExited){Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue}',
  'Remove-Item -LiteralPath $Current -Recurse -Force','Rename-Item -LiteralPath $Previous -NewName ([IO.Path]::GetFileName($Current))',
  'Start-Process -FilePath (Join-Path $Current $ExeRelative)','Set-Content -LiteralPath $Result -Value \'{"state":"ROLLBACK","reason":"HEALTH_FAILED"}\'','exit 33'
].join('\r\n')+'\r\n';

export async function prepareDesktopCoreUpdateSwap(staged:StagedDesktopCoreUpdate,dataDir:string,platform:NodeJS.Platform=process.platform,execPath=process.execPath):Promise<{helper:string;args:string[];currentRoot:string;nextRoot:string;previousRoot:string;healthMarker:string;resultMarker:string}>{
  const currentRoot=currentApplicationRoot(platform,execPath),parent=dirname(currentRoot);
  const suffix=staged.version.replace(/[^0-9A-Za-z.-]/g,'_')+'-'+staged.sourceSha.slice(0,8);
  const nextRoot=join(parent,basename(currentRoot)+'.next-'+suffix),previousRoot=join(parent,basename(currentRoot)+'.previous');
  await rm(nextRoot,{recursive:true,force:true});
  await cp(staged.extractedAppRoot,nextRoot,{recursive:true,errorOnExist:true,force:false,preserveTimestamps:true});
  await access(nextRoot);
  const root=coreUpdateRoot(dataDir);await mkdir(root,{recursive:true,mode:0o700});
  const healthMarker=join(root,'health-'+randomUUID()+'.json'),resultMarker=join(root,'last-result.json');
  await rm(resultMarker,{force:true});
  const exeRel=executableRelative(currentRoot,execPath);
  if(platform==='darwin'){
    const helper=join(root,'apply-update.sh');await writeFile(helper,MAC_HELPER,{encoding:'utf8',mode:0o700});await chmod(helper,0o700);
    return {helper,args:[String(process.pid),currentRoot,nextRoot,previousRoot,exeRel,healthMarker,resultMarker],currentRoot,nextRoot,previousRoot,healthMarker,resultMarker};
  }
  if(platform==='win32'){
    const helper=join(root,'apply-update.ps1');await writeFile(helper,WINDOWS_HELPER,{encoding:'utf8'});
    return {helper,args:['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,'-Pid',String(process.pid),'-Current',currentRoot,'-Next',nextRoot,'-Previous',previousRoot,'-ExeRelative',exeRel,'-Health',healthMarker,'-Result',resultMarker],currentRoot,nextRoot,previousRoot,healthMarker,resultMarker};
  }
  throw new Error('CORE_UPDATE_PLATFORM_UNSUPPORTED');
}

export function launchDesktopCoreUpdateSwap(plan:{helper:string;args:string[]},platform:NodeJS.Platform=process.platform):void{
  const executable=platform==='darwin'?'/bin/sh':'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const args=platform==='darwin'?[plan.helper,...plan.args]:plan.args;
  const child=spawn(executable,args,{detached:true,stdio:'ignore',shell:false,windowsHide:true});child.unref();
}

export async function readDesktopCoreUpdateLastResult(dataDir:string):Promise<{state:'UPDATED'|'ROLLBACK'|'SWAP_FAILED';reason?:string}|null>{
  try{
    const raw=await readFile(join(coreUpdateRoot(dataDir),'last-result.json'),'utf8');
    if(raw.length>4096)throw new Error('CORE_UPDATE_RESULT_INVALID');
    const value=JSON.parse(raw) as Record<string,unknown>;
    if(value.state!=='UPDATED'&&value.state!=='ROLLBACK'&&value.state!=='SWAP_FAILED')throw new Error('CORE_UPDATE_RESULT_INVALID');
    if(value.reason!==undefined&&typeof value.reason!=='string')throw new Error('CORE_UPDATE_RESULT_INVALID');
    return {state:value.state, ...(typeof value.reason==='string'?{reason:value.reason.slice(0,80)}:{})};
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;return null;}
}

export async function writeDesktopCoreUpdateHealth(dataDir:string,markerPath:string,version:string):Promise<void>{
  const root=resolve(coreUpdateRoot(dataDir)),marker=resolve(markerPath);
  if(!marker.startsWith(root+sep)||basename(marker).length>120)throw new Error('CORE_UPDATE_HEALTH_PATH_INVALID');
  await mkdir(root,{recursive:true,mode:0o700});
  await writeFile(marker,JSON.stringify({schemaVersion:1,ok:true,version,checkedAt:new Date().toISOString()})+'\n',{encoding:'utf8',mode:0o600});
}
