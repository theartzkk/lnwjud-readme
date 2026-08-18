import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ART_AGENT_VERSION } from '../src/version.js';

test('package, MCP and desktop share the Art Agent release version source', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };
  const server = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8');
  const stdio = await readFile(new URL('../src/stdio.ts', import.meta.url), 'utf8');
  const desktopUi = await readFile(new URL('../src/desktop/ui.ts', import.meta.url), 'utf8');
  const dispatcher = await readFile(new URL('../src/desktop/main.ts', import.meta.url), 'utf8');
  const entrypoint = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');

  assert.equal(pkg.version, ART_AGENT_VERSION);
  assert.match(server, /ART_AGENT_VERSION/);
  assert.match(stdio, /ART_AGENT_VERSION/);
  assert.match(desktopUi, /ART_AGENT_VERSION/);
  assert.match(dispatcher, /startStdioRuntime/);
  assert.match(entrypoint, /startStdioRuntime/);
  assert.doesNotMatch(server, /version:\s*['"]0\.\d/);
  assert.doesNotMatch(stdio, /Art Agent MCP 0\.\d/);
  assert.doesNotMatch(desktopUi, /const VERSION\s*=\s*['"]0\.\d/);
  assert.doesNotMatch(dispatcher, /0\.\d+\.\d+/);
  assert.doesNotMatch(entrypoint, /0\.\d+\.\d+/);
});
