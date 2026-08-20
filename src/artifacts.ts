import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const ARTIFACT_SCHEMA_VERSION = 1 as const;
export const ARTIFACT_KINDS = ['qa-report', 'zip', 'release-candidate', 'patch', 'video-preview', 'video-final', 'pdf', 'screenshot', 'staging-url', 'rollback-package'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

const ARTIFACT_ID = /^[A-Za-z0-9._-]{1,120}$/;
const MAX_ARTIFACT_BYTES = 64 * 1024;
const MAX_ARTIFACTS = 500;

export interface ArtifactRecord {
  schemaVersion: 1;
  artifactId: string;
  taskId: string;
  projectId: string;
  kind: ArtifactKind;
  label: string;
  status: 'READY' | 'FAILED';
  relativeRef: string;
  createdAt: string;
  bytes: number;
}

function artifactsDir(dataDir: string): string { return join(dataDir, 'artifacts'); }
function artifactPath(dataDir: string, id: string): string { return join(artifactsDir(dataDir), `${id}.json`); }

function boundedText(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${field} is invalid`);
  return value.trim();
}

function validateRecord(value: unknown): ArtifactRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Artifact record is invalid');
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(',');
  if (keys !== 'artifactId,bytes,createdAt,kind,label,projectId,relativeRef,schemaVersion,status,taskId') throw new Error('Artifact record contains unsupported fields');
  if (record.schemaVersion !== ARTIFACT_SCHEMA_VERSION || typeof record.artifactId !== 'string' || !ARTIFACT_ID.test(record.artifactId)) throw new Error('Artifact id is invalid');
  if (typeof record.taskId !== 'string' || !ARTIFACT_ID.test(record.taskId) || typeof record.projectId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.projectId)) throw new Error('Artifact identity is invalid');
  if (typeof record.kind !== 'string' || !(ARTIFACT_KINDS as readonly string[]).includes(record.kind)) throw new Error('Artifact kind is invalid');
  boundedText(record.label, 160, 'Artifact label');
  if (record.status !== 'READY' && record.status !== 'FAILED') throw new Error('Artifact status is invalid');
  if (typeof record.relativeRef !== 'string' || record.relativeRef.length > 240 || record.relativeRef.startsWith('/') || /^[A-Za-z]:[\\/]/.test(record.relativeRef) || record.relativeRef.includes('..')) throw new Error('Artifact reference is not portable');
  if (typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt)) || typeof record.bytes !== 'number' || !Number.isSafeInteger(record.bytes) || record.bytes < 0) throw new Error('Artifact metadata is invalid');
  return record as unknown as ArtifactRecord;
}

async function writeRecord(dataDir: string, record: ArtifactRecord): Promise<void> {
  await mkdir(artifactsDir(dataDir), { recursive: true, mode: 0o700 });
  const target = artifactPath(dataDir, record.artifactId);
  const temporary = `${target}.tmp-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') await chmod(temporary, 0o600);
  await rename(temporary, target);
  if (process.platform !== 'win32') await chmod(target, 0o600);
}

/** Store only bounded, sanitized artifact metadata. The returned reference is never absolute. */
export async function createArtifact(
  dataDir: string,
  input: Omit<ArtifactRecord, 'schemaVersion' | 'artifactId' | 'createdAt'> & { artifactId?: string; createdAt?: string; payload?: unknown },
): Promise<ArtifactRecord> {
  const { payload, ...metadata } = input;
  const record = validateRecord({
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactId: metadata.artifactId ?? randomUUID(),
    createdAt: metadata.createdAt ?? new Date().toISOString(),
    ...metadata,
  });
  await writeRecord(dataDir, record);
  if (payload !== undefined) {
    const serialized = JSON.stringify(payload);
    if (serialized.length > 512 * 1024 || /(?:bearer\s+|password\s*[=:]|secret\s*[=:]|token\s*[=:]|api[_-]?key\s*[=:]|-----begin)/i.test(serialized) || serialized.includes('\\\\') && /(?:\/Users\/|[A-Za-z]:\\\\|\/home\/)/.test(serialized)) throw new Error('Artifact payload is unsafe');
    const target = join(dataDir, record.relativeRef);
    await writeFile(target, `${serialized}\n`, { encoding: 'utf8', mode: 0o600 });
    if (process.platform !== 'win32') await chmod(target, 0o600);
  }
  return record;
}

export async function listArtifacts(dataDir: string, limit = 50): Promise<ArtifactRecord[]> {
  let names: string[];
  try { names = await readdir(artifactsDir(dataDir)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const records: ArtifactRecord[] = [];
  for (const name of names.filter((value) => value.endsWith('.json')).slice(0, MAX_ARTIFACTS)) {
    try {
      const path = join(artifactsDir(dataDir), name);
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_ARTIFACT_BYTES) continue;
      records.push(validateRecord(JSON.parse(await readFile(path, 'utf8'))));
    } catch { /* Ignore corrupt artifact metadata; it must not break the control plane. */ }
  }
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, Math.max(1, Math.min(limit, 100)));
}
