import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root=new URL('..',import.meta.url);
const read=(path:string)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('M22 is the canonical AWH deploy mode and preserves M21 as compatibility history',async()=>{
  const deploy=await read('deploy/awh-control-plane/deploy-control-plane.sh');
  const remote=await read('deploy/awh-control-plane/remote-deploy-control-plane.sh');
  const mission=await read('scripts/ops/bounded-deploy-mission.mjs');
  const operator=await read('hub/src/HubCoreReleaseOperator.php');
  const release=await read('hub/src/HubCoreReleaseService.php');
  assert.match(deploy,/--identity-convergence\) IDENTITY_CONVERGENCE=1/);
  assert.match(deploy,/RELEASE_ID=m22-/);
  assert.match(deploy,/hub\/migrations\/021_identity_convergence\.sql/);
  assert.match(remote,/IDENTITY_CONVERGENCE=\$\{31\}/);
  assert.match(remote,/m22-identity-convergence/);
  assert.match(remote,/IDENTITY_CONVERGENCE_MIGRATION_VERIFIED/);
  assert.match(remote,/IDENTITY_CONVERGENCE_ROUTE/);
  assert.match(remote,/SOURCE_DRIFT_MONITOR_READY/);
  assert.match(remote,/SOURCE_DRIFT_VERIFIED/);
  assert.match(remote,/IDENTITY_CONVERGENCE.*awh-source\.zip/s);
  assert.match(remote,/platform_authority='KRUART'.*school_authority='BAY_EXCUSE_X'/s);
  assert.match(remote,/control_user_profiles WHERE person_type IN \('TEACHER','DIRECTOR'\) OR system_role IN \('TEACHER','DIRECTOR'\)/);
  assert.match(mission,/return modes\[0\]\?\?'--identity-convergence'/);
  assert.match(operator,/bounded-deploy-mission\.mjs','--identity-convergence','--approve'/);
  assert.match(release,/releaseMode'=>'IDENTITY_CONVERGENCE'/);
});

test('BAY authority uses the registered read-only MariaDB binding, not release paths or a second credential',async()=>{
  const connector=await read('hub/src/HubBaySchoolAuthorityConnector.php');
  const maria=await read('hub/src/HubMariaDbReadClient.php');
  assert.match(connector,/HubMariaDbReadClient::fromEnvironment\(\)/);
  assert.match(connector,/control_site_database_bindings/);
  assert.match(connector,/control_managed_sites/);
  assert.match(connector,/s\.name='BAY EXCUSE X'/);
  assert.doesNotMatch(connector,/\/var\/www\/bay-/);
  assert.doesNotMatch(connector,/password|secret/i);
  assert.match(maria,/baySchoolIdentity/);
  assert.match(maria,/bayCommunicationSummary/);
  assert.match(maria,/SELECT DISTINCT pe\.permission_key/);
});

test('M22 UI exposes KRUART↔BAY identity and LINE aggregate without duplicating school roles',async()=>{
  const html=await read('web/index.html');
  const app=await read('web/app.js');
  const adapter=await read('web/control-plane-adapter.js');
  assert.match(html,/บัญชี KRUART และสิทธิ์โรงเรียน/);
  assert.match(html,/LINE OA \/ Parent Connect/);
  assert.match(app,/refreshSchoolAccessSurfaces/);
  assert.match(app,/bindSchoolIdentity/);
  assert.match(adapter,/loadBayCommunicationStatus/);
  assert.doesNotMatch(app,/\['TEACHER','ครู'\]/);
  assert.doesNotMatch(app,/\['DIRECTOR','ผู้บริหาร/);
});
