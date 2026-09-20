import { readFile } from 'node:fs/promises';

export const OWNER_PROTOCOL_VERSION = '3.0' as const;
export const OWNER_PROTOCOL_FILENAME = 'ART_AI_WORKING_PROTOCOL.md' as const;
const MAX_OWNER_PROTOCOL_BYTES = 96 * 1024;

/**
 * Load the bundled non-binding owner working context before project-specific memory.
 * The file is versioned with AWH source/package contents and contains no secret.
 */
export async function loadOwnerProtocol(): Promise<string> {
  const url = new URL(`../${OWNER_PROTOCOL_FILENAME}`, import.meta.url);
  const bytes = await readFile(url);
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_OWNER_PROTOCOL_BYTES) throw new Error('AWH owner working protocol is unavailable or outside the safe bound');
  const text = bytes.toString('utf8');
  if (!text.includes('# AWH Working Context') || !text.includes('Mode: context-only') || !text.includes(`Version: ${OWNER_PROTOCOL_VERSION}`)) throw new Error('AWH owner working context identity is invalid');
  return text;
}
