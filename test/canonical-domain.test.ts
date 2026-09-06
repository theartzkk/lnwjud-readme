import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const TEXT_FILES = [
  'config/awh-product-contract.json',
  'src/config.ts',
  'deploy/awh-control-plane/deploy-control-plane.sh',
  'scripts/ops/basic-auth-rotation.mjs',
  'web/hosting.js',
];

test('kruart.online is the canonical AWH public origin', async () => {
  const contract = JSON.parse(await readFile('config/awh-product-contract.json', 'utf8'));
  assert.equal(contract.authority.canonicalOrigin, 'https://kruart.online');
  assert.equal(contract.authority.defaultApiBase, 'https://kruart.online/api/v1');
  assert.equal(contract.authority.defaultApiBaseStatus, 'CANONICAL_DOMAIN');
  for (const file of TEXT_FILES) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /157-85-108-142\.sslip\.io/, `${file} regressed to the legacy public origin`);
  }
});

test('canonical HTTPS template publishes transport and browser capability boundaries', async () => {
  const nginx = await readFile('deploy/nginx/awh-preview.conf', 'utf8');
  assert.match(nginx, /Strict-Transport-Security \"max-age=15552000\" always/);
  assert.match(nginx, /Permissions-Policy \"camera=\(\), microphone=\(\), geolocation=\(\), payment=\(\), usb=\(\)\" always/);
});
