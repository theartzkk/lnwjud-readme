import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root=new URL('..',import.meta.url);
const read=(path:string)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('M24 LINE OA extends the canonical AWH deploy path while preserving M23/M22/M21 history',async()=>{
  const deploy=await read('deploy/awh-control-plane/deploy-control-plane.sh');
  const remote=await read('deploy/awh-control-plane/remote-deploy-control-plane.sh');
  const mission=await read('scripts/ops/bounded-deploy-mission.mjs');
  const operator=await read('hub/src/HubCoreReleaseOperator.php');
  const release=await read('hub/src/HubCoreReleaseService.php');
  assert.match(deploy,/--identity-convergence\) IDENTITY_CONVERGENCE=1/);
  assert.match(deploy,/RELEASE_ID=m22-/);
  assert.match(deploy,/hub\/migrations\/021_identity_convergence\.sql/);
  assert.match(deploy,/--platform-hardening\) PLATFORM_HARDENING=1/);
  assert.match(deploy,/RELEASE_ID=m23-/);
  assert.match(deploy,/hub\/migrations\/022_platform_hardening\.sql/);
  assert.match(deploy,/--line-oa-gateway\) LINE_OA_GATEWAY=1/);
  assert.match(deploy,/RELEASE_ID=m24-/);
  assert.match(deploy,/hub\/migrations\/023_line_oa_gateway\.sql/);
  assert.match(remote,/IDENTITY_CONVERGENCE=\$\{31\}/);
  assert.match(remote,/LINE_OA_GATEWAY=\$\{33\}/);
  assert.match(remote,/m24-line-oa-gateway/);
  assert.match(remote,/LINE_OA_GATEWAY_MIGRATION_VERIFIED/);
  assert.match(remote,/m22-identity-convergence/);
  assert.match(remote,/IDENTITY_CONVERGENCE_MIGRATION_VERIFIED/);
  const m22Start=remote.indexOf('if test "$IDENTITY_CONVERGENCE" = 1; then\n  # M22 keeps KRUART as platform-login authority');
  const m22End=remote.indexOf('elif test "$PROJECT_SOURCE_AUTHORITY" = 1; then',m22Start);
  const m22=remote.slice(m22Start,m22End);
  assert.ok(m22Start>=0&&m22End>m22Start,'M22 deploy branch is present');
  assert.match(m22,/cmp -s "\$EXECUTOR_SERVICE_UNIT" "\$PREVIOUS_TARGET\/deploy\/systemd\/awh-native-executor\.service"/);
  assert.match(m22,/cmp -s "\$HOSTING_SERVICE_UNIT" "\$PREVIOUS_TARGET\/deploy\/systemd\/awh-hosting-operator\.service"/);
  assert.match(m22,/EXECUTOR_UNITS_PREEXISTING=1/);
  assert.match(m22,/HOSTING_UNITS_PREEXISTING=1/);
  assert.match(m22,/stage NATIVE_EXECUTOR_QUIESCED; stage HOSTING_OPERATOR_QUIESCED/);
  assert.ok(m22.indexOf('EXECUTOR_UNITS_PREEXISTING=1')<m22.indexOf('IDENTITY_CONVERGENCE_MIGRATION_IDEMPOTENT'),'M22 proves runtime rollback authority before migration');
  assert.match(remote,/IDENTITY_CONVERGENCE_ROUTE/);
  assert.match(remote,/SOURCE_DRIFT_MONITOR_READY/);
  assert.match(remote,/SOURCE_DRIFT_VERIFIED/);
  assert.match(remote,/IDENTITY_CONVERGENCE.*awh-source\.zip/s);
  assert.match(remote,/platform_authority='KRUART'.*school_authority='BAY_EXCUSE_X'/s);
  assert.match(remote,/control_user_profiles WHERE person_type IN \('TEACHER','DIRECTOR'\) OR system_role IN \('TEACHER','DIRECTOR'\)/);
  assert.match(mission,/return modes\[0\]\?\?'--platform-hardening'/);
  assert.match(mission,/--line-oa-gateway/);
  assert.match(operator,/bounded-deploy-mission\.mjs','--line-oa-gateway','--approve'/);
  assert.match(release,/releaseMode'=>'PLATFORM_HARDENING'/);
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
