import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { InMemoryCredentialStore, DEVICE_TOKEN_CREDENTIAL_KEY } from '../src/credential-store.js';
import { loadOrCreateDeviceIdentity, readDeviceIdentity } from '../src/device-identity.js';
import { managedRuntimeRoots, prepareRuntimeRepair, resetThisDevice } from '../src/device-maintenance.js';

test('runtime repair preserves live runtime, identity, pairing and standalone RDC', async()=>{
  const root=await mkdtemp(join(tmpdir(),'awh-maintenance-'));
  const dataDir=join(root,'.awh'); const home=join(root,'home'); const appSupport=join(home,'Library','Application Support','AWH');
  const rdcSession=join(home,'.desktop-commander-device');
  const engine=join(appSupport,'Engines','lnwjud','5.5.0','keep-runtime.txt');
  await mkdir(dataDir,{recursive:true}); await mkdir(join(engine,'..'),{recursive:true}); await mkdir(join(dataDir,'projects'),{recursive:true}); await mkdir(rdcSession,{recursive:true});
  await writeFile(engine,'runtime-keep'); await writeFile(join(dataDir,'projects','keep.txt'),'keep'); await writeFile(join(rdcSession,'device.json'),'rdc-keep');
  const identity=await loadOrCreateDeviceIdentity(dataDir,'Fixture Mac');
  const store=new InMemoryCredentialStore(); await store.set(DEVICE_TOKEN_CREDENTIAL_KEY,'fixture-device-token');
  const result=await prepareRuntimeRepair(dataDir,store);
  assert.equal(result.pairingPreserved,true); assert.equal(result.deviceId,identity.deviceId); assert.equal(result.runtimeRootsRemoved,0);
  assert.equal((await readDeviceIdentity(dataDir))?.deviceId,identity.deviceId);
  assert.equal(await store.get(DEVICE_TOKEN_CREDENTIAL_KEY),'fixture-device-token');
  assert.equal(await readFile(engine,'utf8'),'runtime-keep');
  assert.equal(await readFile(join(dataDir,'projects','keep.txt'),'utf8'),'keep');
  assert.equal(await readFile(join(rdcSession,'device.json'),'utf8'),'rdc-keep');
  assert.equal(managedRuntimeRoots('darwin',home,{}).some((entry)=>entry.includes('.desktop-commander-device')),false);
});

test('reinstall fails closed when identity and pairing no longer match', async()=>{
  const root=await mkdtemp(join(tmpdir(),'awh-maintenance-mismatch-')); const dataDir=join(root,'.awh');
  await loadOrCreateDeviceIdentity(dataDir,'Fixture Mac');
  await assert.rejects(()=>prepareRuntimeRepair(dataDir,new InMemoryCredentialStore()),/IDENTITY_PAIRING_MISMATCH/);
});

test('reset removes device-local identity, token and managed runtime but preserves project data', async()=>{
  const root=await mkdtemp(join(tmpdir(),'awh-reset-')); const dataDir=join(root,'.awh'); const home=join(root,'home');
  await mkdir(join(dataDir,'projects'),{recursive:true}); await writeFile(join(dataDir,'projects','keep.txt'),'keep');
  await loadOrCreateDeviceIdentity(dataDir,'Fixture Mac');
  const store=new InMemoryCredentialStore(); await store.set(DEVICE_TOKEN_CREDENTIAL_KEY,'fixture-device-token');
  for(const runtime of managedRuntimeRoots('darwin',home,{}).slice(0,2))await mkdir(runtime,{recursive:true});
  const result=await resetThisDevice(dataDir,store,'darwin',home,{});
  assert.equal(result.pairingPreserved,false); assert.equal(await readDeviceIdentity(dataDir),null);
  assert.equal(await store.get(DEVICE_TOKEN_CREDENTIAL_KEY),null);
  assert.equal(await readFile(join(dataDir,'projects','keep.txt'),'utf8'),'keep');
});
