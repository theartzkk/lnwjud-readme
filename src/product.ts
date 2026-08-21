/**
 * Public product identity for the AWH migration.
 *
 * Public release identity is AWH. Legacy package, filesystem, environment and
 * MCP protocol identifiers remain compatibility boundaries for migration.
 */
export const PRODUCT = {
  productName: 'Art’s Workspace Hub',
  shortName: 'AWH',
  desktopName: 'AWH Desktop',
  tagline: 'Your Projects. One Workspace. Anywhere.',
  legacyCodename: 'Art Agent',
  legacyPackageId: 'art-agent',
} as const;
