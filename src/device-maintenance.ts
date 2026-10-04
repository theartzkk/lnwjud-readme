import { homedir } from 'node:os';
import { join, win32 as pathWin32 } from 'node:path';
import { rm } from 'node:fs/promises';
import { readDeviceIdentity } from './device-identity.js';
import { settingsPath } from './settings.js';
import {
  BOOTSTRAP_NONCE_CREDENTIAL_KEY,
  DEVICE_TOKEN_CREDENTIAL_KEY,
  OWNER_AUTH_PASSWORD_CREDENTIAL_KEY,
  type CredentialStore,
} from './credential-store.js';

export interface DeviceMaintenanceResult {
  schemaVersion:1;
  mode:'REINSTALL'|'RESET';
  pairingPreserved:boolean;
  deviceId:string|null;
  runtimeRootsRemoved:number;
}

export function managedRuntimeRoots(
  platform:NodeJS.Platform=process.platform,
  home=homedir(),
  env:NodeJS.ProcessEnv=process.env,
):string[]{
  if(platform==='darwin'){
    const base=join(home,'Library','Application Support','AWH');
    return ['DeviceRuntime','Engines','SystemRuntime','ToolPacks','Toolchain','RemoteWorker'].map((name)=>join(base,name));
  }
  if(platform==='win32'){
    const local=env.LOCALAPPDATA;
    if(!local)return [];
    const base=pathWin32.join(local,'AWH');
    return ['DeviceRuntime','Engines','SystemRuntime','ToolPacks','Toolchain','RemoteWorker'].map((name)=>pathWin32.join(base,name));
  }
  return [];
}

async function removeRuntimeRoots(platform:NodeJS.Platform,home:string,env:NodeJS.ProcessEnv):Promise<number>{
  const roots=managedRuntimeRoots(platform,home,env);
  let removed=0;
  for(const root of roots){await rm(root,{recursive:true,force:true});removed++;}
  return removed;
}

export async function prepareRuntimeRepair(
  dataDir:string,
  credentialStore:CredentialStore,
):Promise<DeviceMaintenanceResult>{
  const identity=await readDeviceIdentity(dataDir);
  const token=await credentialStore.get(DEVICE_TOKEN_CREDENTIAL_KEY);
  if(Boolean(identity)!==Boolean(token))throw new Error('AWH_REINSTALL_IDENTITY_PAIRING_MISMATCH');
  // Repair/update is non-destructive: the installer stages and verifies a full
  // replacement before atomically swapping the runtime. Destructive cleanup is
  // reserved for Reset this device only.
  return {schemaVersion:1,mode:'REINSTALL',pairingPreserved:Boolean(identity&&token),deviceId:identity?.deviceId??null,runtimeRootsRemoved:0};
}

export async function resetThisDevice(
  dataDir:string,
  credentialStore:CredentialStore,
  platform:NodeJS.Platform=process.platform,
  home=homedir(),
  env:NodeJS.ProcessEnv=process.env,
):Promise<DeviceMaintenanceResult>{
  const identity=await readDeviceIdentity(dataDir).catch(()=>null);
  for(const key of [DEVICE_TOKEN_CREDENTIAL_KEY,BOOTSTRAP_NONCE_CREDENTIAL_KEY,OWNER_AUTH_PASSWORD_CREDENTIAL_KEY])await credentialStore.delete(key).catch(()=>undefined);
  const runtimeRootsRemoved=await removeRuntimeRoots(platform,home,env);
  const localTargets=[
    join(dataDir,'device.json'),
    settingsPath(dataDir),
    join(dataDir,'owner-session.json'),
    join(dataDir,'activity-log.json'),
    join(dataDir,'device-runtime-readiness.json'),
    join(dataDir,'session-credentials'),
    join(dataDir,'device-runtime-smoke'),
    join(dataDir,'device-runtime-workspace'),
    join(dataDir,'central-task-workspaces'),
    join(dataDir,'office-task-workspaces'),
  ];
  for(const target of localTargets)await rm(target,{recursive:true,force:true});
  return {schemaVersion:1,mode:'RESET',pairingPreserved:false,deviceId:identity?.deviceId??null,runtimeRootsRemoved};
}
