import { spawn } from 'node:child_process';

const CREDENTIAL_KEY = /^[a-z][a-z0-9._/-]{1,127}$/;
const MAX_CREDENTIAL_BYTES = 4096;
const MAX_PROCESS_OUTPUT_BYTES = MAX_CREDENTIAL_BYTES + 1024;
const PROCESS_TIMEOUT_MS = 15_000;

export const DEVICE_TOKEN_CREDENTIAL_KEY = 'awh/device-token';
export const BOOTSTRAP_NONCE_CREDENTIAL_KEY = 'awh/bootstrap-nonce';
export const AWH_CREDENTIAL_SERVICE = 'Art’s Workspace Hub';
export const AWH_CREDENTIAL_ACCOUNT = 'awh-device-token-v1';
export const WINDOWS_CREDENTIAL_TARGET = `${AWH_CREDENTIAL_SERVICE}/${DEVICE_TOKEN_CREDENTIAL_KEY}`;

export class CredentialStoreError extends Error {
  constructor(message: string, readonly code = 'CREDENTIAL_STORE_UNAVAILABLE') {
    super(message);
    this.name = 'CredentialStoreError';
  }
}

export interface CredentialStore {
  get(key: string): Promise<string | null>;
  set(key: string, secret: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface CredentialProcessResult {
  exitCode: number | null;
  stdout: string;
}

export type CredentialProcessRunner = (executable: string, args: readonly string[], stdin?: string) => Promise<CredentialProcessResult>;

function validateKey(key: string): void {
  if (!CREDENTIAL_KEY.test(key)) throw new CredentialStoreError('Credential key is invalid', 'CREDENTIAL_KEY_INVALID');
}

function validateSecret(secret: string): void {
  if (typeof secret !== 'string' || !secret || Buffer.byteLength(secret, 'utf8') > MAX_CREDENTIAL_BYTES || /[\u0000-\u001f\u007f]/.test(secret)) {
    throw new CredentialStoreError('Credential value is invalid', 'CREDENTIAL_VALUE_INVALID');
  }
}

function credentialAccount(key: string): string {
  validateKey(key);
  return `${AWH_CREDENTIAL_ACCOUNT}:${key}`;
}

function processFailure(message: string): CredentialStoreError {
  return new CredentialStoreError(message, 'CREDENTIAL_PROCESS_FAILED');
}

/** Runs only a caller-owned fixed executable and argv; native diagnostics are discarded. */
export const runCredentialProcess: CredentialProcessRunner = (executable, args, stdin = '') => new Promise((resolve, reject) => {
  let settled = false;
  let stdout = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const child = spawn(executable, [...args], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const finishReject = (error: CredentialStoreError): void => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    reject(error);
  };
  child.stdout.on('data', (chunk: Buffer | string) => {
    stdout += chunk.toString();
    if (Buffer.byteLength(stdout, 'utf8') > MAX_PROCESS_OUTPUT_BYTES) {
      child.kill();
      finishReject(processFailure('Credential process output is too large'));
    }
  });
  child.stderr.on('data', () => { /* Never retain or print native diagnostics. */ });
  child.once('error', () => finishReject(processFailure('Credential service is unavailable')));
  child.once('close', (exitCode) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    resolve({ exitCode, stdout });
  });
  timer = setTimeout(() => {
    child.kill();
    finishReject(processFailure('Credential service timed out'));
  }, PROCESS_TIMEOUT_MS);
  child.stdin.end(stdin, 'utf8');
});

function cleanSecretOutput(stdout: string): string {
  const value = stdout.endsWith('\r\n') ? stdout.slice(0, -2) : stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout;
  validateSecret(value);
  return value;
}

/** macOS Keychain adapter using the native security command and stdin prompt. */
export class MacKeychainCredentialStore implements CredentialStore {
  constructor(private readonly runner: CredentialProcessRunner = runCredentialProcess) {}

  async get(key: string): Promise<string | null> {
    const account = credentialAccount(key);
    const result = await this.runner('/usr/bin/security', ['find-generic-password', '-a', account, '-s', AWH_CREDENTIAL_SERVICE, '-w']);
    if (result.exitCode === 44) return null;
    if (result.exitCode !== 0) throw processFailure('macOS Keychain read failed');
    return cleanSecretOutput(result.stdout);
  }

  async set(key: string, secret: string): Promise<void> {
    validateSecret(secret);
    const account = credentialAccount(key);
    // `security -w` prompts twice when creating a new item; stdin keeps the
    // credential out of argv while satisfying both prompts.
    const result = await this.runner('/usr/bin/security', ['add-generic-password', '-a', account, '-s', AWH_CREDENTIAL_SERVICE, '-U', '-w'], `${secret}\n${secret}\n`);
    if (result.exitCode !== 0) throw processFailure('macOS Keychain write failed');
  }

  async delete(key: string): Promise<void> {
    const account = credentialAccount(key);
    const result = await this.runner('/usr/bin/security', ['delete-generic-password', '-a', account, '-s', AWH_CREDENTIAL_SERVICE]);
    if (result.exitCode !== 0 && result.exitCode !== 44) throw processFailure('macOS Keychain delete failed');
  }
}

const WINDOWS_POWERSHELL = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AwhNativeCredential {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags;
    public UInt32 Type;
    public IntPtr TargetName;
    public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public IntPtr TargetAlias;
    public IntPtr UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredWrite(ref CREDENTIAL credential, UInt32 flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredDelete(string target, UInt32 type, UInt32 flags);
  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr credential);
}
'@
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$target = [string]$request.target
if ($target -notmatch '^Art’s Workspace Hub/awh/[a-z][a-z0-9._/-]{1,127}$') { throw 'Invalid credential target' }
$action = [string]$request.action
if ($action -eq 'set') {
  $secret = [string]$request.secret
  if ([string]::IsNullOrEmpty($secret) -or $secret.IndexOf([char]0) -ge 0) { throw 'Invalid credential value' }
  $targetPtr = [Runtime.InteropServices.Marshal]::StringToHGlobalUni($target)
  $userPtr = [Runtime.InteropServices.Marshal]::StringToHGlobalUni('AWH Device')
  $bytes = [Text.Encoding]::UTF8.GetBytes($secret)
  $blobPtr = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
  try {
    [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blobPtr, $bytes.Length)
    $credential = New-Object AwhNativeCredential+CREDENTIAL
    $credential.Type = 1
    $credential.TargetName = $targetPtr
    $credential.UserName = $userPtr
    $credential.CredentialBlob = $blobPtr
    $credential.CredentialBlobSize = [UInt32]$bytes.Length
    $credential.Persist = 2
    if (-not [AwhNativeCredential]::CredWrite([ref]$credential, 0)) { throw 'Credential write failed' }
  } finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($targetPtr)
    [Runtime.InteropServices.Marshal]::FreeHGlobal($userPtr)
    [Runtime.InteropServices.Marshal]::FreeHGlobal($blobPtr)
  }
  exit 0
}
if ($action -eq 'get') {
  $credentialPtr = [IntPtr]::Zero
  if (-not [AwhNativeCredential]::CredRead($target, 1, 0, [ref]$credentialPtr)) {
    if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1168) { exit 44 }
    throw 'Credential read failed'
  }
  try {
    $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($credentialPtr, [type][AwhNativeCredential+CREDENTIAL])
    $bytes = New-Object byte[] $credential.CredentialBlobSize
    [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $bytes, 0, $credential.CredentialBlobSize)
    [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
  } finally { [AwhNativeCredential]::CredFree($credentialPtr) }
  exit 0
}
if ($action -eq 'delete') {
  if (-not [AwhNativeCredential]::CredDelete($target, 1, 0)) {
    $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($errorCode -ne 1168) { throw 'Credential delete failed' }
  }
  exit 0
}
throw 'Unsupported credential action'
`;

export const WINDOWS_CREDENTIAL_EXECUTABLE = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

/** Windows Credential Manager adapter; no plaintext file fallback. */
export class WindowsCredentialManagerStore implements CredentialStore {
  constructor(private readonly runner: CredentialProcessRunner = runCredentialProcess, private readonly executable = WINDOWS_CREDENTIAL_EXECUTABLE) {}

  private async invoke(action: 'get' | 'set' | 'delete', key: string, secret?: string): Promise<CredentialProcessResult> {
    validateKey(key);
    if (secret !== undefined) validateSecret(secret);
    const target = key === DEVICE_TOKEN_CREDENTIAL_KEY ? WINDOWS_CREDENTIAL_TARGET : `${AWH_CREDENTIAL_SERVICE}/${key}`;
    const input = JSON.stringify({ action, target, username: 'AWH Device', ...(secret === undefined ? {} : { secret }) });
    return this.runner(this.executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_POWERSHELL], input);
  }

  async get(key: string): Promise<string | null> {
    const result = await this.invoke('get', key);
    if (result.exitCode === 44) return null;
    if (result.exitCode !== 0) throw processFailure('Windows Credential Manager read failed');
    return cleanSecretOutput(result.stdout);
  }

  async set(key: string, secret: string): Promise<void> {
    const result = await this.invoke('set', key, secret);
    if (result.exitCode !== 0) throw processFailure('Windows Credential Manager write failed');
  }

  async delete(key: string): Promise<void> {
    const result = await this.invoke('delete', key);
    if (result.exitCode !== 0 && result.exitCode !== 44) throw processFailure('Windows Credential Manager delete failed');
  }
}

/** Test-only fake; production code must use an OS-backed adapter when available. */
export class InMemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> { validateKey(key); return this.values.get(key) ?? null; }
  async set(key: string, secret: string): Promise<void> { validateKey(key); validateSecret(secret); this.values.set(key, secret); }
  async delete(key: string): Promise<void> { validateKey(key); this.values.delete(key); }
}

/** Unsupported platforms fail closed instead of writing plaintext credentials. */
export class UnavailableCredentialStore implements CredentialStore {
  async get(_key: string): Promise<string | null> { throw new CredentialStoreError('No secure OS credential store is available', 'CREDENTIAL_STORE_UNAVAILABLE'); }
  async set(_key: string, _secret: string): Promise<void> { throw new CredentialStoreError('No secure OS credential store is available', 'CREDENTIAL_STORE_UNAVAILABLE'); }
  async delete(_key: string): Promise<void> { throw new CredentialStoreError('No secure OS credential store is available', 'CREDENTIAL_STORE_UNAVAILABLE'); }
}

export function createProductionCredentialStore(platformName: NodeJS.Platform = process.platform, runner: CredentialProcessRunner = runCredentialProcess): CredentialStore {
  if (platformName === 'darwin') return new MacKeychainCredentialStore(runner);
  if (platformName === 'win32') return new WindowsCredentialManagerStore(runner);
  return new UnavailableCredentialStore();
}
