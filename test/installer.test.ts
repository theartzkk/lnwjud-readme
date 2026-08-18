import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Windows installer configuration stays Squirrel-aware and per-user', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const forge = await readFile(new URL('../forge.config.cjs', import.meta.url), 'utf8');
  const desktop = await readFile(new URL('../src/desktop/main.ts', import.meta.url), 'utf8');

  assert.equal(pkg.version, '0.3.1');
  assert.equal(pkg.dependencies?.['electron-squirrel-startup'], '1.0.1');
  assert.equal(pkg.devDependencies?.['@electron-forge/maker-squirrel'], '7.11.2');
  assert.match(forge, /@electron-forge\/maker-squirrel/);
  assert.match(forge, /setupExe:\s*'ArtAgentSetup\.exe'/);
  assert.match(forge, /noMsi:\s*true/);
  assert.match(desktop, /SQUIRREL_STARTUP/);
  assert.match(desktop, /electron-squirrel-startup/);
});
