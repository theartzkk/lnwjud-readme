import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path:string)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('policy-paused AI work does not degrade platform readiness',async()=>{
 const service=await read('hub/src/HubControlPlaneService.php');
 assert.match(service,/policyPausedCount/);
 assert.match(service,/COALESCE\(last_error_code,''\) NOT IN \('BUDGET_EXHAUSTED','PROVIDER_QUOTA_EXHAUSTED'\)/);
 assert.match(service,/last_error_code IN \('BUDGET_EXHAUSTED','PROVIDER_QUOTA_EXHAUSTED'\)/);
 assert.match(service,/\$state = !\$integrity \? 'ACTION_REQUIRED' : \(!\$nativeReady \|\| \(int\) \$waiting > 0 \? 'PARTIALLY_READY' : 'READY'\)/);
});

test('new control releases share desktop artifact objects instead of duplicating binaries',async()=>{
 const remote=await read('deploy/awh-control-plane/remote-deploy-control-plane.sh');
 assert.match(remote,/deduplicate_control_release_desktop_artifacts\(\)/);
 assert.match(remote,/\$RELEASE\/dist-web\/downloads\/\$name/);
 assert.match(remote,/\/var\/www\/awh-web\/desktop-artifacts/);
 assert.match(remote,/deduplicate_desktop_artifacts; deduplicate_control_release_desktop_artifacts;/);
 assert.match(remote,/stat -c %d/); assert.match(remote,/stat -c %i/);
});
