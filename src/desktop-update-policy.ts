export type DesktopUpdateChannel = 'stable' | 'preview';

export const DESKTOP_UPDATE_FOUNDATION = {
  appId: 'com.artworkspacehub.awh',
  windowsPackageId: 'AWH',
  channels: ['stable', 'preview'] as const,
  defaultChannel: 'stable' as const,
  status: 'FOUNDATION_LOCKED_NOT_ACTIVATED' as const,
} as const;

export interface DesktopUpdateManifest {
  schemaVersion: 1;
  channel: DesktopUpdateChannel;
  version: string;
  gitSha: string;
  publishedAt: string;
  url: string;
  sha256: string;
  bytes: number;
  minimumDesktopVersion: string;
}

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;
const SHA = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;

export function parseVersion(value: string): readonly [number, number, number, string | null] {
  const match = VERSION.exec(value.trim());
  if (!match) throw new Error('UPDATE_VERSION_INVALID');
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? null] as const;
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left); const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  if (a[3] === b[3]) return 0;
  if (a[3] === null) return 1;
  if (b[3] === null) return -1;
  return a[3].localeCompare(b[3]);
}

export function validateDesktopUpdateManifest(value: unknown): DesktopUpdateManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('UPDATE_MANIFEST_INVALID');
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1 || !DESKTOP_UPDATE_FOUNDATION.channels.includes(row.channel as DesktopUpdateChannel)) throw new Error('UPDATE_MANIFEST_INVALID');
  if (typeof row.version !== 'string' || typeof row.minimumDesktopVersion !== 'string') throw new Error('UPDATE_MANIFEST_INVALID');
  parseVersion(row.version); parseVersion(row.minimumDesktopVersion);
  if (typeof row.gitSha !== 'string' || !GIT_SHA.test(row.gitSha)) throw new Error('UPDATE_MANIFEST_INVALID');
  if (typeof row.sha256 !== 'string' || !SHA.test(row.sha256)) throw new Error('UPDATE_MANIFEST_INVALID');
  if (!Number.isSafeInteger(row.bytes) || Number(row.bytes) <= 0) throw new Error('UPDATE_MANIFEST_INVALID');
  if (typeof row.publishedAt !== 'string' || !Number.isFinite(Date.parse(row.publishedAt))) throw new Error('UPDATE_MANIFEST_INVALID');
  if (typeof row.url !== 'string') throw new Error('UPDATE_MANIFEST_INVALID');
  const url = new URL(row.url); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('UPDATE_MANIFEST_INVALID');
  return row as unknown as DesktopUpdateManifest;
}

export function updateIsApplicable(currentVersion: string, manifest: DesktopUpdateManifest, channel: DesktopUpdateChannel): boolean {
  if (manifest.channel !== channel) return false;
  if (compareVersions(currentVersion, manifest.version) >= 0) return false;
  if (compareVersions(currentVersion, manifest.minimumDesktopVersion) < 0) return false;
  const current = parseVersion(currentVersion); const next = parseVersion(manifest.version);
  return current[0] === next[0];
}
