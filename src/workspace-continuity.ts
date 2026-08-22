import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { execFile, resolveExecutable, type ExecResult } from './process.js';
import { assertNotSecret, canonicalWorkspace } from './security.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GIT_SHA = /^[0-9a-f]{40,64}$/i;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 80;
const GENERATED_ROOTS = new Set(['node_modules', 'dist', 'build', 'coverage', '.cache', '.next', '.turbo', '.parcel-cache']);

export class WorkspaceContinuityError extends Error {
  constructor(message: string, readonly code = 'WORKSPACE_CONTINUITY_FAILED') { super(message); }
}

export interface WorkspaceWipFile {
  path: string;
  state: 'modified' | 'untracked' | 'deleted';
  sha256: string | null;
  sizeBytes: number | null;
}

export interface WorkspaceWipCheckpoint {
  schemaVersion: 1;
  checkpointId: string;
  projectId: string;
  taskId: string | null;
  sourceDeviceId: string;
  baseRevision: string;
  wipRevision: string | null;
  wipRef: string | null;
  treeRevision: string;
  files: WorkspaceWipFile[];
  artifactRefs: string[];
  syncState: 'CLEAN' | 'SYNCED' | 'UNSYNCED';
  createdAt: string;
}

function checkedUuid(value: string, field: string): string {
  if (!UUID.test(value)) throw new WorkspaceContinuityError(`${field} is invalid`, 'IDENTITY_INVALID');
  return value.toLowerCase();
}

function checkedSha(value: string, field: string): string {
  if (!GIT_SHA.test(value)) throw new WorkspaceContinuityError(`${field} is invalid`, 'GIT_STATE_INVALID');
  return value.toLowerCase();
}

function checkedRef(value: string): string {
  if (!/^refs\/awh\/wip\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i.test(value)) throw new WorkspaceContinuityError('WIP reference is invalid', 'WIP_REFERENCE_INVALID');
  return value;
}

function checkedRelativePath(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  if (!normalized || normalized.length > 240 || isAbsolute(normalized) || normalized.startsWith('../') || normalized.includes('/../') || normalized.split('/').some((part) => !part || part === '.')) throw new WorkspaceContinuityError('Workspace file path is invalid', 'WIP_PATH_INVALID');
  try { assertNotSecret(normalized); } catch { throw new WorkspaceContinuityError('Workspace change contains a protected path', 'WIP_SECRET_PATH'); }
  return normalized;
}

function isGeneratedPath(path: string): boolean { return GENERATED_ROOTS.has(path.split('/')[0] ?? ''); }

function secretLikeContent(value: string): boolean {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:^|\n)\s*(?:[A-Z0-9_]*?(?:PASSWORD|SECRET|TOKEN|API[_-]?KEY)|AUTHORIZATION)\s*[:=]\s*['"]?[^\s'"]{8,}/i.test(value);
}

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<ExecResult> {
  const executable = await resolveExecutable('git');
  return execFile(executable, ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'submodule.recurse=false', ...args], cwd, 90_000, env);
}

async function gitValue(cwd: string, args: string[], code = 'GIT_STATE_INVALID'): Promise<string> {
  const result = await git(cwd, args);
  const value = result.stdout.trim();
  if (result.code !== 0 || !GIT_SHA.test(value)) throw new WorkspaceContinuityError('Git source state could not be verified', code);
  return value.toLowerCase();
}

/** A clean worktree is not a durable handoff when its checked-out revision only exists locally. */
async function headIsAvailableFromConfiguredUpstream(workspace: string): Promise<boolean> {
  const upstream = await git(workspace, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  if (upstream.code !== 0 || upstream.stdout.trim() === '') return false;
  const distance = await git(workspace, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
  if (distance.code !== 0) return false;
  const counts = distance.stdout.trim().split(/\s+/).map((value) => Number.parseInt(value, 10));
  return counts.length === 2 && counts.every(Number.isSafeInteger) && counts[1] === 0;
}

async function changedPaths(workspace: string): Promise<Array<{ path: string; state: WorkspaceWipFile['state'] }>> {
  const [changed, untracked] = await Promise.all([
    git(workspace, ['diff', '--name-only', '-z', 'HEAD', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', '--']),
    git(workspace, ['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  if (changed.code !== 0 || untracked.code !== 0) throw new WorkspaceContinuityError('Git workspace status is unavailable', 'GIT_STATUS_FAILED');
  const tracked = changed.stdout.split('\0').filter(Boolean).map((path) => ({ path: checkedRelativePath(path), state: 'modified' as const }));
  const extra = untracked.stdout.split('\0').filter(Boolean).map((path) => ({ path: checkedRelativePath(path), state: 'untracked' as const }));
  const seen = new Map<string, WorkspaceWipFile['state']>();
  for (const entry of [...tracked, ...extra]) seen.set(entry.path, entry.state);
  return [...seen].map(([path, state]) => ({ path, state }));
}

async function manifestForChanges(workspace: string): Promise<{ files: WorkspaceWipFile[]; syncablePaths: string[] }> {
  const changes = await changedPaths(workspace);
  if (changes.length > MAX_FILES) throw new WorkspaceContinuityError('Too many changed files for a safe WIP checkpoint', 'WIP_FILE_LIMIT');
  const files: WorkspaceWipFile[] = [];
  const syncablePaths: string[] = [];
  let total = 0;
  for (const change of changes) {
    const full = join(workspace, ...change.path.split('/'));
    try {
      const info = await lstat(full);
      if (info.isSymbolicLink() || !info.isFile()) throw new WorkspaceContinuityError('WIP checkpoint accepts regular files only', 'WIP_FILE_UNSUPPORTED');
      if (isGeneratedPath(change.path) && change.state === 'untracked') continue;
      if (info.size > MAX_FILE_BYTES || total + info.size > MAX_TOTAL_BYTES) throw new WorkspaceContinuityError('WIP checkpoint is limited to bounded source files', 'WIP_FILE_UNSUPPORTED');
      const content = await readFile(full);
      if (content.includes(0) || secretLikeContent(content.toString('utf8'))) throw new WorkspaceContinuityError('WIP checkpoint contains protected content', 'WIP_SECRET_CONTENT');
      total += content.length;
      files.push({ path: change.path, state: change.state, sha256: createHash('sha256').update(content).digest('hex'), sizeBytes: content.length });
      syncablePaths.push(change.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && change.state === 'modified') {
        files.push({ path: change.path, state: 'deleted', sha256: null, sizeBytes: null });
        syncablePaths.push(change.path);
        continue;
      }
      throw error;
    }
  }
  return { files, syncablePaths };
}

function validatedCheckpoint(input: Omit<WorkspaceWipCheckpoint, 'schemaVersion' | 'checkpointId' | 'createdAt'> & Partial<Pick<WorkspaceWipCheckpoint, 'checkpointId' | 'createdAt'>>): WorkspaceWipCheckpoint {
  const record: WorkspaceWipCheckpoint = { schemaVersion: 1, checkpointId: input.checkpointId ?? randomUUID(), createdAt: input.createdAt ?? new Date().toISOString(), ...input };
  checkedUuid(record.checkpointId, 'checkpoint'); checkedUuid(record.projectId, 'project'); checkedUuid(record.sourceDeviceId, 'device');
  if (record.taskId !== null) checkedUuid(record.taskId, 'task');
  checkedSha(record.baseRevision, 'base revision'); checkedSha(record.treeRevision, 'tree revision');
  if (record.syncState === 'CLEAN' && (record.wipRevision !== null || record.wipRef !== null || record.files.length !== 0)) throw new WorkspaceContinuityError('Clean checkpoint is inconsistent', 'WIP_CHECKPOINT_INVALID');
  if (record.syncState === 'SYNCED' && (record.wipRevision === null || record.wipRef === null)) throw new WorkspaceContinuityError('Synced checkpoint is incomplete', 'WIP_CHECKPOINT_INVALID');
  if (record.wipRevision !== null) checkedSha(record.wipRevision, 'WIP revision'); if (record.wipRef !== null) checkedRef(record.wipRef);
  if (!Number.isFinite(Date.parse(record.createdAt)) || record.files.length > MAX_FILES || record.artifactRefs.length > 20) throw new WorkspaceContinuityError('WIP checkpoint is invalid', 'WIP_CHECKPOINT_INVALID');
  for (const file of record.files) { checkedRelativePath(file.path); if (!['modified', 'untracked', 'deleted'].includes(file.state) || (file.state === 'deleted' ? file.sha256 !== null || file.sizeBytes !== null : !/^[0-9a-f]{64}$/i.test(file.sha256 ?? '') || !Number.isSafeInteger(file.sizeBytes) || (file.sizeBytes ?? -1) < 0)) throw new WorkspaceContinuityError('WIP file metadata is invalid', 'WIP_CHECKPOINT_INVALID'); }
  return record;
}

/** Create an isolated Git commit for bounded WIP without changing the current branch or working tree. */
export async function createWorkspaceWipCheckpoint(input: { workspace: string; projectId: string; sourceDeviceId: string; taskId?: string | null; artifactRefs?: string[]; remoteName?: string }): Promise<WorkspaceWipCheckpoint> {
  const workspace = await canonicalWorkspace(input.workspace);
  const projectId = checkedUuid(input.projectId, 'project');
  const sourceDeviceId = checkedUuid(input.sourceDeviceId, 'device');
  const taskId = input.taskId === undefined ? null : input.taskId === null ? null : checkedUuid(input.taskId, 'task');
  const baseRevision = await gitValue(workspace, ['rev-parse', '--verify', 'HEAD']);
  const treeRevision = await gitValue(workspace, ['rev-parse', '--verify', 'HEAD^{tree}']);
  const { files, syncablePaths } = await manifestForChanges(workspace);
  if (files.length === 0) {
    const synced = await headIsAvailableFromConfiguredUpstream(workspace);
    return validatedCheckpoint({ projectId, sourceDeviceId, taskId, baseRevision, wipRevision: null, wipRef: null, treeRevision, files: [], artifactRefs: [...new Set(input.artifactRefs ?? [])].slice(0, 20), syncState: synced ? 'CLEAN' : 'UNSYNCED' });
  }
  const checkpointId = randomUUID();
  const wipRef = `refs/awh/wip/${projectId}/${checkpointId}`;
  const temp = await mkdtemp(join(tmpdir(), 'awh-wip-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(temp, 'index'), GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'AWH WIP', GIT_AUTHOR_EMAIL: 'awh-wip@local.invalid', GIT_COMMITTER_NAME: 'AWH WIP', GIT_COMMITTER_EMAIL: 'awh-wip@local.invalid' };
  try {
    const readTree = await git(workspace, ['read-tree', 'HEAD'], env); if (readTree.code !== 0) throw new WorkspaceContinuityError('WIP checkpoint could not prepare a safe Git index', 'WIP_STAGE_FAILED');
    const stage = await git(workspace, ['add', '--all', '--', ...syncablePaths], env); if (stage.code !== 0) throw new WorkspaceContinuityError('WIP checkpoint could not stage bounded source files', 'WIP_STAGE_FAILED');
    const tree = await git(workspace, ['write-tree'], env); const wipTree = tree.stdout.trim(); if (tree.code !== 0 || !GIT_SHA.test(wipTree)) throw new WorkspaceContinuityError('WIP checkpoint tree is invalid', 'WIP_TREE_FAILED');
    const commit = await git(workspace, ['commit-tree', wipTree, '-p', baseRevision, '-m', `AWH WIP checkpoint ${checkpointId}`], env); const wipRevision = commit.stdout.trim(); if (commit.code !== 0 || !GIT_SHA.test(wipRevision)) throw new WorkspaceContinuityError('WIP checkpoint commit is invalid', 'WIP_COMMIT_FAILED');
    const update = await git(workspace, ['update-ref', wipRef, wipRevision], env); if (update.code !== 0) throw new WorkspaceContinuityError('WIP checkpoint reference could not be prepared', 'WIP_REFERENCE_FAILED');
    const push = await git(workspace, ['push', '--porcelain', 'origin', `${wipRef}:${wipRef}`], env); if (push.code !== 0) throw new WorkspaceContinuityError('WIP checkpoint could not be synchronized to the project source', 'WIP_PUSH_FAILED');
    const remote = await git(workspace, ['ls-remote', '--refs', 'origin', wipRef], env);
    const remoteRevision = remote.stdout.trim().split(/\s+/)[0] ?? '';
    if (remote.code !== 0 || !GIT_SHA.test(remoteRevision) || remoteRevision.toLowerCase() !== wipRevision.toLowerCase()) throw new WorkspaceContinuityError('WIP checkpoint synchronization could not be verified', 'WIP_REMOTE_VERIFY_FAILED');
    await git(workspace, ['update-ref', '-d', wipRef], env);
    return validatedCheckpoint({ checkpointId, projectId, sourceDeviceId, taskId, baseRevision, wipRevision, wipRef, treeRevision: wipTree, files, artifactRefs: [...new Set(input.artifactRefs ?? [])].slice(0, 20), syncState: 'SYNCED' });
  } finally { await rm(temp, { recursive: true, force: true }); }
}

/** Record a truthful non-transferable state when source WIP cannot be made safe to hand off. */
export async function createUnsyncedWorkspaceCheckpoint(input: { workspace: string; projectId: string; sourceDeviceId: string; taskId?: string | null; artifactRefs?: string[] }): Promise<WorkspaceWipCheckpoint> {
  const workspace = await canonicalWorkspace(input.workspace);
  const projectId = checkedUuid(input.projectId, 'project');
  const sourceDeviceId = checkedUuid(input.sourceDeviceId, 'device');
  const taskId = input.taskId === undefined ? null : input.taskId === null ? null : checkedUuid(input.taskId, 'task');
  const baseRevision = await gitValue(workspace, ['rev-parse', '--verify', 'HEAD']);
  const treeRevision = await gitValue(workspace, ['rev-parse', '--verify', 'HEAD^{tree}']);
  return validatedCheckpoint({ projectId, sourceDeviceId, taskId, baseRevision, wipRevision: null, wipRef: null, treeRevision, files: [], artifactRefs: [...new Set(input.artifactRefs ?? [])].slice(0, 20), syncState: 'UNSYNCED' });
}

/** Restore only a verified, durable WIP ref into a clean same-base working copy. */
export async function reconstructWorkspaceWip(input: { workspace: string; checkpoint: WorkspaceWipCheckpoint }): Promise<void> {
  const workspace = await canonicalWorkspace(input.workspace);
  const checkpointRecord = validatedCheckpoint(input.checkpoint);
  const base = await gitValue(workspace, ['rev-parse', '--verify', 'HEAD']);
  if (base !== checkpointRecord.baseRevision) throw new WorkspaceContinuityError('Target workspace does not match the checkpoint base revision', 'BASE_REVISION_MISMATCH');
  const dirty = await git(workspace, ['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=all']);
  if (dirty.code !== 0) throw new WorkspaceContinuityError('Target workspace state is unavailable', 'GIT_STATUS_FAILED');
  if (dirty.stdout.trim() !== '') throw new WorkspaceContinuityError('Target workspace has protected local changes', 'TARGET_WORKSPACE_DIRTY');
  if (checkpointRecord.syncState === 'CLEAN') return;
  if (checkpointRecord.syncState !== 'SYNCED' || checkpointRecord.wipRevision === null || checkpointRecord.wipRef === null) throw new WorkspaceContinuityError('Checkpoint is not durably synchronized', 'CHECKPOINT_NOT_SYNCED');
  const fetch = await git(workspace, ['fetch', '--no-tags', 'origin', checkpointRecord.wipRef]); if (fetch.code !== 0) throw new WorkspaceContinuityError('Checkpoint source could not be fetched', 'WIP_FETCH_FAILED');
  const fetched = await gitValue(workspace, ['rev-parse', '--verify', 'FETCH_HEAD^{commit}']); if (fetched !== checkpointRecord.wipRevision) throw new WorkspaceContinuityError('Fetched WIP revision does not match the checkpoint', 'WIP_REVISION_MISMATCH');
  const parent = await gitValue(workspace, ['rev-parse', '--verify', `${fetched}^`]); if (parent !== checkpointRecord.baseRevision) throw new WorkspaceContinuityError('WIP checkpoint base does not match', 'WIP_BASE_MISMATCH');
  const tree = await gitValue(workspace, ['rev-parse', '--verify', `${fetched}^{tree}`]); if (tree !== checkpointRecord.treeRevision) throw new WorkspaceContinuityError('WIP checkpoint content does not match', 'WIP_TREE_MISMATCH');
  const checkout = await git(workspace, ['read-tree', '--reset', '-u', fetched]); if (checkout.code !== 0) throw new WorkspaceContinuityError('WIP workspace reconstruction failed safely', 'WIP_RESTORE_FAILED');
  const unstage = await git(workspace, ['reset', '--mixed', checkpointRecord.baseRevision]); if (unstage.code !== 0) throw new WorkspaceContinuityError('WIP workspace could not return to editable state', 'WIP_RESTORE_FAILED');
  for (const file of checkpointRecord.files) {
    const full = join(workspace, ...file.path.split('/'));
    if (file.state === 'deleted') { try { await lstat(full); throw new WorkspaceContinuityError('Deleted WIP file was unexpectedly restored', 'WIP_CONTENT_MISMATCH'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; } }
    const data = await readFile(full); if (createHash('sha256').update(data).digest('hex') !== file.sha256 || data.length !== file.sizeBytes) throw new WorkspaceContinuityError('Restored WIP file failed integrity verification', 'WIP_CONTENT_MISMATCH');
  }
}

export function workspaceCheckpointRelativePath(workspace: string, candidate: string): string {
  const result = relative(workspace, candidate).split(sep).join('/');
  return checkedRelativePath(result);
}
