import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync=promisify(execFile); const root=process.cwd();
const deploy=join(root,'deploy/awh-control-plane/deploy-control-plane.sh');
const remote=join(root,'deploy/awh-control-plane/remote-deploy-control-plane.sh');

test('M15 Automations activation is additive over M14 and rollback-safe',async()=>{
 const release='1515151515151515151515151515151515151515';
 const result=await execFileAsync('/bin/sh',[deploy,'--dry-run','--owner-auth','--automations'],{cwd:root,env:{...process.env,AWH_SOURCE_ROOT:root,AWH_RELEASE_COMMIT:release,AWH_HUB_HOSTNAME:'awh.example'}});
 assert.match(result.stdout,/^M15_DRY_RUN=PASS$/m); assert.match(result.stdout,new RegExp(`^M15_RELEASE=${release}$`,'m'));
 assert.match(result.stdout,/verify-v14-or-v15-authority/); assert.match(result.stdout,/migrate-014-only-from-v14/); assert.match(result.stdout,/restore-exact-db-baseline/); assert.match(result.stdout,/M15_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL/);
 const [local,remoteSource,cli]=await Promise.all([readFile(deploy,'utf8'),readFile(remote,'utf8'),readFile(join(root,'hub/bin/migrate-automations.php'),'utf8')]);
 assert.match(local,/--automations/); assert.match(local,/M15_PLAN=/); assert.match(local,/AUTOMATION_ROUTE/); assert.match(local,/HubAutomationSchedulerService\.php/); assert.match(local,/014_automations\.sql/);
 assert.match(remoteSource,/AUTOMATIONS=\$\{25\}/); assert.match(remoteSource,/case "\$M15_START_VERSION" in 14\|15/); assert.match(remoteSource,/m15-automation-registry/); assert.match(remoteSource,/AUTOMATION_MIGRATION_FIRST/); assert.match(remoteSource,/AUTOMATION_MIGRATION_IDEMPOTENT/); assert.match(remoteSource,/AUTOMATION_MIGRATION_VERIFIED/); assert.match(remoteSource,/AUTOMATION_ROUTE/); assert.match(remoteSource,/NATIVE_EXECUTOR_QUIESCED/);
 assert.match(cli,/HubAutomationMigration::apply/); assert.match(cli,/014_automations\.sql/);
 assert.doesNotMatch(`${local}\n${remoteSource}\n${cli}`,/(?:BEGIN [A-Z ]+PRIVATE KEY|Authorization: Bearer sk-[A-Za-z0-9_-]{20,})/i);
});

test('M15 deployment scripts remain valid POSIX shell',async()=>{await execFileAsync('/bin/sh',['-n',deploy]);await execFileAsync('/bin/sh',['-n',remote]);});
