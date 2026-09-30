import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assertToolLifecycleTransition,
  assertToolPromotion,
  missingPromotionEvidence,
  validateToolFabricUpdatePolicy,
} from '../src/tool-fabric-policy.js';
import { watchExternalCapabilityUpstreams } from '../src/tool-upstream-watcher.js';

const policyPath=new URL('../config/tool-fabric-update-policy.json',import.meta.url);
const registryPath=new URL('../config/external-capabilities.json',import.meta.url);

test('Tool Fabric policy forbids latest/global mutation and requires bounded promotion gates', async()=>{
  const policy=validateToolFabricUpdatePolicy(JSON.parse(await readFile(policyPath,'utf8')));
  assert.equal(policy.authority,'AWH_UPDATE_CENTER');
  assert.equal(policy.principles.autoInstallLatest,false);
  assert.equal(policy.updateDiscovery.neverMutateRuntimeDuringDiscovery,true);
  assert.equal(policy.installation.sharedGlobalLatestForbidden,true);
  assertToolLifecycleTransition('DISCOVERED','REVIEWED');
  assertToolLifecycleTransition('REVIEWED','APPROVED');
  assertToolLifecycleTransition('APPROVED','PREVIEW');
  assertToolLifecycleTransition('PREVIEW','STABLE');
  assert.throws(()=>assertToolLifecycleTransition('DISCOVERED','STABLE'),/TRANSITION_INVALID/);

  const previewEvidence={
    upstream_revision_resolved:true,
    license_verified:true,
    smoke_pass:true,
  };
  assert.deepEqual(missingPromotionEvidence(policy,'preview',previewEvidence),[]);
  assertToolPromotion(policy,'APPROVED','PREVIEW',previewEvidence);

  const stableEvidence={
    upstream_revision_resolved:true,
    license_verified:true,
    package_or_binary_integrity_verified:true,
    mcp_or_cli_smoke_pass:true,
    capability_contract_pass:true,
    regression_pass:true,
    rollback_evidence_ready:true,
  };
  assertToolPromotion(policy,'PREVIEW','STABLE',stableEvidence);
  assert.throws(()=>assertToolPromotion(policy,'PREVIEW','STABLE',{...stableEvidence,rollback_evidence_ready:false}),/rollback_evidence_ready/);
});

test('Upstream watcher is metadata-only, deduplicates repositories, and never auto-promotes changed revisions', async()=>{
  const registry=JSON.parse(await readFile(registryPath,'utf8'));
  const calls=new Map<string,number>();
  const unique=[...new Set(registry.entries.map((entry:any)=>entry.repository))] as string[];
  const first=unique[0]!;
  const pinned=registry.entries.find((entry:any)=>entry.repository===first).revision;
  const changed='f'.repeat(40);
  const report=await watchExternalCapabilityUpstreams(registry,async(repository)=>{
    calls.set(repository,(calls.get(repository)??0)+1);
    if(repository===first) return pinned;
    if(repository===unique[1]) return changed;
    return null;
  },'2026-09-28T14:30:00.000Z');
  assert.equal(report.authority,'AWH_UPDATE_CENTER');
  assert.equal(report.discoveryMode,'METADATA_ONLY');
  assert.equal(report.runtimeMutation,false);
  assert.equal([...calls.values()].every((count)=>count===1),true);
  assert.ok(report.observations.some((row)=>row.repository===first&&row.state==='CURRENT'&&row.intakeState===null));
  assert.ok(report.observations.some((row)=>row.repository===unique[1]&&row.state==='UPSTREAM_CHANGED'&&row.intakeState==='DISCOVERED'));
  assert.ok(report.observations.some((row)=>row.state==='UNAVAILABLE'&&row.intakeState===null));
  assert.equal(report.observations.some((row:any)=>row.intakeState==='STABLE'||row.intakeState==='APPROVED'),false);
});
