/**
 * Public product identity for the AWH migration.
 *
 * Package, installer, filesystem, environment, and MCP protocol identifiers
 * intentionally remain legacy-compatible until their dedicated migration
 * milestones are complete.
 */
export const PRODUCT = {
  productName: 'Art’s Workspace Hub',
  shortName: 'AWH',
  desktopName: 'AWH Desktop',
  tagline: 'Your Projects. One Workspace. Anywhere.',
  legacyCodename: 'Art Agent',
  legacyPackageId: 'art-agent',
} as const;
