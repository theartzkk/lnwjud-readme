import assert from 'node:assert/strict';
import test from 'node:test';
import { win32 as pathWin32 } from 'node:path';
import { composeWorkerHeartbeatCapabilities, discoverWorkerTools } from "../src/worker-capability-discovery.js";

test('Windows tool discovery reports installed tools without granting execution', async () => {
  const env = {
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\AY8\\AppData\\Local',
  };
  const existing = new Set([
    pathWin32.join(env.ProgramFiles, 'Microsoft Office', 'root', 'Office16', 'WINWORD.EXE'),
    pathWin32.join(env.ProgramFiles, 'Microsoft Office', 'root', 'Office16', 'EXCEL.EXE'),
    pathWin32.join(env.ProgramFiles, 'Microsoft Office', 'root', 'Office16', 'POWERPNT.EXE'),
    pathWin32.join(env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]);
  const tools = await discoverWorkerTools({
    platform: 'win32', env,
    commandAvailable: async (command) => ['git', 'node'].includes(command),
    pathAvailable: async (path) => existing.has(path),
  });
  assert.deepEqual(tools, [
    'tool.browser.edge', 'tool.git', 'tool.node',
    'tool.office.excel', 'tool.office.powerpoint', 'tool.office.word',
  ]);
  assert.equal(tools.includes('document.office'), false);
});

test('macOS discovery stays metadata-only and deterministic', async () => {
  const paths = new Set([
    '/Applications/Safari.app/Contents/MacOS/Safari',
    '/Applications/Microsoft PowerPoint.app/Contents/MacOS/Microsoft PowerPoint',
  ]);
  const tools = await discoverWorkerTools({
    platform: 'darwin', env: {},
    commandAvailable: async (command) => ['git', 'ffmpeg', 'ffprobe', 'python3'].includes(command),
    pathAvailable: async (path) => paths.has(path),
  });
  assert.deepEqual(tools, [
    'tool.browser.safari', 'tool.ffmpeg', 'tool.ffprobe', 'tool.git',
    'tool.office.powerpoint', 'tool.python',
  ]);
});
test('heartbeat composition keeps executable capability priority and bounds inventory', () => {
  const executable = ['autopilot:local', 'git:read', 'codex:cli', 'git:read'];
  const tools = Array.from({ length: 30 }, (_, index) => `tool.fixture.${String(index).padStart(2, '0')}`);
  const heartbeat = composeWorkerHeartbeatCapabilities(executable, tools);
  assert.equal(heartbeat.length, 33);
  assert.deepEqual(heartbeat.slice(0, 3), ['autopilot:local', 'git:read', 'codex:cli']);
  assert.equal(heartbeat.includes('tool.fixture.00'), true);
  assert.equal(heartbeat.includes('tool.fixture.29'), true);
});

test('heartbeat composition rejects an invalid limit and drops malformed identifiers', () => {
  assert.throws(() => composeWorkerHeartbeatCapabilities([], [], 65), /limit/i);
  const heartbeat = composeWorkerHeartbeatCapabilities(['git:read', 'bad value'], ['tool.git', 'TOOL.BAD']);
  assert.deepEqual(heartbeat, ['git:read', 'tool.git']);
});

test('external CLI discovery is registry-driven and never grants execution authority', async () => {
  const externalRegistry = {
    schemaVersion: 1 as const,
    registryId: 'awh.external-capabilities.v1' as const,
    controlPlaneAuthority: 'AWH' as const,
    entries: [
      { id: 'future-cli', displayName: 'Future CLI', repository: 'Example/future-cli', revision: 'a'.repeat(40), license: 'MIT' as const, capability: 'future.review', integrationMode: 'OPTIONAL_LOCAL_ADAPTER' as const, command: 'future-cli', workerTool: 'tool.future-cli', enabledByDefault: false, approvalRequired: true, hostedServiceAllowed: false, authorityBoundary: 'AWH_EXISTING_CONTROL_PLANE' as const, dataPolicy: 'NO_EXTERNAL_SOURCE_OF_TRUTH' as const, purpose: 'future adapter', rollback: 'disable adapter' },
      { id: 'reference-only', displayName: 'Reference', repository: 'Example/reference', revision: 'b'.repeat(40), license: 'MIT' as const, capability: 'future.reference', integrationMode: 'REFERENCE_SKILL' as const, command: null, workerTool: null, enabledByDefault: false, approvalRequired: false, hostedServiceAllowed: false, authorityBoundary: 'AWH_EXISTING_CONTROL_PLANE' as const, dataPolicy: 'REFERENCE_ONLY' as const, purpose: 'reference only', rollback: 'remove reference' },
    ],
  };
  const tools = await discoverWorkerTools({
    platform: 'linux', env: {}, externalRegistry,
    commandAvailable: async (command) => ['git', 'future-cli'].includes(command),
    pathAvailable: async () => false,
  });
  assert.deepEqual(tools, ['tool.future-cli', 'tool.git']);
  assert.equal(tools.includes('future.review'), false);
});


test('macOS device runtime discovery exposes AWH system plus KRUART GUI inventory only when both are installed', async () => {
  const home = '/Users/fixture';
  const paths = new Set([
    '/Users/fixture/Library/Application Support/AWH/Engines/lnwjud/current/Contents/MacOS/lnwjud',
    '/Users/fixture/Library/Application Support/AWH/RemoteWorker/runtime/node_modules/.bin/desktop-commander',
  ]);
  const tools = await discoverWorkerTools({
    platform: 'darwin', env: { HOME: home },
    commandAvailable: async () => false,
    pathAvailable: async (path) => paths.has(path),
  });
  assert.deepEqual(tools, ['tool.awh-device-gui', 'tool.awh-device-system']);
});

test('macOS GUI inventory is not advertised without an executable AWH system provider', async () => {
  const home = '/Users/fixture';
  const paths = new Set(['/Users/fixture/.kruart/ai-control/kui']);
  const tools = await discoverWorkerTools({
    platform: 'darwin', env: { HOME: home },
    commandAvailable: async () => false,
    pathAvailable: async (path) => paths.has(path),
  });
  assert.deepEqual(tools, []);
});

test('heartbeat inventory has future headroom without dropping tool discovery', () => {
  const executable = Array.from({ length: 10 }, (_, index) => 'capability.' + index);
  const tools = Array.from({ length: 50 }, (_, index) => 'tool.future.' + String(index).padStart(2, '0'));
  const heartbeat = composeWorkerHeartbeatCapabilities(executable, tools);
  assert.equal(heartbeat.length, 60);
  assert.equal(heartbeat.includes('tool.future.49'), true);
});
