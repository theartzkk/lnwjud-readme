import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  activateVerifiedToolRelease,
  inspectToolLifecycle,
  managedStableCapabilities,
  rollbackVerifiedToolRelease,
  toolFabricCapabilityRoot,
  toolFabricReleaseRoot,
  validateToolReleaseManifest,
  writeVerifiedToolReleaseManifest,
  type ToolReleaseManifest,
} from '../src/tool-fabric-lifecycle.js';

function manifest(capability:string,releaseKey:string,revision:string,channel:'preview'|'stable'='stable'):ToolReleaseManifest {
  return {
    schemaVersion:1,
    kind:'AWH_TOOL_RELEASE',
    capability,
    providerId:'fixture-provider',
    releaseKey,
    channel,
    version:'1.0.0',
    revision,
    license:'MIT',
    verificationState:'VERIFIED',
    checks:{integrity:'PASS',smoke:'PASS',capabilityContract:'PASS',rollback:'READY'},
    launch:{command:'fixture',args:['--stdio']},
  };
}

test('Tool Fabric uses isolated capability/release roots and retains one verified rollback pointer', async (t)=>{
  const home=await mkdtemp(join(tmpdir(),'awh-tool-life-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const first=manifest('code.semantic','1.0.0-a','a'.repeat(40));
  const second=manifest('code.semantic','1.1.0-b','b'.repeat(40));
  await writeVerifiedToolReleaseManifest(first,'darwin',home,{});
  await activateVerifiedToolRelease(first.capability,first.releaseKey,'darwin',home,{});
  let status=await inspectToolLifecycle('code.semantic','darwin',home,{});
  assert.equal(status.state,'STABLE');
  assert.equal(status.current?.releaseKey,'1.0.0-a');
  assert.equal(status.previous,null);

  await writeVerifiedToolReleaseManifest(second,'darwin',home,{});
  await activateVerifiedToolRelease(second.capability,second.releaseKey,'darwin',home,{});
  status=await inspectToolLifecycle('code.semantic','darwin',home,{});
  assert.equal(status.current?.releaseKey,'1.1.0-b');
  assert.equal(status.previous?.releaseKey,'1.0.0-a');

  const rolled=await rollbackVerifiedToolRelease('code.semantic','darwin',home,{});
  assert.equal(rolled.releaseKey,'1.0.0-a');
  status=await inspectToolLifecycle('code.semantic','darwin',home,{});
  assert.equal(status.current?.releaseKey,'1.0.0-a');
  assert.equal(status.previous?.releaseKey,'1.1.0-b');
  assert.deepEqual(await managedStableCapabilities('darwin',home,{}),['code.semantic']);

  assert.match(toolFabricCapabilityRoot('code.semantic','darwin',home,{}),/ToolPacks\/code\.semantic$/);
  assert.match(toolFabricReleaseRoot('code.semantic','1.0.0-a','darwin',home,{}),/ToolPacks\/code\.semantic\/releases\/1\.0\.0-a$/);
});

test('Tool Fabric refuses activation without complete verification evidence', async (t)=>{
  const home=await mkdtemp(join(tmpdir(),'awh-tool-life-fail-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  await assert.rejects(activateVerifiedToolRelease('security.scan','not-installed','darwin',home,{}),/NOT_VERIFIED/);
  assert.throws(()=>validateToolReleaseManifest({
    ...manifest('security.scan','1.0.0','c'.repeat(40)),
    checks:{integrity:'PASS',smoke:'PASS',capabilityContract:'PASS',rollback:'MISSING'},
  }),/CHECKS_INVALID/);
});

test('preview release is visible but never advertised as a managed stable capability', async (t)=>{
  const home=await mkdtemp(join(tmpdir(),'awh-tool-life-preview-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const preview=manifest('document.deep','preview-eb17','d'.repeat(40),'preview');
  await writeVerifiedToolReleaseManifest(preview,'darwin',home,{});
  await activateVerifiedToolRelease(preview.capability,preview.releaseKey,'darwin',home,{});
  assert.equal((await inspectToolLifecycle('document.deep','darwin',home,{})).state,'PREVIEW');
  assert.deepEqual(await managedStableCapabilities('darwin',home,{}),[]);
  const pointer=await readFile(join(toolFabricCapabilityRoot('document.deep','darwin',home,{}),'current'),'utf8');
  assert.equal(pointer.trim(),'preview-eb17');
});
