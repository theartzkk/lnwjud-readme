import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PRODUCT } from '../src/product.js';
import { ART_AGENT_VERSION, RELEASE_VERSION } from '../src/version.js';

test('AWH public release identity is distinct from retained legacy compatibility identifiers', async () => {
  const [pkg, lock, forge] = await Promise.all([
    readFile(new URL('../package.json', import.meta.url), 'utf8').then((raw) => JSON.parse(raw) as Record<string, any>),
    readFile(new URL('../package-lock.json', import.meta.url), 'utf8').then((raw) => JSON.parse(raw) as Record<string, any>),
    readFile(new URL('../forge.config.cjs', import.meta.url), 'utf8'),
  ]);
  assert.equal(RELEASE_VERSION, '0.5.0');
  assert.equal(ART_AGENT_VERSION, RELEASE_VERSION);
  assert.equal(pkg.version, RELEASE_VERSION);
  assert.equal(lock.version, RELEASE_VERSION);
  assert.equal(lock.packages[''].version, RELEASE_VERSION);
  assert.equal(pkg.productName, PRODUCT.productName);
  assert.equal(pkg.author, PRODUCT.productName);
  assert.equal(pkg.bin.awh, 'dist/index.js');
  assert.equal(pkg.bin['art-agent'], 'dist/index.js');
  assert.doesNotMatch([pkg.productName, pkg.author, pkg.description].join('\n'), /Art Agent/);
  assert.match(forge, /name:\s*'AWH'/);
  assert.match(forge, /executableName:\s*'AWH'/);
  assert.match(forge, /exe:\s*'AWH\.exe'/);
  assert.match(forge, /setupExe:\s*'AWHSetup\.exe'/);
});

test('AWH keeps the explicit legacy CLI alias without creating a second engine', () => {
  assert.equal(PRODUCT.legacyCodename, 'Art Agent');
  assert.equal(PRODUCT.legacyPackageId, 'art-agent');
});
