import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync=promisify(execFile);
const script=new URL('../deploy/awh-control-plane/compact-control-release-artifacts.sh',import.meta.url);

test('release artifact compaction preserves rollback history and requires approval to mutate',async()=>{
 const text=await readFile(script,'utf8');
 const result=await execFileAsync('/bin/sh',[script.pathname,'--dry-run']);
 assert.match(result.stdout,/hard-link-only,rollback-history-preserved,bounded-12/);
 assert.match(result.stdout,/RELEASE_COMPACTION_APPLY_REQUIRES_APPROVAL/);
 assert.match(text,/--preview/); assert.match(text,/--apply/); assert.match(text,/--approve/);
 assert.match(text,/\/opt\/awh-hub\/control-releases/); assert.match(text,/\/var\/www\/awh-web\/desktop-artifacts/);
 assert.match(text,/ln "\$object" "\$temp"/); assert.match(text,/cmp -s "\$file" "\$temp"/); assert.match(text,/mv -Tf "\$temp" "\$file"/);
 assert.doesNotMatch(text,/rm\s+-rf|find[^\n]*-delete/);
});
