import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { desktopImpactForFiles, missionModeFromArgs } from '../scripts/ops/bounded-deploy-mission.mjs';

test('bounded deploy mission reuses verified desktop artifacts only for server-safe deltas',()=>{
  assert.equal(desktopImpactForFiles(['hub/src/HubControlPlaneService.php','scripts/ops/example.mjs']),false);
  assert.equal(desktopImpactForFiles(['desktop/index.html']),true);
  assert.equal(desktopImpactForFiles(['src/config.ts']),true);
  assert.equal(desktopImpactForFiles(['package-lock.json']),true);
});

test('bounded deploy mission has one explicit owner approval and a deterministic default deploy mode',()=>{
  assert.equal(missionModeFromArgs([]),'--project-source-authority');
  assert.equal(missionModeFromArgs(['--cloud-first']),'--cloud-first');
  assert.throws(()=>missionModeFromArgs(['--cloud-first','--project-source-authority']),/MISSION_MODE_AMBIGUOUS/);
});

test('mission contract preserves QA, rehearsal, backup, drift and public exact-revision proof',async()=>{
  const source=await readFile(new URL('../scripts/ops/bounded-deploy-mission.mjs',import.meta.url),'utf8');
  assert.match(source,/node:child_process/);
  assert.match(source,/ls-remote/);
  assert.match(source,/branch\.main\.remote/);
  assert.doesNotMatch(source,/refs\/heads\/production','refs\/remotes\/vps\/production/);
  assert.match(source,/new URL\('\/api\/v1\/auth\/login',base\)/);
  assert.doesNotMatch(source,/new URL\('\/api\/v1\/control\/auth\/login',base\)/);
  assert.match(source,/state:'BLOCKED',result:'BLOCK'/);
  assert.match(source,/MISSION_REGRESSION_REPLAY=DEEP/);
  assert.match(source,/MISSION_DURABLE_REGISTRY_UNAVAILABLE/);
  assert.match(source,/AWH_OPERATOR_CLIENT.*\/usr\/local\/bin\/awh-operator/);
  assert.match(source,/awh-remote.*\/usr\/local\/bin\/awh-operator/);
  for(const marker of ['verificationPlanForFiles','MISSION_RISK=','MISSION_VERIFICATION_BUDGET=','MISSION_STABILITY=','MISSION_GOLDEN_JOURNEYS=','MISSION_EVIDENCE_CAPSULE=','MISSION_DURABLE_REGISTRY=','MISSION_DURABLE_EVIDENCE=','verification-regressions','verification-store','MISSION_INCIDENT_FINGERPRINT=','--dry-run','--deploy','--approve','DEPLOY_STAGE=BACKUP_VERIFIED','DEPLOY_STAGE=SOURCE_DRIFT_VERIFIED','MISSION_APPROVALS_CONSUMED=1','MISSION_PUBLIC_VERIFY=PASS','AWH_REUSE_REMOTE_DESKTOP_ARTIFACTS']) assert.match(source,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});


test('KRUART Engineering Eval catalog is durable, unique and cross-project',async()=>{
  const catalog=JSON.parse(await readFile(new URL('../config/kruart-engineering-eval.json',import.meta.url),'utf8'));
  assert.equal(catalog.schemaVersion,1); assert.equal(catalog.name,'KRUART Engineering Eval');
  assert.ok(Array.isArray(catalog.scenarios)&&catalog.scenarios.length>=20);
  const ids=catalog.scenarios.map((row)=>row.id); assert.equal(new Set(ids).size,ids.length);
  for(const project of ['AWH','BAY EXCUSE X','BAY LearnLab','School Website']) assert.ok(catalog.scenarios.some((row)=>row.project===project));
  for(const row of catalog.scenarios){assert.match(row.id,/^[a-z0-9-]+$/);assert.ok(['MEDIUM','HIGH','CRITICAL'].includes(row.risk));assert.ok(Array.isArray(row.triggerPatterns)&&row.triggerPatterns.length>0);assert.ok(typeof row.evidence==='string'&&row.evidence.length>12);}
});
