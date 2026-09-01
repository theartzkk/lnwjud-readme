import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync=promisify(execFile); const root=process.cwd();
const deploy=join(root,'deploy/awh-control-plane/deploy-control-plane.sh');
const remote=join(root,'deploy/awh-control-plane/remote-deploy-control-plane.sh');

test('M19 conversation lifecycle activation stays in the canonical deploy authority',async()=>{
 const release='1919191919191919191919191919191919191919';
 const result=await execFileAsync('/bin/sh',[deploy,'--dry-run','--owner-auth','--conversation-lifecycle'],{cwd:root,env:{...process.env,AWH_SOURCE_ROOT:root,AWH_RELEASE_COMMIT:release,AWH_HUB_HOSTNAME:'awh.example'}});
 assert.match(result.stdout,/^M19_DRY_RUN=PASS$/m); assert.match(result.stdout,new RegExp(`^M19_RELEASE=${release}$`,'m'));
 assert.match(result.stdout,/verify-v18-or-v19-authority/); assert.match(result.stdout,/migrate-018-only-from-v18/);
 assert.match(result.stdout,/quiesce-native-and-hosting-operators/); assert.match(result.stdout,/heic-vision-runtime-ready/); assert.match(result.stdout,/M19_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL/);
 const [local,remoteText,validator]=await Promise.all([readFile(deploy,'utf8'),readFile(remote,'utf8'),readFile(join(root,'deploy/awh-control-plane/validate-remote-output.sh'),'utf8')]);
 assert.match(local,/--conversation-lifecycle/); assert.match(local,/RELEASE_ID=m19-/); assert.match(local,/018_conversation_lifecycle\.sql/); assert.match(local,/HubConversationLifecycleMigration\.php/);
 assert.match(remoteText,/CONVERSATION_MIGRATION_FIRST/); assert.match(remoteText,/CONVERSATION_MIGRATION_IDEMPOTENT/); assert.match(remoteText,/CONVERSATION_MIGRATION_VERIFIED/); assert.match(remoteText,/CONVERSATION_LIFECYCLE_ROUTE/);
 assert.match(remoteText,/m18-cloud-first-control/); assert.match(remoteText,/IMAGE_INPUT_RUNTIME_READY/); assert.match(remoteText,/\/usr\/bin\/vipsthumbnail/); assert.doesNotMatch(remoteText,/heif-convert/); assert.doesNotMatch(remoteText,/apt-get|apt\s+install/); assert.match(remoteText,/deleted_at/); assert.match(remoteText,/deleted_by_user_id/); assert.match(remoteText,/PROJECT_VAULT_SOURCE_SYNC/);
 assert.match(validator,/IMAGE_INPUT_RUNTIME_READY/); assert.match(validator,/CONVERSATION_MIGRATION_FIRST/); assert.match(validator,/CONVERSATION_LIFECYCLE_ROUTE/);
});
