#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as asar from '@electron/asar';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const manifest=JSON.parse(await readFile(join(ROOT,'config','full-device-engine-release.json'),'utf8'));
const args=Object.fromEntries(process.argv.slice(2).map((arg)=>{
  const match=arg.match(/^--([^=]+)=(.+)$/);
  if(!match)throw new Error('usage: prepare-full-device-engine.mjs --platform=<darwin|win32> --arch=<arm64|x64>');
  return [match[1],match[2]];
}));
const platform=args.platform,arch=args.arch,key=`${platform}-${arch}`,asset=manifest.assets?.[key];
if(!asset||!['darwin','win32'].includes(platform)||!['arm64','x64'].includes(arch))throw new Error(`Unsupported AWH full device engine target: ${key}`);
if(platform==='win32'&&arch!=='x64')throw new Error('Windows full device engine is currently x64 only');
if(platform==='darwin'&&process.platform!=='darwin'&&process.env.AWH_ALLOW_CROSS_ENGINE_PREP!=='1')throw new Error('macOS full device engine preparation must run on macOS so the patched engine can be re-signed');

const BUILD_ROOT=join(ROOT,'.awh-build'),CACHE=join(BUILD_ROOT,'full-device-engine-cache'),DEST=join(BUILD_ROOT,'awh-device-runtime'),TMP=join(BUILD_ROOT,`full-device-engine-${process.pid}`);
const releaseBase=`https://github.com/engasnm111/lnwjud/releases/download/v${manifest.version}`,cacheFile=join(CACHE,asset.filename),provenanceFile=join(CACHE,asset.provenanceFilename);

async function sha256(file){return createHash('sha256').update(await readFile(file)).digest('hex');}
async function verified(file,expected){try{const info=await stat(file);return info.isFile()&&info.size>0&&(await sha256(file))===expected;}catch{return false;}}
async function download(url,destination){
  const response=await fetch(url,{redirect:'follow'});
  if(!response.ok||!response.body)throw new Error(`AWH engine download failed: HTTP ${response.status}`);
  const length=Number(response.headers.get('content-length')||0);
  if(Number.isFinite(length)&&length>280_000_000)throw new Error('AWH engine asset exceeds the bounded download size');
  const partial=destination+'.partial';await rm(partial,{force:true});
  await pipeline(Readable.fromWeb(response.body),createWriteStream(partial,{mode:0o600}));await rename(partial,destination);
}
function run(executable,runArgs){const result=spawnSync(executable,runArgs,{encoding:'utf8'});if(result.status!==0)throw new Error(`${basename(executable)} failed: ${(result.stderr||result.stdout||'').trim().slice(0,1200)}`);return result.stdout??'';}
async function verifyProvenance(file){
  const document=JSON.parse(await readFile(file,'utf8'));
  if(document.schemaVersion!==1||document.product!=='lnwjud'||document.version!==manifest.version)throw new Error('AWH engine provenance identity is invalid');
  if(document.platform!==platform||document.arch!==arch)throw new Error('AWH engine provenance platform does not match target');
  if(document.source?.commit!==manifest.upstreamCommit||document.source?.dirty!==false)throw new Error('AWH engine provenance source identity is invalid');
  const artifact=(document.artifacts||[]).find((entry)=>entry?.name===asset.filename);
  if(!artifact||artifact.sha256!==asset.sha256)throw new Error('AWH engine provenance artifact hash does not match pinned release');
}

async function patchMacEngine(appPath){
  const resources=join(appPath,'Contents','Resources'),appAsar=join(resources,'app.asar'),extracted=join(TMP,'asar'),rebuilt=join(TMP,'app.asar');
  await rm(extracted,{recursive:true,force:true});await mkdir(extracted,{recursive:true});asar.extractAll(appAsar,extracted);
  const packagePath=join(extracted,'package.json'),packageJson=JSON.parse(await readFile(packagePath,'utf8'));
  packageJson.productName='AWH Agent';packageJson.description='AWH Device Runtime — full hidden execution engine for AWH Agent.';
  await writeFile(packagePath,JSON.stringify(packageJson,null,2)+'\n');

  const mainPath=join(extracted,'dist','main','main.js');let main=await readFile(mainPath,'utf8');
  if(!main.includes('app.setName("AWH Agent")')){
    const electronImport=main.match(/import \{[^\n]+\bapp\b[^\n]+\} from "electron";/);
    if(!electronImport)throw new Error('Pinned lnwjud Electron import anchor was not found');
    main=main.replace(electronImport[0],electronImport[0]+'\napp.setName("AWH Agent");');
  }
  main=main.replace('var APP_NAME = "lnwjud";','var APP_NAME = "AWH Agent";').replace('var APP_NAME2 = "lnwjud";','var APP_NAME2 = "AWH Agent";');
  const anchor='async function resolveDesktopRuntimeSecrets(dataPath) {\n';
  if(!main.includes('AWH_DEVICE_RUNTIME_HEADLESS')){
    if(!main.includes(anchor))throw new Error('Pinned lnwjud secret composition anchor was not found');
    const branch=`async function resolveDesktopRuntimeSecrets(dataPath) {
  if (process.env.AWH_DEVICE_RUNTIME_HEADLESS === "1") {
    const fsApi = await import("node:fs/promises");
    const pathApi = await import("node:path");
    const cryptoApi = await import("node:crypto");
    const keyDirectory = pathApi.join(dataPath, "awh-runtime");
    await fsApi.mkdir(keyDirectory, { recursive: true, mode: 448 });
    await fsApi.chmod(keyDirectory, 448);
    const keyPath = pathApi.join(keyDirectory, "engine-secret.key");
    let key;
    try {
      const metadata = await fsApi.lstat(keyPath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("AWH Device Runtime secret key is not a trusted regular file");
      key = Buffer.from((await fsApi.readFile(keyPath, "utf8")).trim(), "base64");
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
      key = cryptoApi.randomBytes(32);
      await fsApi.writeFile(keyPath, key.toString("base64"), { encoding: "utf8", flag: "wx", mode: 384 });
    }
    await fsApi.chmod(keyPath, 384);
    if (key.byteLength !== 32) throw new Error("AWH Device Runtime secret key is invalid");
    const secretProtector = createExplicitKeySecretProtector(key);
    const checkpointKey = await new CheckpointKeyStore({
      filePath: pathApi.join(dataPath, "checkpoint-master.key"),
      secretProtector,
      quarantineUnsupported: true
    }).loadOrCreate();
    return { checkpointEncryptionKey: checkpointKey, secretProtector };
  }
`;
    main=main.replace(anchor,branch);
  }
  await writeFile(mainPath,main);
  await asar.createPackageWithOptions(extracted,rebuilt,{unpack:'**/*.node'});
  await rm(appAsar,{force:true});await rm(appAsar+'.unpacked',{recursive:true,force:true});await rename(rebuilt,appAsar);
  try{await rename(rebuilt+'.unpacked',appAsar+'.unpacked');}catch{}
  run('/usr/bin/codesign',['--force','--deep','--sign','-',appPath]);run('/usr/bin/codesign',['--verify','--deep','--strict',appPath]);
}
async function writeRuntimeMetadata(extra={}){
  await writeFile(join(DEST,'engine.json'),JSON.stringify({schemaVersion:1,product:'AWH Device Runtime',engine:manifest.engine,engineVersion:manifest.version,upstreamCommit:manifest.upstreamCommit,platform,architecture:arch,artifact:asset.filename,artifactSha256:asset.sha256,provenanceFilename:asset.provenanceFilename,provenanceSha256:asset.provenanceSha256,brand:'AWH Agent',channel:manifest.channel,minimumToolCount:manifest.minimumToolCount,dataAuthority:manifest.dataAuthority,headlessSecretPolicy:manifest.headlessSecretPolicy?.[platform]??null,...extra},null,2)+'\n',{mode:0o600});
}

await mkdir(CACHE,{recursive:true,mode:0o700});await rm(TMP,{recursive:true,force:true});await rm(DEST,{recursive:true,force:true});await mkdir(TMP,{recursive:true,mode:0o700});await mkdir(DEST,{recursive:true,mode:0o700});
if(!(await verified(cacheFile,asset.sha256))){await rm(cacheFile,{force:true});await download(`${releaseBase}/${asset.filename}`,cacheFile);}
if(!(await verified(cacheFile,asset.sha256)))throw new Error('AWH full device engine SHA256 verification failed');
if(!(await verified(provenanceFile,asset.provenanceSha256))){await rm(provenanceFile,{force:true});await download(`${releaseBase}/${asset.provenanceFilename}`,provenanceFile);}
if(!(await verified(provenanceFile,asset.provenanceSha256)))throw new Error('AWH full device engine provenance SHA256 verification failed');
await verifyProvenance(provenanceFile);

if(platform==='darwin'){
  const extractDir=join(TMP,'mac');await mkdir(extractDir,{recursive:true});run('/usr/bin/ditto',['-x','-k',cacheFile,extractDir]);
  const candidates=(await readdir(extractDir,{withFileTypes:true})).filter((entry)=>entry.isDirectory()&&entry.name.endsWith('.app'));
  if(candidates.length!==1)throw new Error('Pinned macOS engine archive did not contain exactly one app bundle');
  const engineApp=join(DEST,'lnwjud.app');run('/usr/bin/ditto',[join(extractDir,candidates[0].name),engineApp]);await patchMacEngine(engineApp);
  const wrapper=`#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
DATA="$HOME/Library/Application Support/AWH/DeviceRuntime/lnwjud"
mkdir -p "$DATA"
chmod 700 "$DATA"
unset ELECTRON_RUN_AS_NODE
export AWH_DEVICE_RUNTIME_HEADLESS=1
export LNWJUD_DATA_PATH="$DATA"
exec "$ROOT/lnwjud.app/Contents/Resources/lnwjud-mcp-stdio" "$@"
`;
  await writeFile(join(DEST,'awh-mcp-stdio'),wrapper,{mode:0o700});await chmod(join(DEST,'awh-mcp-stdio'),0o700);await writeRuntimeMetadata({launcher:'awh-mcp-stdio'});
}else{
  const exe=join(DEST,'AWHDeviceRuntime.exe');await cp(cacheFile,exe);
  const wrapper=`@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
set "AWH_DEVICE_RUNTIME_HEADLESS=1"
if not defined APPDATA set "APPDATA=%USERPROFILE%\\AppData\\Roaming"
set "LNWJUD_DATA_PATH=%APPDATA%\\AWH\\DeviceRuntime\\lnwjud"
"%~dp0AWHDeviceRuntime.exe" --mcp-stdio %*
`;
  await writeFile(join(DEST,'awh-mcp-stdio.cmd'),wrapper,{mode:0o600});await writeRuntimeMetadata({launcher:'awh-mcp-stdio.cmd'});
}
await rm(TMP,{recursive:true,force:true});
console.log(`AWH_FULL_DEVICE_ENGINE=READY platform=${platform} arch=${arch} version=${manifest.version} sha256=${asset.sha256}`);
