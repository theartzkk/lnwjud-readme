import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deviceProvidersForCapability, discoverAwhDeviceRuntime } from '../src/device-runtime.js';

test('device runtime discovers dynamic loopback GUI MCP and system provider', async () => {
  const home = await mkdtemp(join(tmpdir(), 'awh-device-runtime-'));
  const support = join(home, 'Library', 'Application Support', 'lnwjud', 'tunnel-client');
  await mkdir(support, { recursive: true });
  await writeFile(join(support, 'lnwjud.yaml'), JSON.stringify({ mcp: { server_urls: [{ url: 'http://127.0.0.1:59702/mcp' }] } }));
  const system = join(home, '.local', 'share', 'bay-remote', 'node_modules', '.bin', 'desktop-commander');
  const runtime = await discoverAwhDeviceRuntime({
    home,
    platform: 'darwin',
    pathAvailable: async (path) => path === system,
    tcpReady: async (url) => url === 'http://127.0.0.1:59702/mcp',
  });
  assert.deepEqual(runtime, { guiMcpUrl: 'http://127.0.0.1:59702/mcp', guiToolkitCommand: null, systemMcpCommand: system });
});

test('device runtime rejects non-loopback or unavailable GUI endpoints', async () => {
  const home = await mkdtemp(join(tmpdir(), 'awh-device-runtime-'));
  const support = join(home, 'Library', 'Application Support', 'lnwjud', 'tunnel-client');
  await mkdir(support, { recursive: true });
  await writeFile(join(support, 'lnwjud.yaml'), JSON.stringify({ mcp: { server_urls: [{ url: 'https://example.com/mcp' }] } }));
  const runtime = await discoverAwhDeviceRuntime({ home, platform: 'darwin', pathAvailable: async () => false, tcpReady: async () => true });
  assert.deepEqual(runtime, { guiMcpUrl: null, guiToolkitCommand: null, systemMcpCommand: null });
});

test('device runtime discovers KRUART GUI toolkit as a provider-neutral fallback beside AWH system runtime', async () => {
  const home = '/Users/fixture';
  const gui = join(home, '.kruart', 'ai-control', 'kui');
  const system = join(home, 'Library', 'Application Support', 'AWH', 'RemoteWorker', 'runtime', 'node_modules', '.bin', 'desktop-commander');
  const runtime = await discoverAwhDeviceRuntime({
    home,
    platform: 'darwin',
    pathAvailable: async (path) => path === gui || path === system,
    tcpReady: async () => false,
  });
  assert.deepEqual(runtime, { guiMcpUrl: null, guiToolkitCommand: gui, systemMcpCommand: system });
});

test('capability selects only the provider class it actually needs', () => {
  assert.deepEqual(deviceProvidersForCapability('device.gui.inspect'), { gui: true, system: false });
  assert.deepEqual(deviceProvidersForCapability('browser.automation'), { gui: true, system: false });
  assert.deepEqual(deviceProvidersForCapability('workspace.files'), { gui: false, system: true });
  assert.deepEqual(deviceProvidersForCapability('device.process'), { gui: false, system: true });
  assert.deepEqual(deviceProvidersForCapability('unknown.capability'), { gui: false, system: false });
});
