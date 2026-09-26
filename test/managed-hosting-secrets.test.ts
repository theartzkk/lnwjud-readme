import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('managed hosting secrets are generic, write-only and injected only at runtime', async () => {
  const service = await readFile(new URL('../hub/src/HubManagedHostingService.php', import.meta.url), 'utf8');
  const operator = await readFile(new URL('../hub/src/HubManagedHostingOperator.php', import.meta.url), 'utf8');
  const trust = await readFile(new URL('../hub/src/HubTrustPolicy.php', import.meta.url), 'utf8');

  assert.match(trust, /hosting\.site\.secrets/);
  assert.match(trust, /integration\.command\.credential/);
  assert.match(service, /HubProviderCredentialStore::fromEnvironment\('hosting\.site\.'/);
  assert.match(service, /valuesNeverReturned/);
  assert.match(service, /redeployRequired/);
  assert.match(operator, /array_merge\(\$db\['env'\],\$this->siteSecrets/);
  assert.match(operator, /HubProviderCredentialStore::fromEnvironment\('hosting\.site\.'/);
  assert.doesNotMatch(service, /LINE_CHANNEL_SECRET|LINE_CHANNEL_ACCESS_TOKEN/);
  assert.doesNotMatch(operator, /LINE_CHANNEL_SECRET|LINE_CHANNEL_ACCESS_TOKEN/);
});
