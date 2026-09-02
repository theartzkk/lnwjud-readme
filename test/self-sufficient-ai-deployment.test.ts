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
 const local=await readFile(deploy,'utf8');
 assert.match(local,/hub\/src\/HubAiQualificationService\.php/);
});


test('release retry identity is bound before the web build and strictly bounded',async()=>{
 const release='1616161616161616161616161616161616161616';
 await execFileAsync('/bin/sh',[deploy,'--dry-run','--owner-auth','--self-sufficient-ai'],{cwd:root,env:{...process.env,AWH_SOURCE_ROOT:root,AWH_RELEASE_COMMIT:release,AWH_HUB_HOSTNAME:'awh.example',AWH_RELEASE_ATTEMPT:'r2'}});
 const sw=await readFile(join(root,'dist-web/sw.js'),'utf8');
 assert.match(sw,/awh-shell-m16-161616161616-r2/);
 await assert.rejects(execFileAsync('/bin/sh',[deploy,'--dry-run','--owner-auth','--self-sufficient-ai'],{cwd:root,env:{...process.env,AWH_SOURCE_ROOT:root,AWH_RELEASE_COMMIT:release,AWH_HUB_HOSTNAME:'awh.example',AWH_RELEASE_ATTEMPT:'r0'}}),/AWH_RELEASE_ATTEMPT must be empty or r1\.\.r999/);
 const remoteSource=await readFile(remote,'utf8');
 assert.match(remoteSource,/m\(4\|6\|7\|8\|9\|10\|11\|12\|13\|14\|15\|16\|17\|18\|19\|20\).*12.*r\[1-9\]/s);
});
