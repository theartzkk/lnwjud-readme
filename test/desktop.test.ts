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
    'enrollmentIssuePairing',
    'initializeProject',
    'initializeProjectMemory',
    'locateProject',
    'openDataDir',
    'overview',
    'projectContext',
    'projects',
    'registerProject',
    'remoteConnect',
    'remoteStop',
    'enrollmentPair',
    'enrollmentRevoke',
    'enrollmentRotate',
    'enrollmentState',
    'firstRun',
    'trustOwner',
    'autopilotOverview',
    'autopilotStart',
    'autopilotTasks',
    'autopilotArtifacts',
    'autopilotContinuity',
    'autopilotCheckpointMemory',
    'autopilotRemoteResults',
    'restart',
    'selectProject',
    'setPermissions',
    'workerRunOnce',
    'workerState',
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
  assert.match(html, /Art’s Workspace Hub/);
  assert.match(html, /AWH Desktop/);
  assert.match(html, /Your Projects\. One Workspace\. Anywhere\./);
  assert.match(html, /data-section="projects"/);
  assert.match(html, /data-section="enrollment"/);
  assert.match(html, /id="remote-result-list"/);
  assert.match(html, /data-section="overview"/);
  assert.match(html, /id="enrollment-code"/);
  assert.match(html, /id="enrollment-issue-pairing"/);
  assert.match(html, /สร้างรหัสเชื่อมต่อ/);
  assert.match(html, /Pair this device/);
  assert.match(html, /Rotate credential/);
  assert.match(html, /Revoke device credential/);
  assert.match(html, /Register Existing Project/);
  assert.match(html, /Initialize as AWH Project/);
  assert.match(html, /Project Memory/);
  assert.match(html, /card-head-spaced/);
  assert.match(html, /card-spaced/);
  assert.doesNotMatch(html, /\sstyle=/i);
  assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>/i);
});

test('desktop remote lifecycle stays behind confirmation-gated high-level IPC', async () => {
  const main = (await readFile(new URL('../src/desktop/main.ts', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const preload = await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
  const renderer = await readFile(new URL('../desktop/renderer.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../desktop/index.html', import.meta.url), 'utf8');

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

test('desktop Doctor exposes bounded local device readiness without credentials', async () => {
  const main = await readFile(new URL('../src/desktop/main.ts', import.meta.url), 'utf8');
  const renderer = await readFile(new URL('../desktop/renderer.js', import.meta.url), 'utf8');
  assert.match(main, /readDeviceIdentity/);
  assert.match(main, /idShort: deviceIdentity\.deviceId\.slice\(0, 8\)/);
  assert.match(renderer, /data\.doctor\.device\?\.ready/);
  assert.match(renderer, /Device identity/);
  assert.doesNotMatch(renderer, /accessToken|pairingCode|Authorization|tokenHash/);
});

test('desktop Projects workflow uses registry/memory IPC and stays fail-closed', async () => {
  const main = await readFile(new URL('../src/desktop/main.ts', import.meta.url), 'utf8');
  const preload = await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
  const renderer = await readFile(new URL('../desktop/renderer.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../desktop/index.html', import.meta.url), 'utf8');

  for (const channel of ['projects', 'projectContext', 'registerProject', 'initializeProject', 'initializeProjectMemory', 'selectProject', 'locateProject']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\(DESKTOP_IPC\\.${channel}`));
    assert.match(preload, new RegExp(`${channel}:`));
  }
  assert.match(main, /registerProject\(config\.dataDir, selected\)/);
  assert.match(main, /initializeProject\(selected\)/);
  assert.match(main, /initializeProjectMemory\(resolved\.workspacePath\)/);
  assert.match(main, /manifest\.projectId !== projectId/);
  assert.match(main, /MAX_HANDOFF_PREVIEW_CHARS = 4_000/);
  assert.match(renderer, /WORKSPACE UNAVAILABLE/);
  assert.match(renderer, /Locate Project/);
  assert.match(html, /Initialize Missing Project Memory/);
  assert.match(renderer, /context\.handoffPreview\.truncated/);
  assert.doesNotMatch(renderer, /require\(|process\.|fs\.|child_process|spawn\(/);
  assert.doesNotMatch(preload, /readFile|writeFile|readdir|spawn|process\.env|shell\.openPath/);
});

test('desktop enrollment UX uses fixed IPC and never exposes credentials', async () => {
  const main = await readFile(new URL('../src/desktop/main.ts', import.meta.url), 'utf8');
  const preload = await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
  const renderer = await readFile(new URL('../desktop/renderer.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../desktop/index.html', import.meta.url), 'utf8');
  for (const channel of ['enrollmentState', 'enrollmentPair', 'enrollmentIssuePairing', 'enrollmentRotate', 'enrollmentRevoke']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\(DESKTOP_IPC\\.${channel}`));
    assert.match(preload, new RegExp(`${channel}:`));
  }
  assert.match(main, /createProductionCredentialStore/);
  assert.match(main, /readLocalEnrollmentState/);
  assert.match(main, /selectedEnrollmentProjectIds/);
  assert.match(main, /if \(!hasExplicitWorkspace\(config\.dataDir\)\) return \[\]/);
  assert.match(main, /issuePairingCode/);
  assert.match(main, /issuePairingCode\(projectIds, 600\)/);
  assert.match(renderer, /window\.artAgent\.pairDevice/);
  assert.match(renderer, /window\.artAgent\.createDeviceCode/);
  assert.match(renderer, /showOwnerCode/);
  assert.match(renderer, /projectCount === 0/);
  assert.match(renderer, /if \(result\?\.ok === true\) \{ await refreshProjects\(\); await refreshAutopilot\(\); \}/);
  assert.match(renderer, /window\.artAgent\.rotateDeviceCredential/);
  assert.match(renderer, /window\.artAgent\.revokeDeviceCredential/);
  assert.match(renderer, /enrollment-device-id/);
  assert.match(html, /enrollment-pairing-scope/);
  assert.doesNotMatch(renderer, /accessToken|Authorization|tokenHash/);
  assert.doesNotMatch(preload, /process\.env|readFile|writeFile|spawn|shell\.openPath/);
  assert.doesNotMatch(html, /type="password"/i);
});

test('desktop Autopilot is goal-based, local-only, bounded and never exposes raw process access', async () => {
  const main = await readFile(new URL('../src/desktop/main.ts', import.meta.url), 'utf8');
  const preload = await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
  const renderer = await readFile(new URL('../desktop/renderer.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../desktop/index.html', import.meta.url), 'utf8');
  for (const channel of ['autopilotOverview', 'autopilotStart', 'autopilotTasks', 'autopilotArtifacts', 'autopilotContinuity', 'autopilotCheckpointMemory']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\(DESKTOP_IPC\\.${channel}`));
    assert.match(preload, new RegExp(`${channel}:`));
  }
  assert.match(main, /AutopilotRunner/);
  assert.match(main, /typeof goal !== 'string'/);
  assert.match(preload, /startAutopilot: \(goal\) =>/);
  assert.match(renderer, /startAutopilot/);
  assert.match(html, /What would you like to work on/);
  assert.match(html, /id="section-autopilot"/);
  assert.match(html, /id="section-artifacts"/);
  assert.doesNotMatch(renderer, /child_process|spawn\(|execFile|process\.env|Authorization|accessToken|tokenHash/);
  assert.doesNotMatch(preload, /readFile|writeFile|readdir|spawn|process\.env|shell\.openPath/);
});

test('desktop first-run trust stores only bounded identity/session metadata', async () => {
  const main = await readFile(new URL('../src/desktop/main.ts', import.meta.url), 'utf8');
  const renderer = await readFile(new URL('../desktop/renderer.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../desktop/index.html', import.meta.url), 'utf8');
  assert.match(main, /readOwnerSession/);
  assert.match(main, /trustOwner/);
  assert.match(html, /trusted device/);
  assert.doesNotMatch(renderer, /password|accessToken|pairingCode|Authorization/i);
});

test('desktop smoke bootstrap activates a clean AWH data directory before writing its first marker', async () => {
  const main = (await readFile(new URL('../src/desktop/main.ts', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const marker = main.indexOf('async function writeSmokeMarker');
  const ensure = main.indexOf('ensureAwhDataDirectoryActive(config.dataDir)', marker);
  const mkdir = main.indexOf('await mkdir(config.dataDir', marker);
  const write = main.indexOf("await writeFile(\n    join(config.dataDir, 'desktop-smoke.json')", marker);
  assert.ok(marker >= 0 && ensure > marker && mkdir > ensure && write > mkdir, 'fresh-install bootstrap must precede smoke marker persistence');
});

test('desktop smoke harness isolates data, uses normal macOS LaunchServices, and classifies Codex GUI sandbox aborts', async () => {
  const smoke = await readFile(new URL('../scripts/desktop-smoke.mjs', import.meta.url), 'utf8');
  const qa = await readFile(new URL('../scripts/qa/awh-local-qa.mjs', import.meta.url), 'utf8');
  const main = await readFile(new URL('../src/desktop/main.ts', import.meta.url), 'utf8');
  assert.match(smoke, /AWH_DATA_DIR/);
  assert.match(smoke, /configuredDataDir/);
  assert.match(smoke, /if \(dataRoot\)/);
  assert.match(smoke, /AWH_ALLOW_EXEC: '0'/);
  assert.match(smoke, /'DISPLAY'/);
  assert.match(smoke, /shell: false/);
  assert.match(smoke, /\/usr\/bin\/open/);
  assert.match(smoke, /GUI_SANDBOX_BLOCKED/);
  assert.match(smoke, /-10822|kLS/);
  assert.match(smoke, /result\.code === 134/);
  assert.match(smoke, /SIGABRT\|AppKit/);
  assert.match(smoke, /_RegisterApplication|GetCurrentProcess/);
  assert.match(smoke, /marker === null/);
  assert.match(smoke, /--smoke-data-dir/);
  assert.match(qa, /result\.code === 2/);
  assert.match(qa, /GUI_SANDBOX_BLOCKED/);
  assert.match(qa, /interactive GUI validation remains required/);
  assert.match(main, /uiPaths/);
  assert.match(main, /cmdKReady/);
  assert.match(smoke, /result\.stderr/);
});
