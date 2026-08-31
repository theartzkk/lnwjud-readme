import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync=promisify(execFile); const root=process.cwd();
const deploy=join(root,'deploy/awh-control-plane/deploy-control-plane.sh');
const remote=join(root,'deploy/awh-control-plane/remote-deploy-control-plane.sh');

test('M17 Account + Managed Hosting activation is additive, typed and approval-gated',async()=>{
 const release='1717171717171717171717171717171717171717';
 const result=await execFileAsync('/bin/sh',[deploy,'--dry-run','--owner-auth','--account-hosting'],{cwd:root,env:{...process.env,AWH_SOURCE_ROOT:root,AWH_RELEASE_COMMIT:release,AWH_HUB_HOSTNAME:'awh.example'}});
 assert.match(result.stdout,/^M17_DRY_RUN=PASS$/m); assert.match(result.stdout,new RegExp(`^M17_RELEASE=${release}$`,'m'));
 assert.match(result.stdout,/verify-v16-or-v17-authority/); assert.match(result.stdout,/migrate-016-only-from-v16/);
 assert.match(result.stdout,/typed-hosting-operator/); assert.match(result.stdout,/restore-exact-db-baseline/);
 assert.match(result.stdout,/M17_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL/);
 const [local,remoteText,service,timer,build,verifier,operator]=await Promise.all([
  readFile(deploy,'utf8'),readFile(remote,'utf8'),readFile(join(root,'deploy/systemd/awh-hosting-operator.service'),'utf8'),readFile(join(root,'deploy/systemd/awh-hosting-operator.timer'),'utf8'),readFile(join(root,'scripts/build-web-preview.ts'),'utf8'),readFile(join(root,'deploy/awh-control-plane/verify-web-release.php'),'utf8'),readFile(join(root,'hub/src/HubManagedHostingOperator.php'),'utf8')]);
 assert.match(local,/--account-hosting/); assert.match(local,/hub\/migrations\/016_account_hosting\.sql/); assert.match(local,/dist-web\/hosting\.html/);
 assert.match(remoteText,/ACCOUNT_HOSTING_MIGRATION_FIRST/); assert.match(remoteText,/HOSTING_OPERATOR_UNITS_READY/); assert.match(remoteText,/ACCOUNT_HOSTING_ROUTE/);
 assert.match(service,/^\[Unit\]/m); assert.doesNotMatch(service,/AWH_PUBLIC_HOST=157\.85\.108\.142/); assert.match(service,/ExecStart=\/usr\/bin\/php .*awh-hosting-operator\.php/); assert.doesNotMatch(service,/sh -c|bash -c/);
 assert.match(timer,/OnUnitActiveSec=30s/); assert.match(operator,/does match certificate/); assert.match(operator,/letsencrypt\/live/); assert.match(build,/asset\('hosting\.html'\)/); assert.match(verifier,/'hosting\.html'/);
});

test('M17 PHP authority and web package are regression-checked',async()=>{
 const php=await execFileAsync('/opt/local/bin/php',['hub/tests/m17-account-hosting.php'],{cwd:root});
 assert.match(php.stdout,/AWH M17 Account Hosting: PASS/);
 await execFileAsync(process.execPath,['--import','tsx','scripts/build-web-preview.ts','--control'],{cwd:root,env:{...process.env,AWH_WEB_RELEASE_ID:'m17-test'}});
 for(const name of ['hosting.html','hosting.css','hosting.js']) assert.match(await readFile(join(root,'dist-web',name),'utf8'),/AWH|Hosting|hosting/i);
});
