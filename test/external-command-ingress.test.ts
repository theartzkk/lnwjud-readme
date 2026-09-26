import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('external command ingress is transport-neutral and HMAC bounded', async () => {
  const service = await readFile(new URL('../hub/src/HubControlPlaneService.php', import.meta.url), 'utf8');
  const router = await readFile(new URL('../hub/src/HubControlPlaneRouter.php', import.meta.url), 'utf8');

  assert.match(service, /AWH_EXTERNAL_COMMAND_SECRET/);
  assert.match(service, /hash_hmac\('sha256'/);
  assert.match(service, /abs\(\$serverAt-\$requestAt\)>300/);
  assert.match(service, /externalOwnerUserId/);
  assert.match(service, /submitConversationForUser/);
  assert.match(router, /\/api\/v1\/integrations\/commands/);
  assert.match(router, /HTTP_X_AWH_COMMAND_SIGNATURE/);
  assert.match(router, /HTTP_X_AWH_COMMAND_TIMESTAMP/);

  const ingress = service.slice(service.indexOf('public function externalCommand'), service.indexOf('public function automations'));
  assert.doesNotMatch(ingress, /LINE|line[_ -]?oa|Messaging API|replyToken/i);
  assert.doesNotMatch(router, /X-LINE-SIGNATURE|line\/awh/i);
});
