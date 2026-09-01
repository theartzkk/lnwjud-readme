import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync=promisify(execFile);
const script=new URL('../deploy/awh-control-plane/provision-image-input-runtime.sh',import.meta.url);

test('HEIC runtime provisioning is explicit, bounded and outside the release transaction',async()=>{
 const text=await readFile(script,'utf8');
 const result=await execFileAsync('/bin/sh',[script.pathname,'--dry-run']);
 assert.match(result.stdout,/IMAGE_INPUT_RUNTIME_APPLY_REQUIRES_APPROVAL/);
 assert.match(text,/--apply/); assert.match(text,/--approve/); assert.match(text,/libvips-tools/); assert.match(text,/\/usr\/bin\/vipsthumbnail/);
 assert.match(text,/VERSION_ID/); assert.match(text,/24\.04/); assert.match(text,/--no-install-recommends/);
 assert.match(text,/libvips42t64/); assert.match(text,/libheif1/); assert.doesNotMatch(text,/curl\s+.*\|\s*sh|wget\s+.*\|\s*sh/);
});
