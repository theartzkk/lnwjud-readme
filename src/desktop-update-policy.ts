import { PRODUCT, normalizeUpdateChannel, type AwhUpdateChannel } from './product.js';

export interface DesktopUpdateManifestV1 {
  schemaVersion: 1;
  productId: typeof PRODUCT.productId;
  desktopBundleId: typeof PRODUCT.desktopBundleId;
  windowsPackageId: typeof PRODUCT.windowsPackageId;
  channel: AwhUpdateChannel;
  version: string;
  sha256: string;
  bytes: number;
  publishedAt: string;
  downloadPath: string;
  minHubApiMajor: 1;
}

export class DesktopUpdatePolicyError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_DOWNLOAD = /^\/desktop-updates\/v1\/[a-z0-9/_.,+@-]+$/i;

export function compareReleaseVersions(left: string, right: string): number {
  const a = VERSION.exec(left); const b = VERSION.exec(right);
  if (!a || !b) throw new DesktopUpdatePolicyError('Desktop version is invalid', 'UPDATE_VERSION_INVALID');
  for (let index = 1; index <= 3; index++) {
    const delta = Number(a[index]) - Number(b[index]);
    if (delta !== 0) return Math.sign(delta);
  }
  const aPre = a[4] ?? null; const bPre = b[4] ?? null;
  if (aPre === bPre) return 0;
  if (aPre === null) return 1;
  if (bPre === null) return -1;
  return aPre.localeCompare(bPre);
}

export function validateDesktopUpdateManifest(
  value: unknown,
  currentVersion: string,
  requestedChannel: unknown,
): DesktopUpdateManifestV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DesktopUpdatePolicyError('Update manifest is invalid', 'UPDATE_MANIFEST_INVALID');
  const manifest = value as Record<string, unknown>;
  const channel = normalizeUpdateChannel(requestedChannel);
  if (manifest.schemaVersion !== 1 || manifest.productId !== PRODUCT.productId || manifest.desktopBundleId !== PRODUCT.desktopBundleId || manifest.windowsPackageId !== PRODUCT.windowsPackageId) throw new DesktopUpdatePolicyError('Update identity does not match AWH', 'UPDATE_IDENTITY_MISMATCH');
  if (manifest.channel !== channel) throw new DesktopUpdatePolicyError('Update channel does not match request', 'UPDATE_CHANNEL_MISMATCH');
  if (typeof manifest.version !== 'string' || !VERSION.test(manifest.version)) throw new DesktopUpdatePolicyError('Update version is invalid', 'UPDATE_VERSION_INVALID');
  if (typeof manifest.sha256 !== 'string' || !SHA256.test(manifest.sha256)) throw new DesktopUpdatePolicyError('Update checksum is invalid', 'UPDATE_CHECKSUM_INVALID');
  if (!Number.isSafeInteger(manifest.bytes) || Number(manifest.bytes) < 1 || Number(manifest.bytes) > 2_147_483_648) throw new DesktopUpdatePolicyError('Update size is invalid', 'UPDATE_SIZE_INVALID');
  if (typeof manifest.publishedAt !== 'string' || !Number.isFinite(Date.parse(manifest.publishedAt))) throw new DesktopUpdatePolicyError('Update publication time is invalid', 'UPDATE_TIME_INVALID');
  if (typeof manifest.downloadPath !== 'string' || !SAFE_DOWNLOAD.test(manifest.downloadPath) || manifest.downloadPath.includes('..')) throw new DesktopUpdatePolicyError('Update download path is invalid', 'UPDATE_PATH_INVALID');
  if (manifest.minHubApiMajor !== 1) throw new DesktopUpdatePolicyError('Update requires an unsupported Hub API', 'UPDATE_HUB_INCOMPATIBLE');
  if (compareReleaseVersions(manifest.version, currentVersion) <= 0) throw new DesktopUpdatePolicyError('Update is not newer than the installed release', 'UPDATE_NOT_NEWER');
  return manifest as unknown as DesktopUpdateManifestV1;
}

export function updateManifestPath(channel: unknown, platform: NodeJS.Platform, arch: string): string {
  const normalized = normalizeUpdateChannel(channel);
  if (!['win32', 'darwin'].includes(platform)) throw new DesktopUpdatePolicyError('Desktop update platform is unsupported', 'UPDATE_PLATFORM_UNSUPPORTED');
  if (!/^[a-z0-9_-]{2,16}$/i.test(arch)) throw new DesktopUpdatePolicyError('Desktop update architecture is invalid', 'UPDATE_ARCH_INVALID');
  return `/desktop-updates/v1/${normalized}/${platform}/${arch}/manifest.json`;
}
