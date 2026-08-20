import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execCommand } from './process.js';
import { readTextFile } from './files.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHECKPOINT_ID = /^[A-Za-z0-9._-]{1,120}$/;
const MAX_HANDOFF_CHARS = 1_200;
const MAX_CHECKPOINT_BYTES = 64 * 1024;

export interface ContinuityCheckpoint {
  schemaVersion: 1;
  checkpointId: string;
  projectId: string;
  taskId: string;
  sourceDeviceId: string;
  sourceRevision: string | null;
  sourceDirty: boolean;
  taskState: string;
  goalSummary: string;
  handoffSummary: string | null;
  artifactRefs: string[];
  createdAt: string;
}

export interface ContinuityDiscovery {
  available: boolean;
  newer: boolean;
  protectedLocalChanges: boolean;
  checkpoint: ContinuityCheckpoint | null;
  reason: string;
}

function continuityDir(dataDir: string): string { return join(dataDir, 'continuity'); }
function checkpointPath(dataDir: string, id: string): string { return join(continuityDir(dataDir), `${id}.json`); }
function boundedText(value: unknown, max: number): string { if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Continuity text is invalid'); return value; }

function validateCheckpoint(value: unknown): ContinuityCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Continuity checkpoint is invalid');
  const record = value as Record<string, unknown>;
  const expected = 'artifactRefs,checkpointId,createdAt,goalSummary,handoffSummary,projectId, schemaVersion,sourceDeviceId,sourceDirty,sourceRevision,taskId,taskState'.replaceAll(' ', '');
  if (Object.keys(record).sort().join(',') !== expected) throw new Error('Continuity checkpoint contains unsupported fields');
  if (record.schemaVersion !== 1 || typeof record.checkpointId !== 'string' || !CHECKPOINT_ID.test(record.checkpointId) || typeof record.projectId !== 'string' || !UUID_V4.test(record.projectId) || typeof record.taskId !== 'string' || !CHECKPOINT_ID.test(record.taskId) || typeof record.sourceDeviceId !== 'string' || !UUID_V4.test(record.sourceDeviceId) || (record.sourceRevision !== null && (typeof record.sourceRevision !== 'string' || !/^[0-9a-f]{7,64}$/i.test(record.sourceRevision))) || typeof record.sourceDirty !== 'boolean' || typeof record.taskState !== 'string' || !/^[A-Z_]{3,40}$/.test(record.taskState) || !Array.isArray(record.artifactRefs) || record.artifactRefs.length > 20 || record.artifactRefs.some((ref) => typeof ref !== 'string' || ref.length > 240 || ref.startsWith('/') || /^[A-Za-z]:[\\/]/.test(ref) || ref.includes('..')) || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))) throw new Error('Continuity checkpoint fields are invalid');
  boundedText(record.goalSummary, 400);
  if (record.handoffSummary !== null) boundedText(record.handoffSummary, MAX_HANDOFF_CHARS);
  return record as unknown as ContinuityCheckpoint;
}

async function gitRevision(workspace: string): Promise<string | null> {
  try { const result = await execCommand('git', ['rev-parse', '--verify', 'HEAD'], workspace, 10_000); return result.code === 0 && /^[0-9a-f]{7,64}$/i.test(result.stdout.trim()) ? result.stdout.trim() : null; } catch { return null; }
}

async function gitDirty(workspace: string): Promise<boolean> {
  try { const result = await execCommand('git', ['status', '--porcelain', '--untracked-files=all', '--'], workspace, 10_000); return result.code === 0 && result.stdout.trim().length > 0; } catch { return true; }
}

export async function createContinuityCheckpoint(input: { dataDir: string; workspace: string; projectId: string; taskId: string; sourceDeviceId: string; taskState: string; goalSummary: string; artifactRefs: string[] }): Promise<ContinuityCheckpoint> {
  if (!UUID_V4.test(input.projectId) || !UUID_V4.test(input.sourceDeviceId)) throw new Error('Continuity identity is invalid');
  const handoff = await readTextFile(input.workspace, 'HANDOFF.md', 32 * 1024).catch(() => null);
  const checkpoint: ContinuityCheckpoint = validateCheckpoint({
    schemaVersion: 1,
    checkpointId: `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`,
    projectId: input.projectId,
    taskId: input.taskId,
    sourceDeviceId: input.sourceDeviceId,
    sourceRevision: await gitRevision(input.workspace),
    sourceDirty: await gitDirty(input.workspace),
    taskState: input.taskState,
    goalSummary: boundedText(input.goalSummary.trim(), 400),
    handoffSummary: handoff === null ? null : handoff.replace(/\s+/g, ' ').trim().slice(0, MAX_HANDOFF_CHARS),
    artifactRefs: [...new Set(input.artifactRefs)].slice(0, 20),
    createdAt: new Date().toISOString(),
  });
  await mkdir(continuityDir(input.dataDir), { recursive: true, mode: 0o700 });
  const target = checkpointPath(input.dataDir, checkpoint.checkpointId);
  const temporary = `${target}.tmp-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(checkpoint)}\n`, { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') await chmod(temporary, 0o600);
  await rename(temporary, target);
  if (process.platform !== 'win32') await chmod(target, 0o600);
  return checkpoint;
}

export async function readContinuityCheckpoint(path: string): Promise<ContinuityCheckpoint> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_CHECKPOINT_BYTES) throw new Error('Continuity checkpoint file is unsafe');
  return validateCheckpoint(JSON.parse(await readFile(path, 'utf8')));
}

export async function discoverContinuity(dataDir: string, projectId: string, localWorkspaceDirty: boolean): Promise<ContinuityDiscovery> {
  if (!UUID_V4.test(projectId)) throw new Error('Project id is invalid');
  let names: string[];
  try { names = await readdir(continuityDir(dataDir)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { available: false, newer: false, protectedLocalChanges: false, checkpoint: null, reason: 'No continuity checkpoint is available on this device' }; throw error; }
  const checkpoints: ContinuityCheckpoint[] = [];
  for (const name of names.filter((value) => value.endsWith('.json'))) {
    try { const checkpoint = await readContinuityCheckpoint(join(continuityDir(dataDir), name)); if (checkpoint.projectId === projectId) checkpoints.push(checkpoint); } catch { /* fail closed per record */ }
  }
  const checkpoint = checkpoints.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  if (!checkpoint) return { available: false, newer: false, protectedLocalChanges: false, checkpoint: null, reason: 'No checkpoint for this project is available' };
  const protectedLocalChanges = localWorkspaceDirty;
  return { available: true, newer: true, protectedLocalChanges, checkpoint, reason: protectedLocalChanges ? 'Local changes are protected; review before continuing' : 'A checkpoint is ready to continue here' };
}
