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
  for(const marker of ['npm\',[\'run\',\'qa:fast\']','--dry-run','--deploy','--approve','DEPLOY_STAGE=BACKUP_VERIFIED','DEPLOY_STAGE=SOURCE_DRIFT_VERIFIED','MISSION_APPROVALS_CONSUMED=1','MISSION_PUBLIC_VERIFY=PASS','AWH_REUSE_REMOTE_DESKTOP_ARTIFACTS']) assert.match(source,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});
