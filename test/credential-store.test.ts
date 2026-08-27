import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  DEVICE_TOKEN_CREDENTIAL_KEY,
  CredentialProcessRunner,
  CredentialStoreError,
  InMemoryCredentialStore,
  MacKeychainCredentialStore,
  PrivateFileCredentialStore,
  UnavailableCredentialStore,
  WindowsCredentialManagerStore,
  WINDOWS_CREDENTIAL_TARGET,
  createDesktopCredentialStore,
  createProductionCredentialStore,
} from '../src/credential-store.js';

test('macOS Keychain adapter uses fixed security argv and stdin without leaking the credential', async () => {
  const calls: Array<{ executable: string; args: readonly string[]; stdin: string | undefined }> = [];
  const runner: CredentialProcessRunner = async (executable, args, stdin) => {
    calls.push({ executable, args, stdin });
    return { exitCode: args[0] === 'find-generic-password' ? 0 : 0, stdout: args[0] === 'find-generic-password' ? 'fixture-device-credential\n' : '' };
  };
  const store = new MacKeychainCredentialStore(runner);
  await store.set(DEVICE_TOKEN_CREDENTIAL_KEY, 'fixture-device-credential');
  assert.equal(await store.get(DEVICE_TOKEN_CREDENTIAL_KEY), 'fixture-device-credential');
  await store.delete(DEVICE_TOKEN_CREDENTIAL_KEY);
  assert.equal(calls[0]?.executable, '/usr/bin/security');
  assert.equal(calls[0]?.args.includes('-w'), true);
  assert.equal(calls[0]?.args.includes('fixture-device-credential'), false);
  assert.equal(calls[0]?.stdin, 'fixture-device-credential\nfixture-device-credential\n');
});

test('macOS Keychain missing and malformed records fail closed', async () => {
  const missing = new MacKeychainCredentialStore(async () => ({ exitCode: 44, stdout: '' }));
  assert.equal(await missing.get(DEVICE_TOKEN_CREDENTIAL_KEY), null);
  const malformed = new MacKeychainCredentialStore(async () => ({ exitCode: 0, stdout: 'credential\nextra\n' }));
  await assert.rejects(() => malformed.get(DEVICE_TOKEN_CREDENTIAL_KEY), (error: unknown) => error instanceof CredentialStoreError && error.code === 'CREDENTIAL_VALUE_INVALID');
});

test('Windows Credential Manager adapter sends the secret only through stdin to fixed PowerShell', async () => {
  const calls: Array<{ executable: string; args: readonly string[]; stdin: string | undefined }> = [];
  const runner: CredentialProcessRunner = async (executable, args, stdin) => {
    calls.push({ executable, args, stdin });
    const request = JSON.parse(stdin ?? '{}') as { action?: string };
    return { exitCode: 0, stdout: request.action === 'get' ? 'fixture-windows-credential' : '' };
  };
  const store = new WindowsCredentialManagerStore(runner, 'powershell.exe');
  await store.set(DEVICE_TOKEN_CREDENTIAL_KEY, 'fixture-windows-credential');
  assert.equal(await store.get(DEVICE_TOKEN_CREDENTIAL_KEY), 'fixture-windows-credential');
  await store.delete(DEVICE_TOKEN_CREDENTIAL_KEY);
  assert.equal(calls[0]?.executable, 'powershell.exe');
  assert.equal(calls[0]?.args.includes('-NoProfile'), true);
  assert.equal(calls[0]?.args.join(' ').includes('fixture-windows-credential'), false);
  assert.match(calls[0]?.stdin ?? '', /fixture-windows-credential/);
});

test('Windows Credential Manager missing service, malformed record, and no file fallback are safe', async () => {
  const missing = new WindowsCredentialManagerStore(async () => ({ exitCode: 44, stdout: '' }), 'powershell.exe');
  assert.equal(await missing.get(DEVICE_TOKEN_CREDENTIAL_KEY), null);
  const malformed = new WindowsCredentialManagerStore(async () => ({ exitCode: 0, stdout: 'bad\nrecord' }), 'powershell.exe');
  await assert.rejects(() => malformed.get(DEVICE_TOKEN_CREDENTIAL_KEY), (error: unknown) => error instanceof CredentialStoreError && error.code === 'CREDENTIAL_VALUE_INVALID');
  const source = await readFile(new URL('../src/credential-store.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /cmdkey/);
  assert.match(source, /shell:\s*false/);
});

test('production adapter selection is platform-specific and Linux remains fail-closed', () => {
  assert.equal(createProductionCredentialStore('darwin') instanceof MacKeychainCredentialStore, true);
  assert.equal(createProductionCredentialStore('win32') instanceof WindowsCredentialManagerStore, true);
  assert.equal(createProductionCredentialStore('linux') instanceof UnavailableCredentialStore, true);
  assert.equal(createProductionCredentialStore('linux') instanceof InMemoryCredentialStore, false);
});

test('desktop session store uses Windows Credential Manager instead of POSIX permission emulation', async () => {
  assert.equal(WINDOWS_CREDENTIAL_TARGET, 'AWH/awh/device-token');
  assert.doesNotMatch(WINDOWS_CREDENTIAL_TARGET, /[^\x20-\x7E]/);
  const calls: string[] = [];
  const runner: CredentialProcessRunner = async (_executable, _args, stdin) => {
    const request = JSON.parse(stdin ?? '{}') as { action?: string };
    calls.push(request.action ?? '');
    return { exitCode: request.action === 'get' ? 44 : 0, stdout: '' };
  };
  const store = createDesktopCredentialStore('C:\\Users\\Teacher\\.awh', 'win32', runner);
  assert.equal(store instanceof WindowsCredentialManagerStore, true);
  assert.equal(await store.get(DEVICE_TOKEN_CREDENTIAL_KEY), null);
  assert.deepEqual(calls, ['get']);
});


test('desktop session store avoids OS Keychain and keeps only a private revocable token file', { skip: process.platform === 'win32' ? 'POSIX permission semantics are not available on Windows' : false }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-session-store-'));
  try {
    const store = createDesktopCredentialStore(root, 'darwin');
    assert.equal(store instanceof PrivateFileCredentialStore, true);
    assert.equal(await store.get(DEVICE_TOKEN_CREDENTIAL_KEY), null);
    await store.set(DEVICE_TOKEN_CREDENTIAL_KEY, 'revocable-session-token');
    assert.equal(await store.get(DEVICE_TOKEN_CREDENTIAL_KEY), 'revocable-session-token');
    const directory = await stat(join(root, 'session-credentials'));
    assert.equal(directory.mode & 0o077, 0);
    await store.delete(DEVICE_TOKEN_CREDENTIAL_KEY);
    assert.equal(await store.get(DEVICE_TOKEN_CREDENTIAL_KEY), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});
