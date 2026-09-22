import assert from 'node:assert/strict';
import test from 'node:test';
import { win32 as pathWin32 } from 'node:path';
import { composeWorkerHeartbeatCapabilities, discoverWorkerOperationalCapabilities, discoverWorkerTools } from '../src/worker-capability-discovery.js';

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
  assert.equal(heartbeat.length, 24);
  assert.deepEqual(heartbeat.slice(0, 3), ['autopilot:local', 'git:read', 'codex:cli']);
  assert.equal(heartbeat.includes('tool.fixture.00'), true);
  assert.equal(heartbeat.includes('tool.fixture.29'), false);
});

test('heartbeat composition rejects an invalid limit and drops malformed identifiers', () => {
  assert.throws(() => composeWorkerHeartbeatCapabilities([], [], 25), /limit/i);
  const heartbeat = composeWorkerHeartbeatCapabilities(['git:read', 'bad value'], ['tool.git', 'TOOL.BAD']);
  assert.deepEqual(heartbeat, ['git:read', 'tool.git']);
});

test('KRUART operational discovery projects LIVE visual and foreground authority without owning the mode', async () => {
  const home = '/Users/fixture';
  const files = new Map<string, string>([
    [`${home}/.kruart/ai-control/state`, 'LIVE\n'],
    [`${home}/.kruart/capability-registry.json`, JSON.stringify({ capabilities: { gui: { runtime: 'READY' } } })],
  ]);
  const capabilities = await discoverWorkerOperationalCapabilities({
    platform: 'darwin', home,
    readText: async (path) => { const value = files.get(path); if (value === undefined) throw new Error('missing'); return value; },
    foregroundApp: async () => 'Adobe Photoshop 2026',
  });
  assert.deepEqual(capabilities, ['app.foreground.photoshop', 'runtime.ai.live', 'runtime.gui.ready', 'runtime.visual.ready']);
});

test('KRUART OFF remains observable state but never fabricates visual readiness', async () => {
  const home = '/Users/fixture';
  const files = new Map<string, string>([
    [`${home}/.kruart/ai-control/state`, 'OFF\n'],
    [`${home}/.kruart/capability-registry.json`, JSON.stringify({ capabilities: { gui: { runtime: 'READY' } } })],
  ]);
  const capabilities = await discoverWorkerOperationalCapabilities({
    platform: 'darwin', home,
    readText: async (path) => { const value = files.get(path); if (value === undefined) throw new Error('missing'); return value; },
    foregroundApp: async () => 'ChatGPT',
  });
  assert.deepEqual(capabilities, ['runtime.ai.off', 'runtime.gui.ready']);
});

test('external CLI discovery reports inventory only and never grants an execution capability', async () => {
  const tools = await discoverWorkerTools({
    platform: 'linux', env: {},
    commandAvailable: async (command) => ['git', 'teamai', 'context-mode'].includes(command),
    pathAvailable: async () => false,
  });
  assert.deepEqual(tools, ['tool.context-mode', 'tool.git', 'tool.teamai']);
  assert.equal(tools.some((value) => value === 'team.harness' || value === 'context.optimize'), false);
});


test('macOS device runtime discovery exposes provider-neutral inventory only when installed', async () => {
  const home = '/Users/fixture';
  const paths = new Set([
    '/Applications/lnwjud.app/Contents/MacOS/lnwjud',
    '/Users/fixture/.local/share/bay-remote/node_modules/.bin/desktop-commander',
  ]);
  const tools = await discoverWorkerTools({
    platform: 'darwin', env: { HOME: home },
    commandAvailable: async () => false,
    pathAvailable: async (path) => paths.has(path),
  });
  assert.deepEqual(tools, ['tool.awh-device-gui', 'tool.awh-device-system']);
});
