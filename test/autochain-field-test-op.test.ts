import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('bounded Auto-Chain field proof uses the enrolled client and canonical lineage only', async () => {
  const source = await readFile(new URL('../scripts/ops/autochain-field-test.mjs', import.meta.url), 'utf8');
  assert.match(source, /ControlPlaneWorkerClient/);
  assert.match(source, /createDesktopCredentialStore/);
  assert.match(source, /DEVICE_TOKEN_CREDENTIAL_KEY/);
  assert.match(source, /rootTaskId/);
  assert.match(source, /executorKind !== 'VPS'/);
  assert.match(source, /requiredCapability !== 'project\.read'/);
  assert.match(source, /setTimeout/);
  assert.doesNotMatch(source, /process\.argv|child_process|spawn\(|exec\(|deploy\.(?:sh|mjs)|--deploy/i);
  assert.match(source, /read-only/);
});
