import assert from 'node:assert/strict';
import test from 'node:test';
import { win32 as pathWin32 } from 'node:path';
import { composeWorkerHeartbeatCapabilities, discoverWorkerTools } from '../src/worker-capability-discovery.js';

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
