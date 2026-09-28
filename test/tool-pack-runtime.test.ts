import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { activateToolPackAfterSmoke, inspectToolPack, installedToolPackCapabilities, provisionableToolPackCapabilities, TOOL_PACKS, toolPackForCapability, toolPackRoot, type ToolPackDefinition } from '../src/tool-pack-runtime.js';

async function touch(path: string, content = ''): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

async function fixture(home: string, pack: ToolPackDefinition, connector = true): Promise<void> {
  const root = toolPackRoot(pack, 'darwin', home, process.env);
  await touch(join(home, 'Library', 'Application Support', 'AWH', 'Toolchain', 'node-24.21.0-x64', 'bin', 'node'), '#!/bin/sh\n');
  await touch(join(root, 'node_modules', ...pack.packageName.split('/'), 'package.json'), JSON.stringify({ name: pack.packageName, version: pack.version }));
  await touch(join(root, ...pack.entry), '#!/usr/bin/env node\n');
  await touch(join(root, 'package-lock.json'), JSON.stringify({ packages: { ['node_modules/' + pack.packageName]: { version: pack.version, integrity: pack.integrity } } }));
  if (!connector || pack.host === 'browser') return;
  const extension = pack.host === 'aftereffects' ? 'games.engine-room.ae-mcp' : 'MCPBridgeCEP';
  await touch(
    join(home, 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions', extension, 'CSXS', 'manifest.xml'),
    `<ExtensionManifest ExtensionBundleVersion="${pack.version}"></ExtensionManifest>`,
  );
}

test('Tool Fabric pins one exact audited package per capability and never uses floating latest tags', () => {
  assert.deepEqual(TOOL_PACKS.map((pack) => [pack.capability, pack.version]), [
    ['web.interact', '0.0.82'],
    ['web.debug', '1.10.1'],
    ['creative.aftereffects', '0.5.1'],
    ['creative.premiere', '1.18.2'],
  ]);
  assert.equal(new Set(TOOL_PACKS.map((pack) => pack.capability)).size, TOOL_PACKS.length);
  for (const pack of TOOL_PACKS) {
    assert.match(pack.integrity, /^sha512-/);
    assert.doesNotMatch(pack.version, /latest|next|beta|\*/i);
    assert.equal(toolPackForCapability(pack.capability)?.id, pack.id);
    assert.ok(['MIT','Apache-2.0'].includes(pack.license));
  }
  assert.equal(toolPackForCapability('browser.playwright')?.id, 'browser.playwright');
  assert.equal(toolPackForCapability('browser.debug')?.id, 'browser.devtools');
  assert.equal(toolPackForCapability('creative.unknown'), null);
  const browser = toolPackForCapability('web.interact');
  assert.ok(browser);
  assert.match(toolPackRoot(browser, 'darwin', '/tmp/awh-tool-pack-root', process.env), /ToolPacks\/web\.interact\/releases\/0\.0\.82-[a-f0-9]{16}$/);
  const premiere = toolPackForCapability('creative.premiere');
  assert.ok(premiere);
  const exactRoot = toolPackRoot(premiere, 'darwin', '/tmp/awh-tool-pack-root', process.env);
  assert.match(exactRoot, /ToolPacks\/creative\.premiere\/releases\/1\.18\.2-[a-f0-9]{16}$/);
  const driftedRoot = toolPackRoot({ ...premiere, integrity: 'sha512-different-provenance' }, 'darwin', '/tmp/awh-tool-pack-root', process.env);
  assert.notEqual(driftedRoot, exactRoot, 'integrity drift must select a different immutable release root');
});

test('Tool Pack capability requires exact package integrity, matching host, and connector readiness', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'awh-tool-pack-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const hostAvailable = async () => true;

  for (const pack of TOOL_PACKS) {
    await fixture(home, pack, true);
    const state = await inspectToolPack(pack, 'darwin', 'x64', home, process.env, hostAvailable);
    assert.equal(state.installed, true, pack.id + ' installed');
    assert.equal(state.verified, true, pack.id + ' verified');
    assert.equal(state.hostReady, true, pack.id + ' host');
    assert.equal(state.connectorReady, true, pack.id + ' connector');
    assert.equal(state.reason, null, pack.id + ' reason');
  }
});

test('Creative Tool Pack stays non-routable when its Adobe connector is missing', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'awh-tool-pack-connector-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const pack = toolPackForCapability('creative.aftereffects');
  assert.ok(pack);
  await fixture(home, pack, false);
  const state = await inspectToolPack(pack, 'darwin', 'x64', home, process.env, async () => true);
  assert.equal(state.verified, true);
  assert.equal(state.hostReady, true);
  assert.equal(state.connectorReady, false);
  assert.equal(state.reason, 'HOST_CONNECTOR_MISSING');
});

test('Tool Pack integrity mismatch fails closed even when host and connector exist', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'awh-tool-pack-integrity-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const pack = toolPackForCapability('creative.premiere');
  assert.ok(pack);
  await fixture(home, pack, true);
  const root = toolPackRoot(pack, 'darwin', home, process.env);
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({ packages: { ['node_modules/' + pack.packageName]: { version: pack.version, integrity: 'sha512-tampered' } } }), 'utf8');
  const state = await inspectToolPack(pack, 'darwin', 'x64', home, process.env, async () => true);
  assert.equal(state.installed, true);
  assert.equal(state.verified, false);
  assert.equal(state.connectorReady, false);
  assert.equal(state.reason, 'PACKAGE_INTEGRITY_MISMATCH');
});


test('lazy Tool Pack routing separates provisionable capability from verified Stable activation', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'awh-tool-pack-lazy-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const browserHost = async (path: string) => path.includes('Google Chrome');
  const provisionable = await provisionableToolPackCapabilities('darwin', home, {}, browserHost);
  assert.deepEqual(provisionable, ['browser.debug', 'browser.playwright', 'web.debug', 'web.interact']);

  const pack = toolPackForCapability('web.interact');
  assert.ok(pack);
  await fixture(home, pack, true);
  const before = await installedToolPackCapabilities('darwin', 'x64', home, {}, async () => true);
  assert.deepEqual(before.capabilities, [], 'a package on disk is not executable authority before Stable activation');

  const state = await inspectToolPack(pack, 'darwin', 'x64', home, {}, async () => true);
  await activateToolPackAfterSmoke(pack, state, 'darwin', home, {});
  const after = await installedToolPackCapabilities('darwin', 'x64', home, {}, async () => true);
  assert.deepEqual(after.capabilities, ['browser.playwright', 'web.interact']);
  assert.deepEqual(after.tools, ['tool.pack.playwright']);
});
