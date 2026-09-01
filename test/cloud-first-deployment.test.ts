import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync=promisify(execFile); const root=process.cwd();
const deploy=join(root,'deploy/awh-control-plane/deploy-control-plane.sh');
const remote=join(root,'deploy/awh-control-plane/remote-deploy-control-plane.sh');

test('M18 Cloud-first activation contract is additive, rollback-safe and approval-gated',async()=>{
 const release='1818181818181818181818181818181818181818';
 const result=await execFileAsync('/bin/sh',[deploy,'--dry-run','--owner-auth','--cloud-first'],{cwd:root,env:{...process.env,AWH_SOURCE_ROOT:root,AWH_RELEASE_COMMIT:release,AWH_HUB_HOSTNAME:'awh.example'}});
 assert.match(result.stdout,/^M18_DRY_RUN=PASS$/m); assert.match(result.stdout,new RegExp(`^M18_RELEASE=${release}$`,'m'));
 assert.match(result.stdout,/verify-v17-or-v18-authority/); assert.match(result.stdout,/migrate-017-only-from-v17/);
 assert.match(result.stdout,/verify-no-shadow-authority/); assert.match(result.stdout,/quiesce-native-and-hosting-operators/);
 assert.match(result.stdout,/M18_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL/);
 const [local,remoteText,validator]=await Promise.all([readFile(deploy,'utf8'),readFile(remote,'utf8'),readFile(join(root,'deploy/awh-control-plane/validate-remote-output.sh'),'utf8')]);
 assert.match(local,/--cloud-first/); assert.match(local,/RELEASE_ID=m18-/); assert.match(local,/017_cloud_first_control\.sql/);
 assert.match(local,/EXTENSION_MODE_COUNT=.*CLOUD_FIRST/); assert.match(local,/if test \"\$OWNER_LOGIN_PROOF_REQUIRED\" -eq 1; then/); assert.match(local,/if test \"\$OWNER_LOGIN_PROOF_REQUIRED\" -eq 0; then/);
 assert.match(remoteText,/CLOUD_FIRST_MIGRATION_FIRST/); assert.match(remoteText,/CLOUD_FIRST_MIGRATION_IDEMPOTENT/); assert.match(remoteText,/CLOUD_FIRST_MIGRATION_VERIFIED/);
 assert.match(remoteText,/EXTENSION_MODE_COUNT=.*CLOUD_FIRST/); assert.match(remoteText,/if test \"\$OWNER_LOGIN_PROOF_REQUIRED\" -eq 1; then IFS= read -r OWNER_PASSWORD/); assert.match(remoteText,/stage OWNER_AUTH_LOGIN; verify_owner_auth_login/); assert.doesNotMatch(remoteText,/ACCOUNT_HOSTING\" = 0; then\n  stage OWNER_AUTH_LOGIN/);
 assert.match(remoteText,/M18_TABLE_COUNT_BEFORE/); assert.match(remoteText,/class_exists\(\"ZipArchive\"\)/); assert.match(remoteText,/provider-credentials/); assert.match(remoteText,/m18-cloud-first-control/); assert.match(remoteText,/CLOUD_FIRST_ROUTE/); assert.match(remoteText,/test \"\$CLOUD_FIRST\" = 1; then DB_MUTATED=1; stage PROJECT_VAULT_SOURCE_SYNC/);
 assert.ok(remoteText.includes("case \"$DEPLOY_BASE_VERSION\" in 4|5|6|7|8|9|10|11|12|13|14|15|16|17|18)"));
 assert.ok(remoteText.includes("test \"$ACCOUNT_HOSTING\" = 1 || test \"$CLOUD_FIRST\" = 1; } && test \"$DB_MUTATED\" -eq 1; then"));
 assert.match(remoteText,/\n\s*18\).*m18-cloud-first-control.*schema_version = 18/);
 assert.match(remoteText,/control_capability_catalog WHERE capability IN \('qa\.cloud','review\.visual'\)/); assert.match(remoteText,/api\/v1\/control\/cloud/);
 assert.match(validator,/CLOUD_FIRST_MIGRATION_FIRST/); assert.match(validator,/CLOUD_FIRST_ROUTE/);
});
