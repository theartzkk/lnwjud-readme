/** Deprecated compatibility API for the historical GitHub mirror.
 * The canonical VPS Git repository's root AGENTS.md is the only active policy authority.
 * Do not read or inject ART_AI_WORKING_PROTOCOL.md: it is archival evidence, not executable instructions.
 * A caller must resolve current rules from the authenticated AWH/VPS authority before mutation.
 */
export const OWNER_PROTOCOL_VERSION = '1.5' as const; // historical compatibility only
export const OWNER_PROTOCOL_FILENAME = 'ART_AI_WORKING_PROTOCOL.md' as const; // archived, never loaded

export async function loadOwnerProtocol(): Promise<string> {
  return [
    'ARCHIVED_GITHUB_MIRROR_NOT_POLICY_AUTHORITY',
    'The single active AWH/KRUART/BAY policy is the root AGENTS.md in canonical AWH VPS Git.',
    'Resolve current rules through the authenticated AWH/VPS project source before editing or releasing.',
    'This GitHub mirror does not bundle an active owner protocol; do not infer approval or routing rules here.',
  ].join('\n');
}
