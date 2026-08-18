import { access, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const SECRET_BASENAMES = new Set([
  '.env',
  'credentials.json',
  'service-account.json',
  'id_rsa',
  'id_ed25519',
]);
const SECRET_SUFFIXES = ['.pem', '.key', '.p12', '.pfx'];
const SECRET_SEGMENTS = new Set(['.ssh', '.aws', '.gnupg']);

export class SecurityError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

function hasSecretSegment(path: string): boolean {
  const parts = path.split(/[\\/]+/).filter(Boolean).map((p) => p.toLowerCase());
  return parts.some((part) => SECRET_SEGMENTS.has(part));
}

export function assertNotSecret(path: string): void {
  const name = basename(path).toLowerCase();
  if (
    SECRET_BASENAMES.has(name) ||
    name.startsWith('.env.') ||
    SECRET_SUFFIXES.some((suffix) => name.endsWith(suffix)) ||
    hasSecretSegment(path)
  ) {
    throw new SecurityError(`Secret path is blocked: ${path}`, 'SECRET_BLOCKED');
  }
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

async function nearestExisting(path: string): Promise<string> {
  let current = path;
  while (true) {
    try {
      await access(current, constants.F_OK);
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) throw new SecurityError('No existing parent found', 'PATH_INVALID');
      current = parent;
    }
  }
}

export async function canonicalWorkspace(root: string): Promise<string> {
  const canonical = await realpath(root);
  const stat = await lstat(canonical);
  if (!stat.isDirectory()) {
    throw new SecurityError('Workspace must be a directory', 'WORKSPACE_INVALID');
  }
  return canonical;
}

export async function resolveForRead(root: string, input: string): Promise<string> {
  assertNotSecret(input);
  const canonicalRoot = await canonicalWorkspace(root);
  const candidate = resolve(canonicalRoot, input);
  const canonical = await realpath(candidate);
  if (!isInside(canonicalRoot, canonical)) {
    throw new SecurityError('Path escapes the registered workspace', 'PATH_OUTSIDE_WORKSPACE');
  }
  assertNotSecret(canonical);
  return canonical;
}

export async function resolveForWrite(root: string, input: string): Promise<string> {
  assertNotSecret(input);
  const canonicalRoot = await canonicalWorkspace(root);
  const candidate = resolve(canonicalRoot, input);
  if (!isInside(canonicalRoot, candidate)) {
    throw new SecurityError('Path escapes the registered workspace', 'PATH_OUTSIDE_WORKSPACE');
  }

  try {
    const canonicalTarget = await realpath(candidate);
    if (!isInside(canonicalRoot, canonicalTarget)) {
      throw new SecurityError('Write target escapes the registered workspace', 'PATH_OUTSIDE_WORKSPACE');
    }
    assertNotSecret(canonicalTarget);
    return canonicalTarget;
  } catch (error) {
    if (error instanceof SecurityError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const existing = await nearestExisting(dirname(candidate));
  const canonicalParent = await realpath(existing);
  if (!isInside(canonicalRoot, canonicalParent)) {
    throw new SecurityError('Write parent escapes the registered workspace', 'PATH_OUTSIDE_WORKSPACE');
  }
  assertNotSecret(candidate);
  return candidate;
}
