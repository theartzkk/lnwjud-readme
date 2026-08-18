import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ART_AGENT_VERSION } from '../src/version.js';

test('package, MCP and desktop share the Art Agent release version source', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };
  const server = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8');
  const desktop = await readFile(new URL('../src/desktop/main.ts', import.meta.url), 'utf8');
  const entrypoint = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');

  assert.equal(pkg.version, ART_AGENT_VERSION);
  assert.match(server, /ART_AGENT_VERSION/);
  assert.match(desktop, /ART_AGENT_VERSION/);
  assert.match(entrypoint, /ART_AGENT_VERSION/);
  assert.doesNotMatch(server, /version:\s*['"]0\.\d/);
  assert.doesNotMatch(desktop, /const VERSION\s*=\s*['"]0\.\d/);
  assert.doesNotMatch(entrypoint, /Art Agent MCP 0\.\d/);
});
