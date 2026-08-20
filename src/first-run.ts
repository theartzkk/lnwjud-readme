import { chmod, lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const SESSION_FILENAME = 'owner-session.json';
const MAX_BYTES = 16 * 1024;

export interface OwnerSession {
  schemaVersion: 1;
  ownerDisplayName: string;
  deviceName: string;
  trustedAt: string;
  lastSeenAt: string;
}

function sessionPath(dataDir: string): string { return join(dataDir, SESSION_FILENAME); }
function text(value: unknown, max: number, field: string): string { if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value) || /[\\/]/.test(value)) throw new Error(`${field} is invalid`); return value.trim(); }

function parse(raw: string): OwnerSession {
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== 'deviceName,lastSeenAt,ownerDisplayName,schemaVersion,trustedAt' || value.schemaVersion !== 1 || typeof value.trustedAt !== 'string' || !Number.isFinite(Date.parse(value.trustedAt)) || typeof value.lastSeenAt !== 'string' || !Number.isFinite(Date.parse(value.lastSeenAt))) throw new Error('Owner session is invalid');
  return { schemaVersion: 1, ownerDisplayName: text(value.ownerDisplayName, 80, 'ownerDisplayName'), deviceName: text(value.deviceName, 80, 'deviceName'), trustedAt: value.trustedAt, lastSeenAt: value.lastSeenAt };
}

export async function readOwnerSession(dataDir: string): Promise<OwnerSession | null> {
  try {
    const info = await lstat(sessionPath(dataDir));
    if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_BYTES) throw new Error('Owner session file is unsafe');
    return parse(await readFile(sessionPath(dataDir), 'utf8'));
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

export async function trustOwner(dataDir: string, ownerDisplayName: string, deviceName: string): Promise<OwnerSession> {
  const current = new Date().toISOString();
  const session = parse(JSON.stringify({ schemaVersion: 1, ownerDisplayName: text(ownerDisplayName, 80, 'ownerDisplayName'), deviceName: text(deviceName, 80, 'deviceName'), trustedAt: current, lastSeenAt: current }));
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const target = sessionPath(dataDir);
  const temporary = `${target}.tmp-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') await chmod(temporary, 0o600);
  await rename(temporary, target);
  if (process.platform !== 'win32') await chmod(target, 0o600);
  return session;
}

export async function touchOwnerSession(dataDir: string): Promise<OwnerSession | null> {
  const current = await readOwnerSession(dataDir);
  if (!current) return null;
  return trustOwner(dataDir, current.ownerDisplayName, current.deviceName);
}
