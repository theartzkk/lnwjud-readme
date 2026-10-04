import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { boundedCrashTimestamps, watchdogRestartAllowed, readAgentWatchdogStatus } from '../src/agent-watchdog.js';

test('watchdog status lifecycle rejects stale/malformed state and bounds restart storms', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-watchdog-test-'));
  try {
    const now = Date.now();
    assert.equal(boundedCrashTimestamps([now - 11 * 60_000, now - 30_000, now - 20_000, now - 10_000, now], now).length, 3);
    assert.equal(watchdogRestartAllowed([now - 30_000, now - 20_000], now), true);
    assert.equal(watchdogRestartAllowed([now - 30_000, now - 20_000, now - 10_000], now), false);
    await mkdir(join(root, 'watchdog'), { recursive: true });
    await writeFile(join(root, 'watchdog', 'status.json'), JSON.stringify({
      schemaVersion: 1, state: 'HEALTHY', crashCount: 1, at: new Date(now).toISOString(), pid: 123,
    }));
    const status = await readAgentWatchdogStatus(root);
    assert.equal(status?.state, 'HEALTHY');
    assert.equal(status?.pid, 123);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Windows device runtime discovery stays inside AWH-managed roots', () => {
  const source = readFileSync(new URL('../src/lnwjud-device-client.ts', import.meta.url), 'utf8');
  assert.match(source, /'AWH', 'Engines', 'device-runtime'/);
  assert.doesNotMatch(source, /'Programs', 'lnwjud'/);
});

test('core permission bootstrap is Accessibility plus Screen Recording only', () => {
  const source = readFileSync(new URL('../src/device-bootstrap.ts', import.meta.url), 'utf8');
  assert.match(source, /AWH_PERMISSION_BOOTSTRAP_V3/);
  assert.match(source, /const AWH_RUNTIME_PERMISSION_V2_MARKER = 'var AWH_PERMISSION_BOOTSTRAP_V2 = true;';/);
  assert.match(source, /const AWH_RUNTIME_PERMISSION_V1_MARKER = 'var AWH_PERMISSION_BOOTSTRAP_V1 = true;';/);
  assert.match(source, /DEVICE_RUNTIME_PERMISSION_V2_MIGRATION_CONTRACT_MISMATCH/);
  assert.match(source, /DEVICE_RUNTIME_PERMISSION_V1_MIGRATION_CONTRACT_MISMATCH/);
  assert.match(source, /process\.stdout\.write\([\s\S]*process\.exit\(exitCode\)/);
  assert.match(source, /if \(nextMain\.includes\(permissionDispatch\)\)[\s\S]*else if \(nextMain\.includes\(runtimeDispatch\)\)/);
  assert.match(source, /const ready = accessibility === true && screenCapture === "granted";/);
  assert.doesNotMatch(source, /askForMediaAccess\("microphone"\)/);
  const desktop = readFileSync(new URL('../src/desktop/main.ts', import.meta.url), 'utf8');
  assert.match(desktop, /osReady = runtime !== null && runtime\.accessibility === true && runtime\.screenCapture === 'granted';/);
});

test('AWH Agent cannot provision an internal Remote Desktop Commander/SystemRuntime duplicate', () => {
  const bootstrap = readFileSync(new URL('../src/device-bootstrap.ts', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/desktop/main.ts', import.meta.url), 'utf8');
  const inventory = readFileSync(new URL('../src/worker-capability-discovery.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(bootstrap, /ensureSystemMcpRuntime|installAndVerifySystemMcpRuntime|awh-system-mcp|desktop-commander/);
  assert.doesNotMatch(main, /remote-desktop-connector|remoteDesktop/);
  assert.doesNotMatch(inventory, /remote-desktop-mcp|SystemRuntime|desktop-commander|desktop-commander-device/);
});

test('macOS Device Runtime patch reconciles Accessibility health and removes legacy native-host branding', () => {
  const source = readFileSync(new URL('../src/device-bootstrap.ts', import.meta.url), 'utf8');
  assert.match(source, /AWH_HEALTH_ACCESSIBILITY_RECONCILE_V1/);
  assert.match(source, /tool === "accessibility"/);
  assert.match(source, /list_windows/);
  assert.match(source, /status\.hostAvailable !== false/);
  assert.match(source, /status\.hostReady !== false/);
  assert.match(source, /AWHDeviceRuntimeHost/);
  assert.match(source, /NATIVE_HOST\.json/);
  assert.match(source, /DEVICE_RUNTIME_NATIVE_HOST_MANIFEST_VERIFY_FAILED/);
  assert.match(source, /DEVICE_RUNTIME_VERIFY_NATIVE_HOST_MANIFEST_NAME/);
  assert.match(source, /DEVICE_RUNTIME_VERIFY_NATIVE_HOST_MANIFEST_HASH/);
  assert.match(source, /DEVICE_RUNTIME_VERIFY_NATIVE_HOST_MANIFEST_SIZE/);
  assert.match(source, /AWH_RUNTIME_APPROVAL_BRIDGE_MARKER, 'APPROVAL_BRIDGE'/);
  assert.match(source, /DEVICE_RUNTIME_NATIVE_HOST_REBRAND_/);
  assert.match(source, /DEVICE_RUNTIME_PATCH_COMMIT_VERIFY_FAILED/);
  assert.match(source, /DEVICE_RUNTIME_REBRAND_FINAL_VERIFY_FAILED/);
  assert.match(source, /readAsarMainFresh/);
  assert.match(source, /readAsarHeaderFresh/);
  assert.match(source, /\.awh-read-/);
  assert.match(source, /codesign[\s\S]*--verify[\s\S]*--deep[\s\S]*--strict[\s\S]*180_000/);
  assert.match(source, /codesign', \['--verify', '--deep', '--strict', appRoot\], appRoot, 180_000/);
});

test('headless Device Runtime honors one explicit exact-action owner approval exactly once', () => {
  const source = readFileSync(new URL('../src/device-bootstrap.ts', import.meta.url), 'utf8');
  assert.match(source, /AWH_EXACT_APPROVAL_BRIDGE_V2/);
  assert.match(source, /AWH_EXACT_APPROVAL_INLINE_V1/);
  assert.match(source, /AWH_RUNTIME_APPROVAL_BRIDGE_V1_MARKER/);
  assert.match(source, /DEVICE_RUNTIME_APPROVAL_V1_FALLBACK_MIGRATION_MISMATCH/);
  assert.match(source, /approvalToken: awhExactApprovalTokenSchema\.optional\(\)/);
  assert.match(source, /awhExactApprovalSignature/);
  assert.match(source, /awhIssueExactApprovalToken/);
  assert.match(source, /awhConsumeExactApprovalToken/);
  assert.match(source, /awhAcceptInlineExactApproval/);
  assert.match(source, /process\.env\.AWH_DEVICE_RUNTIME_HEADLESS === \"1\"/);
  assert.match(source, /hasExplicitUserConfirmation\(activeRoutedInput\)/);
  assert.match(source, /awhExactInlineApprovals\.set\(signature, now \+ AWH_EXACT_APPROVAL_TTL_MS\)/);
  assert.match(source, /owner approval was already consumed for this exact action/);
  assert.match(source, /invalid, expired, already used, or does not match this exact action/);
  assert.match(source, /DEVICE_RUNTIME_APPROVAL_PATCH_VERIFY_FAILED/);
  assert.match(source, /AWH_RUNTIME_APPROVAL_BRIDGE_MARKER/);
  assert.match(source, /AWH_RUNTIME_APPROVAL_INLINE_MARKER/);
});

test('device runtime bootstrap waits for its smoke child to exit before reporting completion', () => {
  const client = readFileSync(new URL('../src/lnwjud-device-client.ts', import.meta.url), 'utf8');
  const bootstrap = readFileSync(new URL('../src/device-bootstrap.ts', import.meta.url), 'utf8');
  assert.match(client, /async closeAndWait\(timeoutMs = 4_000\): Promise<void>/);
  assert.match(client, /this\.process\.kill\('SIGKILL'\)/);
  assert.match(client, /taskkill.*\/T.*\/F/s);
  assert.match(bootstrap, /finally \{ await client\.closeAndWait\(\); \}/);
});

test('desktop device runtime bootstrap is single-flight across concurrent callers', () => {
  const source = readFileSync(new URL('../src/desktop/main.ts', import.meta.url), 'utf8');
  assert.match(source, /let deviceRuntimeBootstrapInFlight: Promise<DeviceBootstrapResult> \| null = null;/);
  assert.match(source, /async function ensureDeviceRuntimeSingleFlight\(dataDir: string, forceRepair = false\): Promise<DeviceBootstrapResult>/);
  assert.match(source, /const active = await deviceRuntimeBootstrapInFlight;/);
  assert.match(source, /forceRepair \? repairAwhDeviceRuntime\(dataDir\) : ensureAwhDeviceRuntime\(dataDir\)/);
  assert.match(source, /ensureDeviceRuntimeSingleFlight\(config\.dataDir, true\)/);
  assert.equal(source.match(/ensureDeviceRuntimeSingleFlight\(config\.dataDir/g)?.length, 4);
});
