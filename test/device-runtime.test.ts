import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deviceProvidersForCapability, discoverAwhDeviceRuntime } from '../src/device-runtime.js';

test('device runtime ignores standalone RDC while preserving a dynamic loopback GUI endpoint', async () => {
  const home = await mkdtemp(join(tmpdir(), 'awh-device-runtime-'));
  const support = join(home, 'Library', 'Application Support', 'lnwjud', 'tunnel-client');
  await mkdir(support, { recursive: true });
  await writeFile(join(support, 'lnwjud.yaml'), JSON.stringify({ mcp: { server_urls: [{ url: 'http://127.0.0.1:59702/mcp' }] } }));
  const runtime = await discoverAwhDeviceRuntime({
    home,
    platform: 'darwin',
    pathAvailable: async () => false,
    tcpReady: async (url) => url === 'http://127.0.0.1:59702/mcp',
  });
  assert.deepEqual(runtime, { guiMcpUrl: 'http://127.0.0.1:59702/mcp', guiMcpCommand: null, guiToolkitCommand: null, systemMcpCommand: null });
});

test('device runtime rejects non-loopback or unavailable GUI endpoints', async () => {
  const home = await mkdtemp(join(tmpdir(), 'awh-device-runtime-'));
  const support = join(home, 'Library', 'Application Support', 'lnwjud', 'tunnel-client');
  await mkdir(support, { recursive: true });
  await writeFile(join(support, 'lnwjud.yaml'), JSON.stringify({ mcp: { server_urls: [{ url: 'https://example.com/mcp' }] } }));
  const runtime = await discoverAwhDeviceRuntime({ home, platform: 'darwin', pathAvailable: async () => false, tcpReady: async () => true });
  assert.deepEqual(runtime, { guiMcpUrl: null, guiMcpCommand: null, guiToolkitCommand: null, systemMcpCommand: null });
});

test('provider-neutral KRUART GUI discovery does not import standalone RDC into AWH', async () => {
  const home = '/Users/fixture';
  const gui = join(home, '.kruart', 'ai-control', 'kui');
  const runtime = await discoverAwhDeviceRuntime({
    home,
    platform: 'darwin',
    pathAvailable: async (path) => path === gui,
    tcpReady: async () => false,
  });
  assert.deepEqual(runtime, { guiMcpUrl: null, guiMcpCommand: null, guiToolkitCommand: gui, systemMcpCommand: null });
});

test('device runtime prefers the local AWH lnwjud stdio bridge when installed', async () => {
  const home = '/Users/fixture';
  const bridge = join(home, '.awh', 'bin', 'awh-mcp-stdio');
  const runtime = await discoverAwhDeviceRuntime({
    home,
    platform: 'darwin',
    pathAvailable: async (path) => path === bridge,
    tcpReady: async () => false,
  });
  assert.deepEqual(runtime, { guiMcpUrl: null, guiMcpCommand: bridge, guiToolkitCommand: null, systemMcpCommand: bridge });
});

test('capability selects only the provider class it actually needs', () => {
  assert.deepEqual(deviceProvidersForCapability('device.gui.inspect'), { gui: true, system: false });
  assert.deepEqual(deviceProvidersForCapability('browser.automation'), { gui: true, system: false });
  assert.deepEqual(deviceProvidersForCapability('creative.photoshop'), { gui: true, system: true });
  assert.deepEqual(deviceProvidersForCapability('workspace.files'), { gui: false, system: true });
  assert.deepEqual(deviceProvidersForCapability('device.process'), { gui: false, system: true });
  assert.deepEqual(deviceProvidersForCapability('unknown.capability'), { gui: false, system: false });
});
