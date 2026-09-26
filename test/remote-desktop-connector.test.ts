import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { remoteDesktopConnectorStatus } from '../src/remote-desktop-connector.js';

async function fixture(): Promise<{ home: string; entry: string; session: string; pid: string }> {
  const home = await mkdtemp(join(tmpdir(), 'awh-remote-connector-'));
  const awh = join(home, 'Library', 'Application Support', 'AWH');
  const entry = join(awh, 'SystemRuntime', 'runtime', 'node_modules', '@wonderwhy-er', 'desktop-commander', 'dist', 'index.js');
  const session = join(home, '.desktop-commander-device', 'device.json');
  const pid = join(awh, 'DeviceRuntime', 'remote-desktop.pid');
  await mkdir(join(entry, '..'), { recursive: true });
  await writeFile(entry, '/* pinned test runtime */\n');
  return { home, entry, session, pid };
}

test('Remote Desktop connector is not reported ready before its one-time authorization', async () => {
  const f = await fixture();
  const status = await remoteDesktopConnectorStatus('darwin', f.home, { HOME: f.home });
  assert.equal(status.state, 'AUTHORIZATION_REQUIRED');
  assert.equal(status.authorized, false);
  assert.equal(status.running, false);
});

test('Remote Desktop connector reports ready only with a bounded persisted session and live managed pid', async () => {
  const f = await fixture();
  await mkdir(join(f.session, '..'), { recursive: true });
  await mkdir(join(f.pid, '..'), { recursive: true });
  await writeFile(f.session, JSON.stringify({ deviceId: 'fixture-device-01', session: { access_token: 'a'.repeat(40), refresh_token: 'b'.repeat(40) } }));
  await writeFile(f.pid, String(process.pid) + '\n');
  const status = await remoteDesktopConnectorStatus('darwin', f.home, { HOME: f.home });
  assert.equal(status.state, 'READY');
  assert.equal(status.authorized, true);
  assert.equal(status.running, true);
  assert.equal(status.managed, true);
});

test('legacy AWH RemoteWorker is honored during migration without spawning a second connector', async () => {
  const f = await fixture();
  const supervisor = join(f.home, 'Library', 'LaunchAgents', 'com.awh.remote-worker.plist');
  await mkdir(join(f.session, '..'), { recursive: true });
  await mkdir(join(supervisor, '..'), { recursive: true });
  await writeFile(f.session, JSON.stringify({ deviceId: 'fixture-device-02', session: { access_token: 'c'.repeat(40), refresh_token: 'd'.repeat(40) } }));
  await writeFile(supervisor, '<plist/>\n');
  const status = await remoteDesktopConnectorStatus('darwin', f.home, { HOME: f.home });
  assert.equal(status.state, 'READY');
  assert.equal(status.managed, false);
  assert.equal(status.reason, 'LEGACY_SUPERVISOR_PRESENT');
});
