import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { DEFAULT_AWH_HUB_API_BASE } from '../src/config.js';
import { PRODUCT } from '../src/product.js';

const ROOT = process.cwd();

test('AWH sustainability contract locks durable product and authority identity', async () => {
  const contract = JSON.parse(await readFile(join(ROOT, 'config/awh-product-contract.json'), 'utf8'));
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.product.id, 'awh');
  assert.equal(contract.product.name, PRODUCT.productName);
  assert.equal(contract.product.desktopName, PRODUCT.desktopName);
  assert.equal(contract.product.desktopBundleId, 'com.artworkspacehub.awh');
  assert.equal(contract.product.windowsPackageId, 'AWH');
  assert.equal(contract.authority.defaultApiBase, DEFAULT_AWH_HUB_API_BASE);
  assert.equal(contract.authority.defaultApiBaseStatus, 'PROVISIONAL_IP_BOUND');
  assert.equal(contract.authority.databaseEngine, 'SQLite');
  assert.equal(contract.authority.apiMajor, 'v1');
  assert.equal(contract.data.principle, 'Everything replaceable except identity and data');
});

test('desktop release contract is install-once ready without pretending updater activation', async () => {
  const contract = JSON.parse(await readFile(join(ROOT, 'config/awh-product-contract.json'), 'utf8'));
  assert.deepEqual(contract.release.channels, ['stable', 'preview']);
  assert.equal(contract.release.defaultChannel, 'stable');
  assert.equal(contract.release.evergreenDesktopRequired, true);
  assert.equal(contract.release.updaterStatus, 'FOUNDATION_LOCKED_NOT_ACTIVATED');
  assert.equal(contract.release.desktopCompatibility, 'current-and-previous-minor');
  for (const gate of ['ci', 'hub-test', 'package-runtime', 'backup-verified', 'migration-plan', 'rollback-plan']) {
    assert.ok(contract.release.stableRequires.includes(gate), `missing stable release gate ${gate}`);
  }
});

test('desktop packaging preserves one stable app identity for future in-place updates', async () => {
  const forge = await readFile(join(ROOT, 'forge.config.cjs'), 'utf8');
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.productName, 'Art’s Workspace Hub');
  assert.match(forge, /appBundleId:\s*'com\.artworkspacehub\.awh'/);
  assert.match(forge, /name:\s*'AWH'/);
  assert.match(forge, /setupExe:\s*'AWHSetup\.exe'/);
  assert.doesNotMatch(forge, /com\.[\w.-]*art-agent/i);
});

test('sustainability contract never embeds credential material', async () => {
  const text = await readFile(join(ROOT, 'config/awh-product-contract.json'), 'utf8');
  assert.doesNotMatch(text, /api[_-]?key|password|bearer|private[_-]?key|refresh[_-]?token/i);
});
