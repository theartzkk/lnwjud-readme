import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { DEVICE_TOKEN_CREDENTIAL_KEY, CredentialStoreError, InMemoryCredentialStore, createProductionCredentialStore } from '../src/credential-store.js';
import { deviceIdentityPath, DeviceIdentityError, loadOrCreateDeviceIdentity, readDeviceIdentity, updateDeviceDisplayName } from '../src/device-identity.js';

async function fixture(): Promise<{ root: string; dataDir: string; projectDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'awh-device-'));
  const dataDir = join(root, 'data');
  const projectDir = join(root, 'project');
  return { root, dataDir, projectDir };
}

test('new installation generates one stable local UUID outside the project workspace', async () => {
  const f = await fixture();
  try {
    const first = await loadOrCreateDeviceIdentity(f.dataDir);
    const second = await loadOrCreateDeviceIdentity(f.dataDir, 'Renamed Device');
    assert.match(first.deviceId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(second.deviceId, first.deviceId);
    assert.equal(second.displayName, first.displayName);
    assert.equal(deviceIdentityPath(f.dataDir).startsWith(f.projectDir), false);
    const raw = await readFile(deviceIdentityPath(f.dataDir), 'utf8');
    assert.doesNotMatch(raw, /token|secret|credential/i);
    if (process.platform !== 'win32') assert.equal((await stat(deviceIdentityPath(f.dataDir))).mode & 0o777, 0o600);
    const renamed = await updateDeviceDisplayName(f.dataDir, 'Art’s MacBook');
    assert.equal(renamed.deviceId, first.deviceId);
    assert.equal((await readDeviceIdentity(f.dataDir))?.displayName, 'Art’s MacBook');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('malformed or symlinked device metadata fails closed and never regenerates', async () => {
  const f = await fixture();
  try {
    await writeFile(deviceIdentityPath(f.dataDir), '{"deviceId":"bad"}', { encoding: 'utf8', flag: 'w' }).catch(async () => {
      await import('node:fs/promises').then(({ mkdir }) => mkdir(f.dataDir, { recursive: true }));
      await writeFile(deviceIdentityPath(f.dataDir), '{"deviceId":"bad"}', 'utf8');
    });
    await assert.rejects(() => readDeviceIdentity(f.dataDir), (error: unknown) => error instanceof DeviceIdentityError);
    await assert.rejects(() => loadOrCreateDeviceIdentity(f.dataDir), (error: unknown) => error instanceof DeviceIdentityError);
    await rm(deviceIdentityPath(f.dataDir));
    const outside = join(f.root, 'outside.json');
    await writeFile(outside, '{}', 'utf8');
    await symlink(outside, deviceIdentityPath(f.dataDir));
    await assert.rejects(() => readDeviceIdentity(f.dataDir), (error: unknown) => error instanceof DeviceIdentityError);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('in-memory credential store supports replacement and deletion while production adapter fails closed', async () => {
  const store = new InMemoryCredentialStore();
  assert.equal(await store.get(DEVICE_TOKEN_CREDENTIAL_KEY), null);
  await store.set(DEVICE_TOKEN_CREDENTIAL_KEY, 'token-one');
  assert.equal(await store.get(DEVICE_TOKEN_CREDENTIAL_KEY), 'token-one');
  await store.set(DEVICE_TOKEN_CREDENTIAL_KEY, 'token-two');
  assert.equal(await store.get(DEVICE_TOKEN_CREDENTIAL_KEY), 'token-two');
  await store.delete(DEVICE_TOKEN_CREDENTIAL_KEY);
  assert.equal(await store.get(DEVICE_TOKEN_CREDENTIAL_KEY), null);
  await assert.rejects(() => createProductionCredentialStore().set(DEVICE_TOKEN_CREDENTIAL_KEY, 'token'), (error: unknown) => error instanceof CredentialStoreError && error.code === 'CREDENTIAL_STORE_UNAVAILABLE');
});
