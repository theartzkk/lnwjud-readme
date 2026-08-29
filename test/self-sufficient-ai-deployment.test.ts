import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync=promisify(execFile); const root=process.cwd();
const deploy=join(root,'deploy/awh-control-plane/deploy-control-plane.sh');
const remote=join(root,'deploy/awh-control-plane/remote-deploy-control-plane.sh');

test('M16 self-sufficient AI activation is additive, guarded and rollback-safe',async()=>{
 const release='1616161616161616161616161616161616161616';
 const result=await execFileAsync('/bin/sh',[deploy,'--dry-run','--owner-auth','--self-sufficient-ai'],{cwd:root,env:{...process.env,AWH_SOURCE_ROOT:root,AWH_RELEASE_COMMIT:release,AWH_HUB_HOSTNAME:'awh.example'}});
 assert.match(result.stdout,/^M16_DRY_RUN=PASS$/m); assert.match(result.stdout,new RegExp(`^M16_RELEASE=${release}$`,'m'));
 assert.match(result.stdout,/verify-v15-or-v16-authority/); assert.match(result.stdout,/migrate-015-only-from-v15/); assert.match(result.stdout,/source-refresh-without-migration-on-v16/);
 assert.match(result.stdout,/restore-exact-db-baseline/); assert.match(result.stdout,/M16_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL/);
});
