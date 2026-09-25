import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SHA=/^[0-9a-f]{40}$/;
const HASH=/^[0-9a-f]{64}$/;
const TARGETS=[
  {file:"AWH-macOS-arm64.zip", evidence:"AWH-macOS-arm64.release.json", platform:"darwin", architecture:"arm64"},
  {file:"AWH-macOS-x64.zip", evidence:"AWH-macOS-x64.release.json", platform:"darwin", architecture:"x64"},
  {file:"AWH-Windows-x64.zip", evidence:"AWH-Windows-x64.release.json", platform:"win32", architecture:"x64"},
];
const INSTALLERS=[
  {file:"AWH-Agent-Beta-macOS-arm64.dmg", evidence:"AWH-Agent-Beta-macOS-arm64.installer.json", platform:"darwin", architecture:"arm64"},
  {file:"AWH-Agent-Beta-macOS-x64.dmg", evidence:"AWH-Agent-Beta-macOS-x64.installer.json", platform:"darwin", architecture:"x64"},
];

function fail(code,detail=""){const e=new Error(detail?code+":"+detail:code);e.code=code;throw e;}
async function regular(path){
  const stat=await lstat(path).catch(()=>null);
  if(!stat||!stat.isFile()||stat.isSymbolicLink()||stat.size<=0)fail("DESKTOP_ARTIFACT_MISSING",basename(path));
  return stat;
}
async function optionalRegular(path){
  const stat=await lstat(path).catch(()=>null);
  if(!stat)return null;
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<=0)fail("DESKTOP_ARTIFACT_INVALID",basename(path));
  return stat;
}
async function sha256(path){return createHash("sha256").update(await readFile(path)).digest("hex");}
function parseSums(text){
  const map=new Map();
  for(const raw of text.split(/\r?\n/)){
    const line=raw.trim(); if(!line)continue;
    const m=line.match(/^([0-9a-f]{64})\s+\*?([^/\\]+)$/i);
    if(!m)fail("DESKTOP_ARTIFACT_SUMS_INVALID",line.slice(0,80));
    if(map.has(m[2]))fail("DESKTOP_ARTIFACT_SUMS_DUPLICATE",m[2]);
    map.set(m[2],m[1].toLowerCase());
  }
  return map;
}

export const DESKTOP_RELEASE_FILES=[
  ...TARGETS.flatMap((row)=>[row.file,row.evidence]),
  "SHA256SUMS.txt",
];
export const DESKTOP_INSTALLER_FILES=INSTALLERS.flatMap((row)=>[row.file,row.evidence]);

function sourceMatches(evidence,sourceSha,sourceTreeSha){
  const buildSha=String(evidence?.sourceSha||"").toLowerCase();
  if(!SHA.test(buildSha))return false;
  if(buildSha===sourceSha)return true;
  const buildTree=String(evidence?.sourceTreeSha||"").toLowerCase();
  return SHA.test(sourceTreeSha||"")&&SHA.test(buildTree)&&buildTree===sourceTreeSha;
}

export async function verifyDesktopReleaseArtifacts(directory,sourceSha,sourceTreeSha=null){
  if(!SHA.test(sourceSha)||(sourceTreeSha!==null&&!SHA.test(sourceTreeSha)))fail("DESKTOP_ARTIFACT_SOURCE_INVALID");
  const root=resolve(directory);
  const sumsPath=join(root,"SHA256SUMS.txt");
  await regular(sumsPath);
  const sums=parseSums(await readFile(sumsPath,"utf8"));
  if(sums.size!==TARGETS.length)fail("DESKTOP_ARTIFACT_SUMS_COUNT",String(sums.size));
  const verified=[];
  for(const target of TARGETS){
    const packagePath=join(root,target.file);
    const evidencePath=join(root,target.evidence);
    const stat=await regular(packagePath); await regular(evidencePath);
    let evidence; try{evidence=JSON.parse(await readFile(evidencePath,"utf8"));}catch{fail("DESKTOP_ARTIFACT_EVIDENCE_JSON",target.evidence);}
    const digest=await sha256(packagePath);
    if(!HASH.test(digest)||sums.get(target.file)!==digest)fail("DESKTOP_ARTIFACT_HASH_MISMATCH",target.file);
    if(evidence?.schemaVersion!==1||evidence?.kind!=="AWH_DESKTOP_RELEASE_EVIDENCE"||evidence?.authority!=="CI_PACKAGE_EVIDENCE_ONLY")fail("DESKTOP_ARTIFACT_EVIDENCE_INVALID",target.evidence);
    if(evidence?.packageVerification!=="VERIFIED"||!sourceMatches(evidence,sourceSha,sourceTreeSha)||evidence?.packageSha256!==digest||evidence?.sizeBytes!==stat.size)fail("DESKTOP_ARTIFACT_PROVENANCE_MISMATCH",target.file);
    if(evidence?.downloadKey!==target.file||evidence?.platform!==target.platform||evidence?.architecture!==target.architecture)fail("DESKTOP_ARTIFACT_TARGET_MISMATCH",target.file);
    if(typeof evidence?.productVersion!=="string"||!evidence.productVersion.trim())fail("DESKTOP_ARTIFACT_VERSION_INVALID",target.file);
    verified.push({file:target.file,sha256:digest,sizeBytes:stat.size,platform:target.platform,architecture:target.architecture,buildSourceSha:evidence.sourceSha,sourceTreeSha:evidence.sourceTreeSha??null});
  }
  return {schemaVersion:1,sourceSha,sourceTreeSha:sourceTreeSha??null,verified};
}

export async function verifyDesktopInstallerArtifacts(directory,sourceSha){
  if(!SHA.test(sourceSha))fail("DESKTOP_INSTALLER_SOURCE_INVALID");
  const root=resolve(directory);
  const verified=[];
  for(const target of INSTALLERS){
    const packagePath=join(root,target.file);
    const evidencePath=join(root,target.evidence);
    const packageStat=await optionalRegular(packagePath);
    const evidenceStat=await optionalRegular(evidencePath);
    if(!packageStat&&!evidenceStat)continue;
    if(!packageStat||!evidenceStat)fail("DESKTOP_INSTALLER_PAIR_INCOMPLETE",target.file);
    let evidence; try{evidence=JSON.parse(await readFile(evidencePath,"utf8"));}catch{fail("DESKTOP_INSTALLER_EVIDENCE_JSON",target.evidence);}
    const digest=await sha256(packagePath);
    if(evidence?.schemaVersion!==1||evidence?.kind!=="AWH_DESKTOP_INSTALLER_EVIDENCE"||evidence?.authority!=="CI_PACKAGE_EVIDENCE_ONLY")fail("DESKTOP_INSTALLER_EVIDENCE_INVALID",target.evidence);
    if(evidence?.channel!=="beta"||evidence?.packageVerification!=="VERIFIED"||evidence?.sourceSha!==sourceSha||evidence?.packageSha256!==digest||evidence?.sizeBytes!==packageStat.size)fail("DESKTOP_INSTALLER_PROVENANCE_MISMATCH",target.file);
    if(evidence?.downloadKey!==target.file||evidence?.platform!==target.platform||evidence?.architecture!==target.architecture)fail("DESKTOP_INSTALLER_TARGET_MISMATCH",target.file);
    if(typeof evidence?.productVersion!=="string"||!evidence.productVersion.trim())fail("DESKTOP_INSTALLER_VERSION_INVALID",target.file);
    verified.push({file:target.file,evidence:target.evidence,sha256:digest,sizeBytes:packageStat.size,platform:target.platform,architecture:target.architecture,channel:"beta",platformTrust:evidence.platformTrust||"ADHOC_BETA"});
  }
  return {schemaVersion:1,sourceSha,verified};
}

export async function hydrateDesktopReleaseArtifacts({sourceRoot,sourceSha,sourceTreeSha=null,stagingRoot=process.env.AWH_DESKTOP_ARTIFACT_STAGING_ROOT||"/var/lib/awh-remote/operator-staging/core-release-artifacts"}){
  if(!SHA.test(sourceSha)||(sourceTreeSha!==null&&!SHA.test(sourceTreeSha)))fail("DESKTOP_ARTIFACT_SOURCE_INVALID");
  const stage=join(resolve(stagingRoot),sourceSha);
  await verifyDesktopReleaseArtifacts(stage,sourceSha,sourceTreeSha);
  const installerVerification=await verifyDesktopInstallerArtifacts(stage,sourceSha);
  const destination=join(resolve(sourceRoot),"dist-web","downloads");
  await mkdir(destination,{recursive:true,mode:0o750});
  for(const file of DESKTOP_RELEASE_FILES)await copyFile(join(stage,file),join(destination,file));
  for(const item of installerVerification.verified){
    await copyFile(join(stage,item.file),join(destination,item.file));
    await copyFile(join(stage,item.evidence),join(destination,item.evidence));
  }
  const post=await verifyDesktopReleaseArtifacts(destination,sourceSha,sourceTreeSha);
  const installers=await verifyDesktopInstallerArtifacts(destination,sourceSha);
  return {...post,installers:installers.verified,stagingDirectory:stage,destination};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const sourceRoot=process.argv[2]||process.cwd();
  const sourceSha=process.argv[3]||"";
  hydrateDesktopReleaseArtifacts({sourceRoot,sourceSha}).then((result)=>{
    console.log("DESKTOP_ARTIFACT_HYDRATION=PASS");
    console.log("DESKTOP_ARTIFACT_SOURCE_SHA="+result.sourceSha);
    console.log("DESKTOP_ARTIFACT_VERIFIED="+result.verified.length);
    console.log("DESKTOP_INSTALLER_VERIFIED="+result.installers.length);
  }).catch((error)=>{console.error("DESKTOP_ARTIFACT_HYDRATION=FAIL");console.error(String(error?.message||error));process.exit(1);});
}
