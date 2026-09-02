import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { chmod, lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { canonicalWorkspace, resolveForWrite } from './security.js';
import { readTextFile } from './files.js';
import { detectProject } from './project.js';
import { gitStatus } from './git.js';
import { ensureAwhDataDirectoryActive } from './data-migration.js';
import { loadOwnerProtocol } from './owner-protocol.js';

export const PROJECT_REGISTRY_SCHEMA_VERSION = 1;
export const PROJECT_MANIFEST_SCHEMA_VERSION = 1;
export const PROJECT_MANIFEST_PATH = '.awh/project.json';
export const PROJECT_MEMORY_FILES = ['CURRENT_STATE.md', 'PROJECT.md', 'HANDOFF.md', 'TASKS.md', 'ARCHITECTURE.md', 'DECISIONS.md'] as const;

const REGISTRY_FILENAME = 'projects.json';
const MAX_REGISTRY_BYTES = 1024 * 1024;
const MAX_PROJECTS = 500;
const MAX_MANIFEST_BYTES = 16 * 1024;
const MAX_MEMORY_FILE_BYTES = 32 * 1024;
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

export interface ProjectManifest { schemaVersion: 1; projectId: string; name: string; type: string; createdAt: string; }
export interface ProjectInitializationOptions { name?: string; type?: string; }
export interface ProjectRecord { projectId: string; workspacePath: string; lastOpenedAt: string; lastUsedAt: string; pinned: boolean; available: boolean; }
export type ProjectMemoryFileStatus = 'present' | 'missing';
export type ProjectMemoryStatus = Record<(typeof PROJECT_MEMORY_FILES)[number], ProjectMemoryFileStatus>;
export interface ProjectContext {
  ownerProtocol: string;
  project: ProjectManifest;
  memory: Record<(typeof PROJECT_MEMORY_FILES)[number], string | null>;
  workspace: { path: string; profile: Awaited<ReturnType<typeof detectProject>> };
  git: { code: number; stdout: string; stderr: string };
}
export interface ResolvedProjectRecord { record: ProjectRecord; workspacePath: string; manifest: ProjectManifest; }
interface RegistryDocument { schemaVersion: 1; projects: ProjectRecord[]; }

export class ProjectRegistryError extends Error {
  constructor(message: string, readonly code = 'PROJECT_REGISTRY_INVALID') { super(message); this.name = 'ProjectRegistryError'; }
}

function registryPath(dataDir: string): string { return join(dataDir, REGISTRY_FILENAME); }
function assertProjectId(projectId: string): void { if (!PROJECT_ID.test(projectId)) throw new ProjectRegistryError('Project manifest id is invalid', 'PROJECT_ID_INVALID'); }

function isPortableAbsolutePath(value: string): boolean {
  return isAbsolute(value) || /^(?:[A-Za-z]:[\\/]|[\\/]{1,2}|~[\\/])/.test(value);
}

function assertPortableName(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(value) || /[\\/]/.test(value) || isPortableAbsolutePath(value.trim()) || /^https?:\/\//i.test(value.trim())) throw new ProjectRegistryError('Project name is not portable', 'PROJECT_NAME_INVALID');
}

function normalizeProjectType(value: unknown): string {
  if (typeof value !== 'string') throw new ProjectRegistryError('Project type is not portable', 'PROJECT_TYPE_INVALID');
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(normalized)) throw new ProjectRegistryError('Project type is not portable', 'PROJECT_TYPE_INVALID');
  return normalized;
}

function parseManifest(raw: string): ProjectManifest {
  const value = JSON.parse(raw) as Record<string, unknown>;
  const keys = Object.keys(value).sort().join(',');
  if (keys !== 'createdAt,name,projectId,schemaVersion,type' || value.schemaVersion !== PROJECT_MANIFEST_SCHEMA_VERSION || typeof value.projectId !== 'string' || !PROJECT_ID.test(value.projectId) || !ISO_DATE(value.createdAt)) throw new ProjectRegistryError('Project manifest is malformed or contains non-portable fields', 'PROJECT_MANIFEST_INVALID');
  assertPortableName(value.name);
  normalizeProjectType(value.type);
  return value as unknown as ProjectManifest;
}

function parseRegistry(raw: string): RegistryDocument {
  const value = JSON.parse(raw) as Partial<RegistryDocument>;
  if (value.schemaVersion !== PROJECT_REGISTRY_SCHEMA_VERSION || !Array.isArray(value.projects) || value.projects.length > MAX_PROJECTS) throw new ProjectRegistryError('Project registry is malformed');
  for (const project of value.projects as unknown as Array<Record<string, unknown>>) {
    const keys = Object.keys(project).sort().join(',');
    if (keys !== 'available,lastOpenedAt,lastUsedAt,pinned,projectId,workspacePath' || typeof project.projectId !== 'string' || !PROJECT_ID.test(project.projectId) || typeof project.workspacePath !== 'string' || !isAbsolute(project.workspacePath) || !ISO_DATE(project.lastOpenedAt) || !ISO_DATE(project.lastUsedAt) || typeof project.pinned !== 'boolean' || typeof project.available !== 'boolean') throw new ProjectRegistryError('Project registry record is malformed');
  }
  return value as RegistryDocument;
}

async function readBounded(path: string, maxBytes: number): Promise<string> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile() || info.size > maxBytes) throw new ProjectRegistryError('Project data file is invalid');
  return readFile(path, 'utf8');
}

async function loadRegistry(dataDir: string): Promise<RegistryDocument> {
  try { return parseRegistry(await readBounded(registryPath(dataDir), MAX_REGISTRY_BYTES)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, projects: [] }; throw error; }
}

async function writeRegistry(dataDir: string, registry: RegistryDocument): Promise<void> {
  await ensureAwhDataDirectoryActive(dataDir);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(dataDir, 0o700);
  const path = registryPath(dataDir);
  const temporary = `${path}.tmp-${randomUUID()}`;
  await writeFile(temporary, JSON.stringify(registry), { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') await chmod(temporary, 0o600);
  await rename(temporary, path);
  if (process.platform !== 'win32') await chmod(path, 0o600);
}

async function readManifestAt(workspace: string): Promise<{ root: string; manifest: ProjectManifest }> {
  const root = await canonicalWorkspace(workspace);
  const manifestPath = join(root, PROJECT_MANIFEST_PATH);
  try {
    const info = await lstat(manifestPath);
    if (info.isSymbolicLink()) throw new ProjectRegistryError('Project manifest symlink is not allowed', 'PROJECT_MANIFEST_SYMLINK');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ProjectRegistryError('Project is not initialized', 'PROJECT_NOT_INITIALIZED');
    throw error;
  }
  return { root, manifest: parseManifest(await readTextFile(root, PROJECT_MANIFEST_PATH, MAX_MANIFEST_BYTES)) };
}

export async function readProjectManifest(workspace: string): Promise<ProjectManifest> { return (await readManifestAt(workspace)).manifest; }

/** Explicitly initialize portable identity; never derives identity from a path. */
export async function initializeProject(workspace: string, options: ProjectInitializationOptions = {}): Promise<ProjectManifest> {
  const root = await canonicalWorkspace(workspace);
  const manifestPath = await resolveForWrite(root, PROJECT_MANIFEST_PATH);
  try {
    const info = await lstat(manifestPath);
    if (info.isSymbolicLink()) throw new ProjectRegistryError('Project manifest symlink is not allowed', 'PROJECT_MANIFEST_SYMLINK');
    return parseManifest(await readTextFile(root, PROJECT_MANIFEST_PATH, MAX_MANIFEST_BYTES));
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await mkdir(dirname(manifestPath), { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(dirname(manifestPath), 0o700);
  const profile = await detectProject(root);
  const name = options.name?.trim() || basename(root) || 'AWH Project';
  const type = options.type?.trim().toLowerCase() || (profile.primary === 'unknown' ? 'general' : profile.primary);
  assertPortableName(name);
  const normalizedType = normalizeProjectType(type);
  const manifest: ProjectManifest = { schemaVersion: 1, projectId: randomUUID(), name, type: normalizedType, createdAt: new Date().toISOString() };
  try {
    await writeFile(manifestPath, JSON.stringify(manifest), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    if (process.platform !== 'win32') await chmod(manifestPath, 0o600);
    return manifest;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; return readProjectManifest(root); }
}

const MEMORY_TEMPLATES: Record<(typeof PROJECT_MEMORY_FILES)[number], string> = {
  'CURRENT_STATE.md': '# Current State\n\nRecord only the latest verified source/runtime state here. Fresh observed evidence outranks this snapshot; this snapshot outranks dated checkpoint prose.\n',
  'PROJECT.md': '# Project\n\nPurpose, scope, and stable project constraints.\n',
  'HANDOFF.md': '# Handoff\n\nCurrent state, next action, and known blockers.\n',
  'TASKS.md': '# Tasks\n\n## Now\n\n## Next\n\n## Done\n',
  'ARCHITECTURE.md': '# Architecture\n\nKey components, boundaries, and important contracts.\n',
  'DECISIONS.md': '# Decisions\n\nRecord durable decisions and their rationale.\n',
};

async function createIfMissing(root: string, relativePath: string, content: string): Promise<boolean> {
  const candidate = join(root, relativePath);
  try {
    const info = await lstat(candidate);
    if (info.isSymbolicLink()) throw new ProjectRegistryError(`Memory file symlink is not allowed: ${relativePath}`, 'PROJECT_MEMORY_SYMLINK');
    if (!info.isFile()) throw new ProjectRegistryError(`Memory path is not a regular file: ${relativePath}`, 'PROJECT_MEMORY_INVALID');
    return false;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const safePath = await resolveForWrite(root, relativePath);
  await writeFile(safePath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  if (process.platform !== 'win32') await chmod(safePath, 0o600);
  return true;
}

/** Explicitly create only missing portable project-memory templates. */
export async function initializeProjectMemory(workspace: string): Promise<string[]> {
  const { root } = await readManifestAt(workspace);
  const created: string[] = [];
  for (const file of PROJECT_MEMORY_FILES) if (await createIfMissing(root, file, MEMORY_TEMPLATES[file])) created.push(file);
  return created;
}

export async function registerProject(dataDir: string, workspace: string): Promise<ProjectRecord> {
  const { root, manifest } = await readManifestAt(workspace);
  const registry = await loadRegistry(dataDir);
  const now = new Date().toISOString();
  const byPath = registry.projects.find((project) => project.workspacePath === root);
  const byIdRecords = registry.projects.filter((project) => project.projectId === manifest.projectId);
  if (byPath && byPath.projectId !== manifest.projectId) throw new ProjectRegistryError('Workspace already maps to another project id', 'PROJECT_PATH_CONFLICT');
  for (const byId of byIdRecords) {
    if (byId.workspacePath === root) continue;
    try {
      const availableRoot = await canonicalWorkspace(byId.workspacePath);
      if (availableRoot !== root) throw new ProjectRegistryError('Project id is already mapped to another available workspace', 'PROJECT_ID_CONFLICT');
    } catch (error) {
      if (error instanceof ProjectRegistryError) throw error;
    }
  }
  const existing = byIdRecords.find((project) => project.workspacePath === root);
  const record: ProjectRecord = { projectId: manifest.projectId, workspacePath: root, lastOpenedAt: now, lastUsedAt: now, pinned: existing?.pinned ?? false, available: true };
  registry.projects = registry.projects.filter((project) => project.projectId !== manifest.projectId && project.workspacePath !== root);
  registry.projects.push(record);
  if (registry.projects.length > MAX_PROJECTS) throw new ProjectRegistryError('Project registry limit reached');
  await writeRegistry(dataDir, registry);
  return record;
}

export async function listProjects(dataDir: string): Promise<ProjectRecord[]> { return (await loadRegistry(dataDir)).projects.map((project) => ({ ...project })); }

/** Mark a registered project as the selected/open project after re-validating its portable identity. */
export async function resolveRegisteredProject(dataDir: string, projectId: string): Promise<ResolvedProjectRecord> {
  assertProjectId(projectId);
  const registry = await loadRegistry(dataDir);
  const matches = registry.projects.filter((project) => project.projectId === projectId);
  if (matches.length === 0) throw new ProjectRegistryError('Project is not registered', 'PROJECT_NOT_REGISTERED');
  let selected: ResolvedProjectRecord | undefined;
  for (const record of matches) {
    try {
      const root = await canonicalWorkspace(record.workspacePath);
      const manifest = await readProjectManifest(root);
      if (manifest.projectId !== projectId) throw new ProjectRegistryError('Workspace manifest project id does not match the registry', 'PROJECT_ID_MISMATCH');
      if (selected && selected.workspacePath !== root) throw new ProjectRegistryError('Project id is mapped to more than one available workspace', 'PROJECT_ID_CONFLICT');
      selected = { record, workspacePath: root, manifest };
    } catch (error) {
      if (error instanceof ProjectRegistryError) throw error;
    }
  }
  if (!selected) throw new ProjectRegistryError('Registered project workspace is unavailable', 'PROJECT_WORKSPACE_UNAVAILABLE');
  return selected;
}

/** Mark a registered project as the selected/open project after re-validating its portable identity. */
export async function openRegisteredProject(dataDir: string, projectId: string): Promise<ProjectRecord> {
  const resolved = await resolveRegisteredProject(dataDir, projectId);
  const registry = await loadRegistry(dataDir);
  const now = new Date().toISOString();
  const updated = { ...resolved.record, available: true, lastOpenedAt: now, lastUsedAt: now };
  registry.projects = registry.projects.map((project) => project.workspacePath === resolved.workspacePath ? updated : project);
  await writeRegistry(dataDir, registry);
  return updated;
}

async function readMemoryFile(root: string, file: (typeof PROJECT_MEMORY_FILES)[number]): Promise<string | null> {
  const candidate = join(root, file);
  try {
    const info = await lstat(candidate);
    if (info.isSymbolicLink()) throw new ProjectRegistryError(`Memory file symlink is not allowed: ${file}`, 'PROJECT_MEMORY_SYMLINK');
    return await readTextFile(root, file, MAX_MEMORY_FILE_BYTES);
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

/** Return only portable memory presence; content remains behind the bounded context builder. */
export async function projectMemoryStatus(workspace: string): Promise<ProjectMemoryStatus> {
  const { root } = await readManifestAt(workspace);
  const status = {} as ProjectMemoryStatus;
  for (const file of PROJECT_MEMORY_FILES) {
    try {
      const info = await lstat(join(root, file));
      if (info.isSymbolicLink()) throw new ProjectRegistryError(`Memory file symlink is not allowed: ${file}`, 'PROJECT_MEMORY_SYMLINK');
      if (!info.isFile()) throw new ProjectRegistryError(`Memory path is not a regular file: ${file}`, 'PROJECT_MEMORY_INVALID');
      status[file] = 'present';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') status[file] = 'missing';
      else throw error;
    }
  }
  return status;
}

/** Build bounded context in canonical AI precedence: owner protocol, project memory, runtime/source state. */
export async function buildProjectContext(workspace: string): Promise<ProjectContext> {
  const { root, manifest } = await readManifestAt(workspace);
  const memory = {} as ProjectContext['memory'];
  for (const file of PROJECT_MEMORY_FILES) memory[file] = await readMemoryFile(root, file);
  const [ownerProtocol, profile, git] = await Promise.all([loadOwnerProtocol(), detectProject(root), gitStatus(root)]);
  return { ownerProtocol, project: manifest, memory, workspace: { path: root, profile }, git };
}
