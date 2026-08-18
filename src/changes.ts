import { createHash, randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readTextFile, writeTextFile } from './files.js';

export interface TextPatchOperation {
  path: string;
  expected: string;
  replacement: string;
}

interface CheckpointFileRecord {
  path: string;
  bytes: number;
  sha256: string;
  contentBase64: string;
}

interface CheckpointManifest {
  id: string;
  createdAt: string;
  files: CheckpointFileRecord[];
}

export interface CheckpointSummary {
  id: string;
  createdAt: string;
  files: Array<{ path: string; bytes: number; sha256: string }>;
}

const CHECKPOINT_ID = /^[A-Za-z0-9._-]{1,120}$/;
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;

function checkpointsDir(dataDir: string): string {
  return join(dataDir, 'checkpoints');
}

function summary(manifest: CheckpointManifest): CheckpointSummary {
  return {
    id: manifest.id,
    createdAt: manifest.createdAt,
    files: manifest.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
  };
}

function assertCheckpointId(id: string): void {
  if (!CHECKPOINT_ID.test(id)) throw new Error('Invalid checkpoint id');
}

async function readManifest(dataDir: string, id: string): Promise<CheckpointManifest> {
  assertCheckpointId(id);
  const file = join(checkpointsDir(dataDir), id, 'checkpoint.json');
  const info = await stat(file);
  if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) throw new Error('Checkpoint manifest is invalid or too large');
  const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<CheckpointManifest>;
  if (parsed.id !== id || typeof parsed.createdAt !== 'string' || !Array.isArray(parsed.files)) {
    throw new Error('Checkpoint manifest is malformed');
  }
  for (const entry of parsed.files) {
    if (
      !entry ||
      typeof entry.path !== 'string' ||
      typeof entry.bytes !== 'number' ||
      typeof entry.sha256 !== 'string' ||
      typeof entry.contentBase64 !== 'string'
    ) {
      throw new Error('Checkpoint file record is malformed');
    }
  }
  return parsed as CheckpointManifest;
}

export async function createCheckpoint(
  dataDir: string,
  workspace: string,
  paths: string[],
  maxReadBytes: number,
): Promise<CheckpointSummary> {
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length === 0) throw new Error('Checkpoint requires at least one file');
  if (uniquePaths.length > 50) throw new Error('Checkpoint is limited to 50 files');

  const records: CheckpointFileRecord[] = [];
  for (const path of uniquePaths) {
    const content = await readTextFile(workspace, path, maxReadBytes);
    const bytes = Buffer.byteLength(content, 'utf8');
    records.push({
      path,
      bytes,
      sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
      contentBase64: Buffer.from(content, 'utf8').toString('base64'),
    });
  }

  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const manifest: CheckpointManifest = { id, createdAt: new Date().toISOString(), files: records };
  const dir = join(checkpointsDir(dataDir), id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'checkpoint.json'), `${JSON.stringify(manifest)}\n`, 'utf8');
  return summary(manifest);
}

export async function listCheckpoints(dataDir: string, limit = 20): Promise<CheckpointSummary[]> {
  const root = checkpointsDir(dataDir);
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const out: CheckpointSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !CHECKPOINT_ID.test(entry.name)) continue;
    try {
      out.push(summary(await readManifest(dataDir, entry.name)));
    } catch {
      // Ignore corrupt/untrusted checkpoint directories in discovery.
    }
  }
  return out
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(1, Math.min(limit, 100)));
}

export async function restoreCheckpoint(
  dataDir: string,
  workspace: string,
  id: string,
): Promise<CheckpointSummary> {
  const manifest = await readManifest(dataDir, id);
  for (const entry of manifest.files) {
    const content = Buffer.from(entry.contentBase64, 'base64').toString('utf8');
    const digest = createHash('sha256').update(content, 'utf8').digest('hex');
    if (digest !== entry.sha256 || Buffer.byteLength(content, 'utf8') !== entry.bytes) {
      throw new Error(`Checkpoint integrity check failed for ${entry.path}`);
    }
    await writeTextFile(workspace, entry.path, content);
  }
  return summary(manifest);
}

function occurrenceCount(text: string, expected: string): number {
  if (expected.length === 0) throw new Error('Patch expected text must not be empty');
  let count = 0;
  let offset = 0;
  while (true) {
    const index = text.indexOf(expected, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + expected.length;
  }
}

export async function applyTextPatch(
  dataDir: string,
  workspace: string,
  operations: TextPatchOperation[],
  maxReadBytes: number,
): Promise<{ checkpoint: CheckpointSummary; paths: string[] }> {
  if (operations.length === 0) throw new Error('Patch requires at least one operation');
  if (operations.length > 20) throw new Error('Patch is limited to 20 operations');

  const originals = new Map<string, string>();
  const finals = new Map<string, string>();
  for (const operation of operations) {
    let current = finals.get(operation.path);
    if (current === undefined) {
      current = await readTextFile(workspace, operation.path, maxReadBytes);
      originals.set(operation.path, current);
    }
    const count = occurrenceCount(current, operation.expected);
    if (count !== 1) {
      throw new Error(`Patch guard failed for ${operation.path}: expected text occurs ${count} times`);
    }
    finals.set(operation.path, current.replace(operation.expected, operation.replacement));
  }

  const paths = [...originals.keys()];
  const checkpoint = await createCheckpoint(dataDir, workspace, paths, maxReadBytes);
  try {
    for (const [path, content] of finals) await writeTextFile(workspace, path, content);
  } catch (error) {
    try {
      await restoreCheckpoint(dataDir, workspace, checkpoint.id);
    } catch (restoreError) {
      throw new Error(
        `Patch write failed and automatic rollback also failed: ${String(error)}; rollback: ${String(restoreError)}`,
      );
    }
    throw error;
  }
  return { checkpoint, paths };
}
