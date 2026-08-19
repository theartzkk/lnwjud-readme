import { randomUUID } from 'node:crypto';
import { arch, platform } from 'node:os';
import { chmod, lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DEVICE_IDENTITY_SCHEMA_VERSION = 1 as const;
export const DEVICE_IDENTITY_FILENAME = 'device.json';
const MAX_DEVICE_FILE_BYTES = 16 * 1024;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPPORTED_PLATFORMS = new Set(['darwin', 'win32', 'linux']);

export interface DeviceIdentity {
  schemaVersion: 1;
  deviceId: string;
  displayName: string;
  platform: 'darwin' | 'win32' | 'linux';
  arch: string;
  createdAt: string;
}

export class DeviceIdentityError extends Error {
  constructor(message: string, readonly code = 'DEVICE_IDENTITY_INVALID') {
    super(message);
    this.name = 'DeviceIdentityError';
  }
}

export function deviceIdentityPath(dataDir: string): string { return join(dataDir, DEVICE_IDENTITY_FILENAME); }

function boundedText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new DeviceIdentityError(`${field} is invalid`, 'DEVICE_FIELD_INVALID');
  return value.trim();
}

function parseDeviceIdentity(raw: string): DeviceIdentity {
  let value: Record<string, unknown>;
  try { value = JSON.parse(raw) as Record<string, unknown>; } catch { throw new DeviceIdentityError('device.json is not valid JSON', 'DEVICE_JSON_INVALID'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'arch,createdAt,deviceId,displayName,platform,schemaVersion') throw new DeviceIdentityError('device.json contains unsupported fields', 'DEVICE_SCHEMA_INVALID');
  if (value.schemaVersion !== DEVICE_IDENTITY_SCHEMA_VERSION || typeof value.deviceId !== 'string' || !UUID_V4.test(value.deviceId)) throw new DeviceIdentityError('device.json deviceId is invalid', 'DEVICE_ID_INVALID');
  const displayName = boundedText(value.displayName, 'displayName', 80);
  if (/[\\/]/.test(displayName) || /^https?:\/\//i.test(displayName)) throw new DeviceIdentityError('displayName is not portable', 'DEVICE_FIELD_INVALID');
  if (typeof value.platform !== 'string' || !SUPPORTED_PLATFORMS.has(value.platform)) throw new DeviceIdentityError('device.json platform is invalid', 'DEVICE_FIELD_INVALID');
  const deviceArch = boundedText(value.arch, 'arch', 32);
  if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) throw new DeviceIdentityError('device.json createdAt is invalid', 'DEVICE_FIELD_INVALID');
  return { schemaVersion: 1, deviceId: value.deviceId, displayName, platform: value.platform as DeviceIdentity['platform'], arch: deviceArch, createdAt: value.createdAt };
}

async function readRaw(dataDir: string): Promise<string | null> {
  const path = deviceIdentityPath(dataDir);
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_DEVICE_FILE_BYTES) throw new DeviceIdentityError('device.json is not a bounded regular file', 'DEVICE_FILE_INVALID');
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Read-only lookup; it never creates a device identity. */
export async function readDeviceIdentity(dataDir: string): Promise<DeviceIdentity | null> {
  const raw = await readRaw(dataDir);
  return raw === null ? null : parseDeviceIdentity(raw);
}

function defaultDisplayName(currentPlatform: string): string {
  if (currentPlatform === 'darwin') return 'Art’s Mac';
  if (currentPlatform === 'win32') return 'Art’s Windows PC';
  return 'Art’s Linux PC';
}

function currentPlatform(): DeviceIdentity['platform'] {
  if (!SUPPORTED_PLATFORMS.has(platform())) throw new DeviceIdentityError(`Unsupported device platform: ${platform()}`, 'DEVICE_PLATFORM_UNSUPPORTED');
  return platform() as DeviceIdentity['platform'];
}

async function secureDirectory(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(dataDir, 0o700);
}

async function writeIdentity(dataDir: string, identity: DeviceIdentity, exclusive: boolean): Promise<void> {
  await secureDirectory(dataDir);
  const path = deviceIdentityPath(dataDir);
  if (exclusive) {
    await writeFile(path, `${JSON.stringify(identity, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    if (process.platform !== 'win32') await chmod(path, 0o600);
    return;
  }
  const temporary = `${path}.tmp-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(identity, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  if (process.platform !== 'win32') await chmod(temporary, 0o600);
  await rename(temporary, path);
  if (process.platform !== 'win32') await chmod(path, 0o600);
}

/** Generate once, then reuse the same identity. No credential is written here. */
export async function loadOrCreateDeviceIdentity(dataDir: string, displayName?: string): Promise<DeviceIdentity> {
  const existing = await readDeviceIdentity(dataDir);
  if (existing) return existing;
  const current = currentPlatform();
  const identity: DeviceIdentity = {
    schemaVersion: 1,
    deviceId: randomUUID(),
    displayName: displayName?.trim() || defaultDisplayName(current),
    platform: current,
    arch: arch(),
    createdAt: new Date().toISOString(),
  };
  parseDeviceIdentity(JSON.stringify(identity));
  try {
    await writeIdentity(dataDir, identity, true);
    return identity;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      const raced = await readDeviceIdentity(dataDir);
      if (raced) return raced;
    }
    throw error;
  }
}

export async function updateDeviceDisplayName(dataDir: string, displayName: string): Promise<DeviceIdentity> {
  const current = await readDeviceIdentity(dataDir);
  if (!current) throw new DeviceIdentityError('Device identity is not initialized', 'DEVICE_NOT_INITIALIZED');
  const next = { ...current, displayName: boundedText(displayName, 'displayName', 80) };
  if (/[\\/]/.test(next.displayName) || /^https?:\/\//i.test(next.displayName)) throw new DeviceIdentityError('displayName is not portable', 'DEVICE_FIELD_INVALID');
  await secureDirectory(dataDir);
  const path = deviceIdentityPath(dataDir);
  const temporary = `${path}.tmp-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  if (process.platform !== 'win32') await chmod(temporary, 0o600);
  await rename(temporary, path);
  if (process.platform !== 'win32') await chmod(path, 0o600);
  return next;
}
