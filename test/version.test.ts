import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ART_AGENT_VERSION, RELEASE_VERSION } from '../src/version.js';

test('package, MCP and desktop share the AWH release version source', async () => {
  const [pkg, lock] = await Promise.all([
    readFile(new URL('../package.json', import.meta.url), 'utf8').then((raw) => JSON.parse(raw) as { version?: string }),
    readFile(new URL('../package-lock.json', import.meta.url), 'utf8').then((raw) => JSON.parse(raw) as { version?: string; packages?: { '': { version?: string } } }),
  ]);
  const server = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8');
  const stdio = await readFile(new URL('../src/stdio.ts', import.meta.url), 'utf8');
  const desktop = await readFile(new URL('../src/desktop/main.ts', import.meta.url), 'utf8');
  const entrypoint = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');

  assert.equal(pkg.version, ART_AGENT_VERSION);
  assert.equal(pkg.version, RELEASE_VERSION);
  assert.equal(pkg.version, '1.0.0-rc.1');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages?.['']?.version, pkg.version);
  assert.match(server, /ART_AGENT_VERSION/);
  assert.match(stdio, /ART_AGENT_VERSION/);
  assert.match(desktop, /RELEASE_VERSION/);
  assert.match(entrypoint, /startStdioRuntime/);
  assert.doesNotMatch(server, /version:\s*['"]0\.\d/);
  assert.doesNotMatch(stdio, /Art Agent MCP 0\.\d/);
  assert.doesNotMatch(desktop, /const VERSION\s*=\s*['"]0\.\d/);
  assert.doesNotMatch(entrypoint, /0\.\d+\.\d+/);
});
