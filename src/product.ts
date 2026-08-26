/**
 * Public product identity for AWH.
 *
 * These identifiers are compatibility boundaries. Once the first stable
 * Desktop release is installed they must not be changed casually, because
 * updater continuity and local OS identity depend on them remaining stable.
 */
export const PRODUCT = {
  productName: 'Art’s Workspace Hub',
  shortName: 'AWH',
  desktopName: 'AWH Desktop',
  tagline: 'Your Projects. One Workspace. Anywhere.',
  productId: 'awh',
  desktopBundleId: 'com.artworkspacehub.awh',
  windowsPackageId: 'AWH',
  evergreenDesktop: true,
  defaultUpdateChannel: 'stable',
  updateChannels: ['stable', 'preview'],
  legacyCodename: 'Art Agent',
  legacyPackageId: 'art-agent',
} as const;

export type AwhUpdateChannel = (typeof PRODUCT.updateChannels)[number];

export function normalizeUpdateChannel(value: unknown): AwhUpdateChannel {
  return value === 'preview' ? 'preview' : 'stable';
}
