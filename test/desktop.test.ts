import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DESKTOP_IPC, DESKTOP_WEB_PREFERENCES } from '../src/desktop/security.js';

test('desktop renderer security preferences stay isolated and sandboxed', () => {
  assert.equal(DESKTOP_WEB_PREFERENCES.nodeIntegration, false);
  assert.equal(DESKTOP_WEB_PREFERENCES.contextIsolation, true);
  assert.equal(DESKTOP_WEB_PREFERENCES.sandbox, true);
  assert.equal(DESKTOP_WEB_PREFERENCES.webviewTag, false);
});

test('desktop IPC exposes fixed high-level channel names only', () => {
  assert.deepEqual(Object.keys(DESKTOP_IPC).sort(), [
    'chooseWorkspace',
    'openDataDir',
    'overview',
    'remoteConnect',
    'remoteStop',
    'restart',
    'setPermissions',
  ].sort());
});

test('desktop HTML has a restrictive CSP, remote controls and no inline script', async () => {
  const html = await readFile(new URL('../desktop/index.html', import.meta.url), 'utf8');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /id="remote-connect"/);
  assert.match(html, /id="remote-stop"/);
  assert.match(html, /ไม่ auto-connect/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>/i);
});

test('desktop remote lifecycle stays behind confirmation-gated high-level IPC', async () => {
  const main = await readFile(new URL('../src/desktop/main.ts', import.meta.url), 'utf8');
  const preload = await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
  const renderer = await readFile(new URL('../desktop/renderer.js', import.meta.url), 'utf8');

  assert.match(main, /ipcMain\.handle\(DESKTOP_IPC\.remoteConnect/);
  assert.match(main, /ipcMain\.handle\(DESKTOP_IPC\.remoteStop/);
  assert.match(main, /confirmRemoteAction\('connect'\)/);
  assert.match(main, /confirmRemoteAction\('stop'\)/);
  assert.match(main, /connectTunnelRuntime/);
  assert.match(main, /stopTunnelRuntime/);
  assert.match(main, /remoteOperationInFlight/);
  assert.match(main, /runtime\.connected \? 'allowed' : 'error'/);
  assert.match(preload, /remoteConnect: \(\) => ipcRenderer\.invoke\(CHANNELS\.remoteConnect\)/);
  assert.match(preload, /remoteStop: \(\) => ipcRenderer\.invoke\(CHANNELS\.remoteStop\)/);
  assert.doesNotMatch(preload, /exposeInMainWorld\([^,]+,\s*ipcRenderer/);
  assert.match(renderer, /runtime\?\.connected/);
  assert.match(renderer, /READY TO CONNECT/);
  assert.match(renderer, /window\.artAgent\.remoteConnect\(\)/);
  assert.match(renderer, /window\.artAgent\.remoteStop\(\)/);
  assert.doesNotMatch(renderer, /CONTROL_PLANE_API_KEY|mcpCommand|binaryPath|TUNNEL_CLIENT_BIN/);
});

test('desktop Doctor exposes sanitized tunnel readiness without a secret or raw process surface', async () => {
  const main = await readFile(new URL('../src/desktop/main.ts', import.meta.url), 'utf8');
  const renderer = await readFile(new URL('../desktop/renderer.js', import.meta.url), 'utf8');

  assert.match(main, /inspectTunnelReadiness/);
  assert.match(main, /sanitizedTunnelReadiness/);
  assert.match(main, /sanitizedTunnelRuntime/);
  assert.match(renderer, /runtimeKeyPresent/);
  assert.match(renderer, /tunnelIdValid/);
  assert.doesNotMatch(renderer, /CONTROL_PLANE_API_KEY|mcpCommand|binaryPath/);
});
