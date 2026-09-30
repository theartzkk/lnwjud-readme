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
  assert.match(source, /AWH_PERMISSION_BOOTSTRAP_V2/);
  assert.match(source, /const AWH_RUNTIME_PERMISSION_V1_MARKER = 'var AWH_PERMISSION_BOOTSTRAP_V1 = true;';/);
  assert.match(source, /DEVICE_RUNTIME_PERMISSION_V1_MIGRATION_CONTRACT_MISMATCH/);
  assert.match(source, /if \(nextMain\.includes\(permissionDispatch\)\)[\s\S]*else if \(nextMain\.includes\(runtimeDispatch\)\)/);
  assert.match(source, /const ready = accessibility === true && screenCapture === "granted";/);
  assert.doesNotMatch(source, /askForMediaAccess\("microphone"\)/);
  const desktop = readFileSync(new URL('../src/desktop/main.ts', import.meta.url), 'utf8');
  assert.match(desktop, /osReady = runtime !== null && runtime\.accessibility === true && runtime\.screenCapture === 'granted';/);
});

test('SystemRuntime smoke classifies exit and dependency failures before timeout', () => {
  const source = readFileSync(new URL('../src/device-bootstrap.ts', import.meta.url), 'utf8');
  assert.match(source, /DEVICE_RUNTIME_SYSTEM_DEPENDENCY_MISSING/);
  assert.match(source, /child\.once\('exit'/);
  assert.match(source, /DEVICE_RUNTIME_SYSTEM_SMOKE_SPAWN_FAILED/);
  assert.match(source, /DEVICE_RUNTIME_SYSTEM_SMOKE_EXIT_/);
  assert.match(source, /30_000/);
  assert.match(source, /awh-system-mcp\.mjs/);
});
