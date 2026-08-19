import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';

export const MIGRATION_SCHEMA_VERSION = 1;
export const MIGRATION_MARKER_FILENAME = 'migration.json';
export const MIGRATION_STAGING_KIND = 'AWH_DATA_MIGRATION_STAGING';
export const MIGRATION_COMPLETE_KIND = 'AWH_DATA_MIGRATION';

type CategoryName = 'settings' | 'audit' | 'checkpoints' | 'tasks';
export type DataMigrationState =
  | 'NO_LEGACY_DATA'
  | 'AWH_ALREADY_ACTIVE'
  | 'MIGRATION_AVAILABLE'
  | 'MIGRATION_IN_PROGRESS'
  | 'MIGRATION_COMPLETE'
  | 'MIGRATION_CONFLICT'
  | 'MIGRATION_INVALID_LEGACY'
  | 'MIGRATION_FAILED';

export class DataDirectoryResolutionError extends Error {
  readonly state = 'MIGRATION_CONFLICT' as const;

  constructor(message: string) {
    super(message);
    this.name = 'DataDirectoryResolutionError';
  }
}

export interface MigrationCategoryReport {
  id: CategoryName;
  exists: boolean;
  fileCount: number;
  bytes: number;
  valid: boolean;
  summary: string;
}

export interface DataMigrationInspection {
  state: DataMigrationState;
  legacyDir: string;
  awhDir: string;
  stagingDirs: string[];
  categories: MigrationCategoryReport[];
  blockers: string[];
  fileCount: number;
  bytes: number;
}

export interface DataMigrationResult extends DataMigrationInspection {
  changed: boolean;
  marker?: Record<string, unknown>;
}

interface FileInfo {
  relativePath: string;
  bytes: number;
  content: Buffer;
  sha256: string;
}

interface MigrationMarker {
  schemaVersion: number;
  kind: string;
  source: '.art-agent';
  target: '.awh';
  migrationId?: string;
  completedAt?: string;
  categories?: CategoryName[];
  integrity?: { fileCount: number; bytes: number; sha256: string };
}

const CATEGORY_NAMES: CategoryName[] = ['settings', 'audit', 'checkpoints', 'tasks'];
const SAFE_NAME = /^[A-Za-z0-9._-]{1,120}$/;
const TASK_STATES = new Set(['running', 'succeeded', 'failed', 'stopped', 'timed_out', 'unknown_after_restart']);
const TASK_KEYS = new Set(['schema', 'runtimeId', 'id', 'label', 'state', 'code', 'signal', 'startedAt', 'finishedAt', 'truncated']);
const SECRET_KEY = /secret|token|password|credential|api[_-]?key|private[_-]?key/i;
const MAX_SETTINGS_BYTES = 64 * 1024;
const MAX_AUDIT_BYTES = 16 * 1024 * 1024;
const MAX_TASK_BYTES = 64 * 1024;
const MAX_CHECKPOINT_BYTES = 32 * 1024 * 1024;

function categoryPath(root: string, category: CategoryName): string {
  return join(root, category === 'settings' ? 'settings.json' : category === 'audit' ? 'audit.jsonl' : category);
}

function isSymlink(entry: { isSymbolicLink(): boolean }): boolean {
  return entry.isSymbolicLink();
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function issue(blockers: string[], message: string): void {
  blockers.push(message);
}

async function regularFile(path: string, blockers: string[], label: string): Promise<number | null> {
  try {
    const info = await lstat(path);
    if (isSymlink(info) || !info.isFile()) {
      issue(blockers, `${label} is not a regular file`);
      return null;
    }
    return info.size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    issue(blockers, `${label} could not be inspected`);
    return null;
  }
}

async function readRegularFile(path: string, maxBytes: number, blockers: string[], label: string): Promise<Buffer | null> {
  const size = await regularFile(path, blockers, label);
  if (size === null) return null;
  if (size > maxBytes) {
    issue(blockers, `${label} exceeds the supported size limit`);
    return null;
  }
  try {
    return await readFile(path);
  } catch {
    issue(blockers, `${label} could not be read`);
    return null;
  }
}

function fileInfo(relativePath: string, content: Buffer): FileInfo {
  return {
    relativePath,
    bytes: content.byteLength,
    content,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

function normalizeSettings(content: Buffer, blockers: string[]): Buffer | null {
  try {
    const parsed = JSON.parse(content.toString('utf8')) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    for (const [key, value] of Object.entries(parsed)) {
      if (SECRET_KEY.test(key)) {
        issue(blockers, 'settings.json contains an unsupported secret-looking field');
        continue;
      }
      if (key === 'defaultWorkspace' && typeof value !== 'string') issue(blockers, 'settings defaultWorkspace is invalid');
      if (['allowWrite', 'allowExec', 'allowCodex'].includes(key) && typeof value !== 'boolean') {
        issue(blockers, `settings ${key} is invalid`);
      }
    }
    const normalized: Record<string, unknown> = {};
    if (typeof parsed.defaultWorkspace === 'string' && parsed.defaultWorkspace.trim()) normalized.defaultWorkspace = parsed.defaultWorkspace;
    for (const key of ['allowWrite', 'allowExec', 'allowCodex']) if (typeof parsed[key] === 'boolean') normalized[key] = parsed[key];
    return Buffer.from(JSON.stringify(normalized), 'utf8');
  } catch {
    issue(blockers, 'settings.json is invalid JSON');
    return null;
  }
}

function validateAudit(content: Buffer, blockers: string[]): void {
  for (const [index, line] of content.toString('utf8').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (!entry || typeof entry !== 'object' || !validIso(entry.ts) || typeof entry.tool !== 'string' || typeof entry.outcome !== 'string' || typeof entry.detail !== 'string') {
        throw new Error('invalid audit entry');
      }
    } catch {
      issue(blockers, `audit.jsonl contains an invalid entry at line ${index + 1}`);
    }
  }
}

function validateTask(content: Buffer, blockers: string[], label: string): void {
  try {
    const parsed = JSON.parse(content.toString('utf8')) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).some((key) => !TASK_KEYS.has(key))) throw new Error('unsupported fields');
    if (parsed.schema !== 1 || typeof parsed.runtimeId !== 'string' || typeof parsed.id !== 'string' || !/^[A-Za-z0-9-]{1,120}$/.test(parsed.id) || typeof parsed.label !== 'string' || parsed.label.length > 200 || !TASK_STATES.has(String(parsed.state)) || (parsed.code !== null && typeof parsed.code !== 'number') || (parsed.signal !== null && typeof parsed.signal !== 'string') || !validIso(parsed.startedAt) || (parsed.finishedAt !== null && !validIso(parsed.finishedAt)) || typeof parsed.truncated !== 'boolean') {
      throw new Error('invalid task metadata');
    }
  } catch {
    issue(blockers, `${label} contains unsupported or invalid task metadata`);
  }
}

function validateCheckpointManifest(content: Buffer, id: string, blockers: string[], label: string): void {
  try {
    const parsed = JSON.parse(content.toString('utf8')) as Record<string, unknown>;
    if (parsed.id !== id || !validIso(parsed.createdAt) || !Array.isArray(parsed.files)) throw new Error('invalid manifest');
    for (const entry of parsed.files as Array<Record<string, unknown>>) {
      if (!entry || typeof entry.path !== 'string' || typeof entry.bytes !== 'number' || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) || typeof entry.contentBase64 !== 'string') throw new Error('invalid file record');
      const content = Buffer.from(entry.contentBase64, 'base64');
      if (content.byteLength !== entry.bytes || createHash('sha256').update(content).digest('hex') !== entry.sha256) throw new Error('integrity mismatch');
    }
  } catch {
    issue(blockers, `${label} is corrupt or fails integrity validation`);
  }
}

async function collectCategory(root: string, category: CategoryName, blockers: string[]): Promise<{ report: MigrationCategoryReport; files: FileInfo[] }> {
  const path = categoryPath(root, category);
  const files: FileInfo[] = [];
  if (category === 'settings' || category === 'audit') {
    const content = await readRegularFile(path, category === 'settings' ? MAX_SETTINGS_BYTES : MAX_AUDIT_BYTES, blockers, `${category}.json${category === 'audit' ? 'l' : ''}`);
    if (!content) return { report: { id: category, exists: false, fileCount: 0, bytes: 0, valid: !blockers.length, summary: 'absent' }, files };
    const normalized = category === 'settings' ? normalizeSettings(content, blockers) : content;
    if (category === 'audit') validateAudit(content, blockers);
    if (normalized) files.push(fileInfo(category === 'settings' ? 'settings.json' : 'audit.jsonl', normalized));
    return { report: { id: category, exists: true, fileCount: 1, bytes: content.byteLength, valid: blockers.length === 0, summary: 'validated metadata' }, files };
  }

  try {
    const info = await lstat(path);
    if (isSymlink(info) || !info.isDirectory()) {
      issue(blockers, `${category} is not a regular directory`);
      return { report: { id: category, exists: true, fileCount: 0, bytes: 0, valid: false, summary: 'invalid directory' }, files };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { report: { id: category, exists: false, fileCount: 0, bytes: 0, valid: true, summary: 'absent' }, files };
    issue(blockers, `${category} could not be inspected`);
    return { report: { id: category, exists: true, fileCount: 0, bytes: 0, valid: false, summary: 'unreadable' }, files };
  }

  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (category === 'checkpoints' && (!entry.isDirectory() || isSymlink(entry) || !SAFE_NAME.test(entry.name))) {
      issue(blockers, `checkpoints contains an unsafe entry`);
      continue;
    }
    if (category === 'tasks' && (isSymlink(entry) || !entry.isFile() || !entry.name.endsWith('.json') || !SAFE_NAME.test(entry.name.slice(0, -5)))) {
      issue(blockers, `tasks contains an unsafe entry`);
      continue;
    }
    const child = join(path, entry.name);
    if (category === 'checkpoints') {
      const manifestPath = join(child, 'checkpoint.json');
      const content = await readRegularFile(manifestPath, MAX_CHECKPOINT_BYTES, blockers, `checkpoint ${entry.name}`);
      if (!content) continue;
      validateCheckpointManifest(content, entry.name, blockers, `checkpoint ${entry.name}`);
      files.push(fileInfo(`checkpoints/${entry.name}/checkpoint.json`, content));
    } else {
      const content = await readRegularFile(child, MAX_TASK_BYTES, blockers, `task ${entry.name}`);
      if (!content) continue;
      validateTask(content, blockers, `task ${entry.name}`);
      files.push(fileInfo(`tasks/${entry.name}`, content));
    }
  }
  return { report: { id: category, exists: true, fileCount: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), valid: blockers.length === 0, summary: 'validated metadata' }, files };
}

async function inspectMarker(path: string): Promise<MigrationMarker | null> {
  try {
    const info = await lstat(path);
    if (isSymlink(info) || !info.isFile() || info.size > 16 * 1024) return null;
    const parsed = JSON.parse(await readFile(path, 'utf8')) as MigrationMarker;
    if (parsed.schemaVersion !== MIGRATION_SCHEMA_VERSION || ![MIGRATION_STAGING_KIND, MIGRATION_COMPLETE_KIND].includes(parsed.kind) || parsed.source !== '.art-agent' || parsed.target !== '.awh') return null;
    if (parsed.kind === MIGRATION_COMPLETE_KIND && !validIso(parsed.completedAt)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try { return (await lstat(path)).isDirectory(); } catch { return false; }
}

async function meaningfulDirectory(path: string): Promise<boolean> {
  try { return (await readdir(path)).length > 0; } catch { return true; }
}

async function ownedStagingDirs(awhDir: string): Promise<string[]> {
  const parent = dirname(awhDir);
  const base = basename(awhDir) || 'awh';
  const prefix = `${base.startsWith('.') ? base : `.${base}`}-migration-`;
  const result: string[] = [];
  try {
    for (const name of await readdir(parent)) {
      if (!name.startsWith(prefix)) continue;
      const candidate = join(parent, name);
      if (!(await directoryExists(candidate))) continue;
      if (await inspectMarker(join(candidate, MIGRATION_MARKER_FILENAME))) result.push(candidate);
    }
  } catch { /* An absent parent is equivalent to no staging. */ }
  return result;
}

function defaultPaths(home = homedir()): { legacyDir: string; awhDir: string } {
  return { legacyDir: resolve(home, '.art-agent'), awhDir: resolve(home, '.awh') };
}

/** Select one active data directory. Explicit AWH then legacy overrides are authoritative. */
export function resolveActiveDataDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (env.AWH_DATA_DIR) return resolve(env.AWH_DATA_DIR);
  if (env.ART_AGENT_DATA_DIR) return resolve(env.ART_AGENT_DATA_DIR);
  const { legacyDir, awhDir } = defaultPaths(home);
  const legacy = localDirectoryState(legacyDir);
  const awh = localDirectoryState(awhDir);

  if (awh.symlink || legacy.symlink || awh.invalidType || legacy.invalidType) {
    throw new DataDirectoryResolutionError('AWH data directories must be regular directories');
  }
  if (awh.complete) return awhDir;
  if (awh.meaningful && legacy.meaningful) {
    throw new DataDirectoryResolutionError('Both AWH and legacy data directories contain unresolved data');
  }
  if (awh.meaningful) {
    throw new DataDirectoryResolutionError('AWH data directory is not proven active by a complete migration marker');
  }
  if (legacy.exists) return legacyDir;
  return awhDir;
}

interface LocalDirectoryState {
  exists: boolean;
  meaningful: boolean;
  complete: boolean;
  symlink: boolean;
  invalidType: boolean;
}

function localDirectoryState(path: string): LocalDirectoryState {
  try {
    const info = lstatSync(path);
    if (info.isSymbolicLink()) return { exists: true, meaningful: true, complete: false, symlink: true, invalidType: false };
    if (!info.isDirectory()) return { exists: true, meaningful: true, complete: false, symlink: false, invalidType: true };
    let entries: string[];
    try { entries = readdirSync(path); } catch { return { exists: true, meaningful: true, complete: false, symlink: false, invalidType: false }; }
    const markerPath = join(path, MIGRATION_MARKER_FILENAME);
    let complete = false;
    try {
      const markerInfo = lstatSync(markerPath);
      if (markerInfo.isFile() && !markerInfo.isSymbolicLink() && markerInfo.size <= 16 * 1024) {
        const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as MigrationMarker;
        complete = marker.schemaVersion === MIGRATION_SCHEMA_VERSION && marker.kind === MIGRATION_COMPLETE_KIND && marker.source === '.art-agent' && marker.target === '.awh' && validIso(marker.completedAt);
      }
    } catch { /* Invalid or absent marker is not proof of an active AWH directory. */ }
    return { exists: true, meaningful: entries.length > 0, complete, symlink: false, invalidType: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false, meaningful: false, complete: false, symlink: false, invalidType: false };
    return { exists: true, meaningful: true, complete: false, symlink: false, invalidType: true };
  }
}

export async function inspectDataMigration(options: { legacyDir?: string; awhDir?: string } = {}): Promise<DataMigrationInspection> {
  const defaults = defaultPaths();
  const legacyDir = resolve(options.legacyDir ?? defaults.legacyDir);
  const awhDir = resolve(options.awhDir ?? defaults.awhDir);
  const blockers: string[] = [];
  const stagingDirs = await ownedStagingDirs(awhDir);
  const categories: MigrationCategoryReport[] = [];
  let fileCount = 0;
  let bytes = 0;
  let legacyExists = false;
  let awhExists = false;
  try {
    const legacyInfo = await lstat(legacyDir);
    if (isSymlink(legacyInfo) || !legacyInfo.isDirectory()) issue(blockers, 'legacy data directory is not a regular directory');
    else legacyExists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') issue(blockers, 'legacy data directory could not be inspected');
  }
  try {
    const awhInfo = await lstat(awhDir);
    if (isSymlink(awhInfo) || !awhInfo.isDirectory()) issue(blockers, 'AWH data directory is not a regular directory');
    else awhExists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') issue(blockers, 'AWH data directory could not be inspected');
  }
  const awhMarker = awhExists ? await inspectMarker(join(awhDir, MIGRATION_MARKER_FILENAME)) : null;
  if (stagingDirs.length) issue(blockers, 'owned migration staging is incomplete and requires recovery or cleanup');
  if (awhMarker?.kind === MIGRATION_COMPLETE_KIND) {
    return { state: 'MIGRATION_COMPLETE', legacyDir, awhDir, stagingDirs, categories, blockers, fileCount, bytes };
  }
  if (awhMarker?.kind === MIGRATION_STAGING_KIND) {
    issue(blockers, 'AWH contains an owned staging marker and requires recovery or completion');
    return { state: 'MIGRATION_IN_PROGRESS', legacyDir, awhDir, stagingDirs, categories, blockers, fileCount, bytes };
  }
  if (blockers.length && !legacyExists) {
    return { state: 'MIGRATION_INVALID_LEGACY', legacyDir, awhDir, stagingDirs, categories, blockers, fileCount, bytes };
  }
  if (stagingDirs.length) {
    return { state: 'MIGRATION_IN_PROGRESS', legacyDir, awhDir, stagingDirs, categories, blockers, fileCount, bytes };
  }
  if (awhExists && await meaningfulDirectory(awhDir)) {
    issue(blockers, 'AWH data directory already contains data without a valid migration marker');
    return { state: 'MIGRATION_CONFLICT', legacyDir, awhDir, stagingDirs, categories, blockers, fileCount, bytes };
  }
  if (!legacyExists) return { state: 'NO_LEGACY_DATA', legacyDir, awhDir, stagingDirs, categories, blockers, fileCount, bytes };

  try {
    for (const entry of await readdir(legacyDir, { withFileTypes: true })) {
      if (!['settings.json', 'audit.jsonl', 'checkpoints', 'tasks'].includes(entry.name)) issue(blockers, 'legacy data directory contains an unknown entry');
    }
    for (const category of CATEGORY_NAMES) {
      const collected = await collectCategory(legacyDir, category, blockers);
      categories.push(collected.report);
      fileCount += collected.files.length;
      bytes += collected.files.reduce((sum, file) => sum + file.bytes, 0);
    }
  } catch {
    issue(blockers, 'legacy data directory could not be fully inspected');
  }
  const state: DataMigrationState = blockers.length ? 'MIGRATION_INVALID_LEGACY' : 'MIGRATION_AVAILABLE';
  return { state, legacyDir, awhDir, stagingDirs, categories, blockers, fileCount, bytes };
}

async function writeOwnedFile(path: string, content: Buffer | string): Promise<void> {
  await writeFile(path, content, { encoding: typeof content === 'string' ? 'utf8' : undefined, mode: 0o600 });
  if (process.platform !== 'win32') await chmod(path, 0o600);
}

function aggregate(files: FileInfo[]): { fileCount: number; bytes: number; sha256: string } {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) hash.update(file.relativePath).update('\0').update(file.content);
  return { fileCount: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), sha256: hash.digest('hex') };
}

export async function migrateData(options: { legacyDir?: string; awhDir?: string } = {}): Promise<DataMigrationResult> {
  const inspection = await inspectDataMigration(options);
  if (inspection.state !== 'MIGRATION_AVAILABLE') return { ...inspection, changed: false };
  const migrationId = randomUUID();
  const base = basename(inspection.awhDir) || 'awh';
  const stagingDir = join(dirname(inspection.awhDir), `${base.startsWith('.') ? base : `.${base}`}-migration-${migrationId}`);
  const marker: MigrationMarker = { schemaVersion: MIGRATION_SCHEMA_VERSION, kind: MIGRATION_STAGING_KIND, source: '.art-agent', target: '.awh', migrationId };
  const allFiles: FileInfo[] = [];
  try {
    await mkdir(stagingDir, { recursive: false, mode: 0o700 });
    if (process.platform !== 'win32') await chmod(stagingDir, 0o700);
    await writeOwnedFile(join(stagingDir, MIGRATION_MARKER_FILENAME), JSON.stringify(marker));
    for (const category of inspection.categories.filter((item) => item.exists).map((item) => item.id)) {
      const stageBlockers: string[] = [];
      const collected = await collectCategory(inspection.legacyDir, category, stageBlockers);
      if (stageBlockers.length || !collected.report.valid) throw new Error('legacy data changed or failed validation during staging');
      allFiles.push(...collected.files);
      for (const file of collected.files) {
        const target = join(stagingDir, file.relativePath);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await writeOwnedFile(target, file.content);
      }
    }
    await rename(stagingDir, inspection.awhDir);
    const auditPath = join(inspection.awhDir, 'audit.jsonl');
    const auditEntry = `${JSON.stringify({ ts: new Date().toISOString(), tool: 'data_migration', outcome: 'allowed', detail: 'legacy .art-agent copied to AWH; source retained' })}\n`;
    await writeFile(auditPath, auditEntry, { flag: 'a', encoding: 'utf8', mode: 0o600 });
    if (process.platform !== 'win32') await chmod(auditPath, 0o600);
    const completeMarker: MigrationMarker = { ...marker, kind: MIGRATION_COMPLETE_KIND, completedAt: new Date().toISOString(), categories: inspection.categories.filter((item) => item.exists).map((item) => item.id), integrity: aggregate(allFiles) };
    await writeOwnedFile(join(inspection.awhDir, MIGRATION_MARKER_FILENAME), JSON.stringify(completeMarker));
    const finalInspection = await inspectDataMigration({ legacyDir: inspection.legacyDir, awhDir: inspection.awhDir });
    return { ...finalInspection, changed: true, marker: completeMarker as unknown as Record<string, unknown> };
  } catch (error) {
    return { ...inspection, state: 'MIGRATION_FAILED', changed: false, blockers: [...inspection.blockers, 'migration failed before atomic promotion'] };
  }
}

/** Remove only a staging directory carrying the engine's own valid staging marker. */
export async function cleanupOwnedMigrationStaging(stagingDir: string): Promise<boolean> {
  const marker = await inspectMarker(join(resolve(stagingDir), MIGRATION_MARKER_FILENAME));
  if (!marker || marker.kind !== MIGRATION_STAGING_KIND) return false;
  await rm(resolve(stagingDir), { recursive: true, force: false });
  return true;
}
