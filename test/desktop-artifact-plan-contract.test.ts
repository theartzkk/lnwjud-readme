import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('desktop artifact planner is read-only and honors release manifests plus hardlinks', async()=>{
  const s=await readFile('deploy/awh-storage/awh-desktop-artifact-plan.py','utf8');
  assert.match(s,/mode':'PLAN'/);
  assert.match(s,/manifestReferenced/);
  assert.match(s,/st\.st_nlink>1/);
  assert.match(s,/age_days>=MIN_AGE_DAYS/);
  assert.doesNotMatch(s,/\.unlink\(|shutil\.rmtree|os\.remove|rm -/);
});
