import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const load=async(n:string)=>JSON.parse(await readFile(`docs/migration/projects/${n}.json`,'utf8'));

test('per-project migration manifests preserve authorities and rollback gates', async()=>{
  const [awh,bay,ll,hub,site,index]=await Promise.all(['awh','bay-excuse-x','bay-learnlab','bay-hub','school-website','index'].map(load));
  assert.equal(awh.source.observedSha,'6900cf447e966fd093b22ad981d56cdde317d35b');
  assert.equal(awh.currentProduction.sourceMatchesCanonicalAtObservation,false);
  assert.equal(awh.backup.latestRestoreDrill,'PASS_SCHEMA_20');
  assert.equal(bay.source.observedVersion,'2.0.0-RC5.4.6');
  assert.equal(bay.currentProduction.exactDeployRevision,'PENDING_READ_ONLY_PRODUCTION_STATE_PROOF');
  assert.equal(bay.data.vpsProofAndStagingDatabasesAreProduction,false);
  assert.equal(ll.data.masterAuthority,'BAY EXCUSE X');
  assert.equal(ll.source.activeCandidateShaObserved,'bcf21fe6a5e62a15f800a74072abb1101c30ff5a');
  assert.equal(ll.source.activeCandidateVersionObserved,'0.8.0-rc.25');
  assert.ok(ll.data.forbiddenDuplicateMasters.includes('students'));
  assert.equal(ll.deploy.parallelProductionDeployer,false);
  assert.equal(hub.data.persistentDatabase,false);
  assert.equal(site.source.canonicalRepository,null);
  assert.equal(site.source.historicalInstallerOrScreenshotEvidenceIsCanonicalSource,false);
  assert.deepEqual(index.recommendedMigrationOrder,['awh','bay-hub','school-website','bay-learnlab','bay-excuse-x']);
});

test('no migration manifest contains obvious secret values', async()=>{
  for(const n of ['awh','bay-excuse-x','bay-learnlab','bay-hub','school-website']){
    const raw=await readFile(`docs/migration/projects/${n}.json`,'utf8');
    assert.doesNotMatch(raw,/BEGIN (?:OPENSSH|RSA|EC) PRIVATE KEY|password\s*[:=]\s*["'][^"']{4,}|Bearer\s+[A-Za-z0-9._-]{12,}/i);
  }
});
