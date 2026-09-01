import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path:string)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('iPhone HEIC stays canonical while AI input is explicit and provider-safe',async()=>{
 const [store,preparer,native,dashboard]=await Promise.all([
  read('hub/src/HubAttachmentStore.php'),read('hub/src/HubAiAttachmentPreparer.php'),read('hub/src/HubNativeAgentService.php'),read('web/dashboard.js')]);
 assert.match(store,/'heic'\s*=>\s*\['image\/heic',\s*'image\/heif'\]/);
 assert.match(preparer,/\/usr\/bin\/vipsthumbnail/); assert.match(preparer,/image\/heic/); assert.match(preparer,/image\/jpeg/);
 assert.match(preparer,/proc_open\(\$args/); assert.match(preparer,/MAX_IMAGE_EDGE\s*=\s*2048/); assert.match(preparer,/finally\s*\{[^}]*unlink/);
 assert.match(native,/attachmentPreparer->prepare\(\$attachment\)/); assert.match(native,/ATTACHMENT_AI_INPUT_TOO_LARGE/);
 assert.doesNotMatch(native,/8\s*\*\s*1024\s*\*\s*1024\)\s*continue/);
 assert.doesNotMatch(dashboard,/fileList\.length\s*===\s*1/); assert.doesNotMatch(dashboard,/fileList\.length\s*>\s*1\s*&&/);
 assert.match(dashboard,/return \{ kind: 'WORK' \}/);
});
