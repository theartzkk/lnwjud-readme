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

test('macOS discovery advertises installed Adobe Photoshop as inventory only', async () => {
  const paths = new Set([
    '/Applications/Adobe Photoshop 2026/Adobe Photoshop 2026.app/Contents/MacOS/Adobe Photoshop 2026',
  ]);
  const tools = await discoverWorkerTools({
    platform: 'darwin', env: {},
    commandAvailable: async () => false,
    pathAvailable: async (path) => paths.has(path),
  });
  assert.deepEqual(tools, ['tool.adobe.photoshop']);
  assert.equal(tools.includes('creative.photoshop'), false);
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

test('external CLI discovery reports inventory only and never grants an execution capability', async () => {
  const tools = await discoverWorkerTools({
    platform: 'linux', env: {},
    commandAvailable: async (command) => ['git', 'teamai', 'context-mode'].includes(command),
    pathAvailable: async () => false,
  });
  assert.deepEqual(tools, ['tool.context-mode', 'tool.git', 'tool.teamai']);
  assert.equal(tools.some((value) => value === 'team.harness' || value === 'context.optimize'), false);
});


test('legacy RDC and GUI toolkit artifacts do not impersonate AWH Device Runtime', async () => {
  const home = '/Users/fixture';
  const paths = new Set([
    '/Users/fixture/.kruart/ai-control/kui',
    '/Users/fixture/Library/Application Support/AWH/RemoteWorker/runtime/node_modules/.bin/desktop-commander',
    '/Users/fixture/.desktop-commander-device/device.json',
  ]);
  const tools = await discoverWorkerTools({
    platform: 'darwin', env: { HOME: home },
    commandAvailable: async () => false,
    pathAvailable: async (path) => paths.has(path),
  });
  assert.deepEqual(tools, []);
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

test('standalone AWH Device Runtime advertises GUI and system capability classes without RDC', async () => {
  const macHome = '/Users/fixture';
  const macBridge = '/Users/fixture/.awh/bin/awh-mcp-stdio';
  const macTools = await discoverWorkerTools({
    platform: 'darwin', env: { HOME: macHome },
    commandAvailable: async () => false,
    pathAvailable: async (path) => path === macBridge,
  });
  assert.deepEqual(macTools, ['tool.awh-device-gui', 'tool.awh-device-runtime', 'tool.awh-device-system']);

  const winLocal = 'C:\\Users\\Fixture\\AppData\\Local';
  const winEngine = pathWin32.join(winLocal, 'AWH', 'Engines', 'device-runtime', '5.5.0', 'AWH Device Runtime.exe');
  const winTools = await discoverWorkerTools({
    platform: 'win32', env: { LOCALAPPDATA: winLocal },
    commandAvailable: async () => false,
    pathAvailable: async (path) => path === winEngine,
  });
  assert.deepEqual(winTools, ['tool.awh-device-gui', 'tool.awh-device-runtime', 'tool.awh-device-system']);
});


test('standalone Remote Desktop Commander artifacts never enter AWH heartbeat inventory', async () => {
  const macHome = '/Users/fixture';
  const macArtifacts = new Set([
    '/Users/fixture/.awh/bin/awh-system-mcp',
    '/Users/fixture/.local/share/bay-remote/node_modules/.bin/desktop-commander',
    '/Users/fixture/.desktop-commander-device/device.json',
  ]);
  const mac = await discoverWorkerTools({
    platform: 'darwin', env: { HOME: macHome },
    commandAvailable: async () => false,
    pathAvailable: async (path) => macArtifacts.has(path),
  });
  assert.equal(mac.some((tool) => tool.includes('remote-desktop')), false);
  assert.equal(mac.some((tool) => tool.startsWith('tool.awh-device-')), false);

  const profile = 'C:\\Users\\Fixture';
  const local = profile + '\\AppData\\Local';
  const winArtifacts = new Set([
    pathWin32.join(local, 'AWH', 'SystemRuntime', 'runtime', 'node_modules', '@wonderwhy-er', 'desktop-commander', 'dist', 'index.js'),
    pathWin32.join(profile, '.desktop-commander-device', 'device.json'),
  ]);
  const win = await discoverWorkerTools({
    platform: 'win32', env: { LOCALAPPDATA: local, USERPROFILE: profile },
    commandAvailable: async () => false,
    pathAvailable: async (path) => winArtifacts.has(path),
  });
  assert.equal(win.some((tool) => tool.includes('remote-desktop')), false);
  assert.equal(win.some((tool) => tool.startsWith('tool.awh-device-')), false);
});


test('Media utility discovery reports existing commands as inventory only', async () => {
  const available=new Set(['ffmpeg','ffprobe','yt-dlp','faster-whisper','magick','exiftool']);
  const tools=await discoverWorkerTools({
    platform:'darwin',
    env:{},
    commandAvailable:async(command)=>available.has(command),
    pathAvailable:async()=>false,
  });
  for(const tool of ['tool.ffmpeg','tool.ffprobe','tool.media.yt-dlp','tool.media.faster-whisper','tool.media.imagemagick','tool.media.exiftool']) {
    assert.equal(tools.includes(tool),true,tool);
  }
  assert.equal(tools.some((value)=>value.startsWith('media.')),false,'inventory detection must not grant media execution capability');
});
