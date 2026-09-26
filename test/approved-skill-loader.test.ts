import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { APPROVED_ANTI_SLOP_ROOT, approvedSkillPackInventory, materializeApprovedSkillPlan, verifyApprovedAntiSlopPack } from '../src/approved-skill-loader.js';
import { validateExternalCapabilityRegistry } from '../src/external-capability-registry.js';
import type { WorkerCapabilityPlan } from '../src/control-plane-worker-client.js';

test('external capability registry accepts approved skill trust metadata', async () => {
  const registry=JSON.parse(await readFile(join(process.cwd(),'config','external-capabilities.json'),'utf8'));
  const validated=validateExternalCapabilityRegistry(registry);
  const ids=validated.entries.map((entry)=>entry.id);
  assert.ok(ids.includes('anti-slop-design'));
  assert.ok(ids.includes('anti-slop-copy'));
  assert.ok(ids.includes('anti-slop-code'));
  assert.ok(ids.includes('skills-directory'));
});

test('approved Anti Slop pack verifies exact upstream pins and exposes bounded inventory', async () => {
  const manifest=await verifyApprovedAntiSlopPack();
  assert.equal(manifest.source.repository,'miqdadbadjuber/anti-slop');
  assert.equal(manifest.source.revision,'a56a8a78229516238375111a799001a5f24953cf');
  assert.equal(manifest.runtimePolicy.networkAllowed,false);
  assert.equal(manifest.runtimePolicy.telemetryAllowed,false);
  assert.deepEqual(await approvedSkillPackInventory(),['antislop','antislop-code','antislop-copywriting','antislop-human','antislop-layoutmobile','antislop-ui']);
});

test('approved skill materialization is lazy and cleanup removes AWH skill state', async () => {
  const root=await mkdtemp(join(tmpdir(),'awh-skill-workspace-'));
  const workspace=join(root,'project');
  await mkdir(workspace,{recursive:true});
  const plan:WorkerCapabilityPlan={schemaVersion:1,router:'awh.external-capabilities.v1',selected:[
    {id:'design.antislop',label:'Anti Slop Guard',mode:'APPROVED_SKILL_PACK',reason:'design filter',requiredTool:null}
  ]};
  try {
    const materialized=await materializeApprovedSkillPlan(plan,workspace);
    assert.deepEqual(materialized.skillNames,['antislop','antislop-ui','antislop-human','antislop-layoutmobile']);
    await access(join(workspace,'.codex','skills','antislop','SKILL.md'));
    await access(join(workspace,'.codex','skills','antislop','antislop.md'));
    await assert.rejects(access(join(workspace,'.codex','skills','antislop-human','contrast-check.py')));
    await materialized.cleanup();
    await assert.rejects(access(join(workspace,'.codex','skills','antislop','SKILL.md')));
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('tampered vendored upstream content fails closed before materialization', async () => {
  const root=await mkdtemp(join(tmpdir(),'awh-skill-tamper-'));
  try {
    await cp(APPROVED_ANTI_SLOP_ROOT,root,{recursive:true});
    const target=join(root,'antislop-ui','SKILL.md');
    const original=await readFile(target,'utf8');
    await writeFile(target,original+'\n<!-- tampered -->\n','utf8');
    await assert.rejects(verifyApprovedAntiSlopPack(root),/APPROVED_SKILL_INTEGRITY_FAILED/);
  } finally { await rm(root,{recursive:true,force:true}); }
});
