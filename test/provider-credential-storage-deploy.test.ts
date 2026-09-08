import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT=process.cwd();

test('M20 deploy repairs only the proven legacy provider credential ownership drift',async()=>{
  const script=await readFile(join(ROOT,'deploy/awh-control-plane/remote-deploy-control-plane.sh'),'utf8');
  const start=script.indexOf('reconcile_provider_credential_storage() {');
  const end=script.indexOf('\nreload_awh_php_fpm()',start);
  assert.ok(start>=0&&end>start);
  const fn=script.slice(start,end);
  assert.match(fn,/CREDENTIAL_STATE.*root:awh-hub:750/);
  assert.match(fn,/CREDENTIAL_OWNER.*root:awh-hub:640/);
  assert.match(fn,/CREDENTIAL_COUNT.*-le 32/);
  assert.match(fn,/CREDENTIAL_SIZE.*-le 4096/);
  assert.match(fn,/! -type f -print -quit/);
  assert.match(fn,/sudo tar -cpf/);
  assert.match(fn,/sha256sum -- \*\.key/);
  assert.match(fn,/sha256sum -c/);
  assert.match(fn,/chown awh-hub:awh-hub "\$CREDENTIAL_DIR"/);
  assert.match(fn,/chmod 0700 "\$CREDENTIAL_DIR"/);
  assert.match(fn,/chmod 0600 "\$CREDENTIAL_DIR"\/\*\.key/);
  assert.match(fn,/PROVIDER_CREDENTIAL_STORAGE_RECONCILED/);
  assert.doesNotMatch(fn,/chown -R|chmod -R/);
});

test('current M18-M20 refresh paths invoke reconciliation before the writable-store gate',async()=>{
  const script=await readFile(join(ROOT,'deploy/awh-control-plane/remote-deploy-control-plane.sh'),'utf8');
  const gate='reconcile_provider_credential_storage; stage PROVIDER_CREDENTIAL_STORAGE_READY;';
  assert.ok(script.split(gate).length-1>=3);
  assert.match(script,/test "\$\(sudo stat -c '%U:%G:%a' \/var\/lib\/awh-hub\/provider-credentials\)" = 'awh-hub:awh-hub:700'/);
  assert.match(script,/sudo -u awh-hub test -w \/var\/lib\/awh-hub\/provider-credentials/);
});
