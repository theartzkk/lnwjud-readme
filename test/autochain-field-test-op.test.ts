import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Auto-Chain field test is a fixed enrolled-worker operation with no free-form authority', async () => {
  const script = await readFile(new URL('../scripts/ops/autochain-field-test.mjs', import.meta.url), 'utf8');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['ops:autochain:field-test'], 'node --import tsx scripts/ops/autochain-field-test.mjs');
  assert.match(script, /ControlPlaneWorkerClient/);
  assert.match(script, /createDesktopCredentialStore/);
  assert.match(script, /read-only/);
  assert.match(script, /AUTOCHAIN_FIELD_CONTINUATION_NOT_OBSERVED/);
  assert.doesNotMatch(script, /process\.argv|exec\(|spawn\(|shell:/);
  assert.match(script, /ห้ามแก้ source deploy secret billing หรือ permission/);
  assert.doesNotMatch(script, /--deploy|--approve|--activate|process\.argv|exec\(|spawn\(|shell:/i);
});