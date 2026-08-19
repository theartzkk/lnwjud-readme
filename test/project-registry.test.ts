import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildProjectContext,
  initializeProject,
  initializeProjectMemory,
  listProjects,
  openRegisteredProject,
  projectMemoryStatus,
  ProjectRegistryError,
  PROJECT_MANIFEST_PATH,
  PROJECT_MEMORY_FILES,
  readProjectManifest,
  registerProject,
  resolveRegisteredProject,
} from '../src/project-registry.js';

async function fixture(): Promise<{ root: string; dataDir: string; project: string }> {
  const root = await mkdtemp(join(tmpdir(), 'awh-registry-'));
  const dataDir = join(root, 'data');
  const project = join(root, 'project');
  await mkdir(project, { recursive: true });
  return { root, dataDir, project };
}

test('empty registry and explicit registration require an initialized workspace', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await listProjects(f.dataDir), []);
    await assert.rejects(() => registerProject(f.dataDir, f.project), (error: unknown) => error instanceof ProjectRegistryError && error.code === 'PROJECT_NOT_INITIALIZED');
    assert.equal(await readFile(join(f.project, PROJECT_MANIFEST_PATH)).catch(() => null), null);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('initializes UUID identity once and reuses it after a cross-device path copy', async () => {
  const f = await fixture();
  const other = join(f.root, 'school-pc', 'BAY-EXCUSE-X');
  try {
    const first = await initializeProject(f.project, { name: 'BAY School Project', type: 'creative' });
    const second = await initializeProject(f.project);
    assert.equal(first.projectId, second.projectId);
    assert.equal(first.name, 'BAY School Project');
    assert.equal(first.type, 'creative');
    assert.match(first.projectId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.doesNotMatch(JSON.stringify(first), /\/|\\/);
    await mkdir(join(other, '.awh'), { recursive: true });
    await writeFile(join(other, PROJECT_MANIFEST_PATH), await readFile(join(f.project, PROJECT_MANIFEST_PATH)));
    const copied = await readProjectManifest(other);
    assert.equal(copied.projectId, first.projectId);
    assert.equal(copied.name, first.name);
    assert.equal(copied.type, first.type);
    assert.notEqual(f.project, other);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('registers duplicate canonical workspaces and uses the resolved local registry data directory', async () => {
  const f = await fixture();
  try {
    await initializeProject(f.project);
    const first = await registerProject(f.dataDir, f.project);
    const second = await registerProject(f.dataDir, f.project);
    assert.equal(first.projectId, second.projectId);
    assert.equal((await listProjects(f.dataDir)).length, 1);
    assert.equal((await stat(join(f.dataDir, 'projects.json'))).mode & 0o777, process.platform === 'win32' ? (await stat(join(f.dataDir, 'projects.json'))).mode & 0o777 : 0o600);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('handles moved projects safely and rejects an id already mapped to an available path', async () => {
  const f = await fixture();
  const moved = join(f.root, 'moved');
  const second = join(f.root, 'second');
  try {
    const manifest = await initializeProject(f.project);
    await registerProject(f.dataDir, f.project);
    await rm(f.project, { recursive: true, force: true });
    await mkdir(join(moved, '.awh'), { recursive: true });
    await writeFile(join(moved, PROJECT_MANIFEST_PATH), JSON.stringify(manifest));
    assert.equal((await registerProject(f.dataDir, moved)).workspacePath, await realpath(moved));
    await mkdir(join(second, '.awh'), { recursive: true });
    await writeFile(join(second, PROJECT_MANIFEST_PATH), JSON.stringify(manifest));
    await assert.rejects(() => registerProject(f.dataDir, second), (error: unknown) => error instanceof ProjectRegistryError && error.code === 'PROJECT_ID_CONFLICT');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('rejects malformed, secret-looking, absolute-path, and symlink manifests', async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.project, '.awh'), { recursive: true });
    await writeFile(join(f.project, PROJECT_MANIFEST_PATH), JSON.stringify({ schemaVersion: 1, projectId: 'bad', name: 'Bad', type: 'general', createdAt: new Date().toISOString(), workspacePath: '/secret' }));
    await assert.rejects(() => readProjectManifest(f.project), ProjectRegistryError);
    await writeFile(join(f.project, PROJECT_MANIFEST_PATH), JSON.stringify({ schemaVersion: 1, projectId: '00000000-0000-4000-8000-000000000000', name: 'Bad', type: 'general', createdAt: new Date().toISOString(), apiToken: 'secret' }));
    await assert.rejects(() => readProjectManifest(f.project), ProjectRegistryError);
    await writeFile(join(f.project, PROJECT_MANIFEST_PATH), JSON.stringify({ schemaVersion: 1, projectId: '00000000-0000-4000-8000-000000000000', name: '/absolute/name', type: 'general', createdAt: new Date().toISOString() }));
    await assert.rejects(() => readProjectManifest(f.project), /portable/i);
    await writeFile(join(f.project, PROJECT_MANIFEST_PATH), JSON.stringify({ schemaVersion: 1, projectId: '00000000-0000-4000-8000-000000000000', name: 'Portable', type: 'future-category', createdAt: new Date().toISOString() }));
    assert.equal((await readProjectManifest(f.project)).type, 'future-category');
    await writeFile(join(f.project, PROJECT_MANIFEST_PATH), JSON.stringify({ schemaVersion: 1, projectId: '00000000-0000-4000-8000-000000000000', name: 'Portable', type: 'https://type', createdAt: new Date().toISOString() }));
    await assert.rejects(() => readProjectManifest(f.project), /portable/i);
    await rm(join(f.project, PROJECT_MANIFEST_PATH));
    await writeFile(join(f.root, 'outside.json'), '{}');
    await symlink(join(f.root, 'outside.json'), join(f.project, PROJECT_MANIFEST_PATH));
    await assert.rejects(() => initializeProject(f.project), /symlink|escapes the registered workspace/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('initializes only missing portable memory templates and never overwrites existing files', async () => {
  const f = await fixture();
  try {
    await initializeProject(f.project);
    await writeFile(join(f.project, 'PROJECT.md'), 'Existing project truth');
    const created = await initializeProjectMemory(f.project);
    assert.deepEqual(created, PROJECT_MEMORY_FILES.filter((file) => file !== 'PROJECT.md'));
    assert.equal(await readFile(join(f.project, 'PROJECT.md'), 'utf8'), 'Existing project truth');
    assert.deepEqual(await initializeProjectMemory(f.project), []);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('builds bounded context in deterministic project-memory read order', async () => {
  const f = await fixture();
  try {
    await initializeProject(f.project);
    await writeFile(join(f.project, 'PROJECT.md'), 'project truth');
    await writeFile(join(f.project, 'HANDOFF.md'), 'handoff truth');
    await writeFile(join(f.project, 'TASKS.md'), 'task truth');
    await writeFile(join(f.project, 'ARCHITECTURE.md'), 'architecture truth');
    await writeFile(join(f.project, 'DECISIONS.md'), 'decision truth');
    const context = await buildProjectContext(f.project);
    assert.equal(context.project.name, 'project');
    assert.equal(context.project.type, 'general');
    assert.deepEqual(Object.keys(context.memory), [...PROJECT_MEMORY_FILES]);
    assert.deepEqual(Object.values(context.memory), ['project truth', 'handoff truth', 'task truth', 'architecture truth', 'decision truth']);
    await writeFile(join(f.project, 'PROJECT.md'), 'x'.repeat(32 * 1024 + 1));
    await assert.rejects(() => buildProjectContext(f.project), /read limit/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('reports memory presence without overwriting and selection revalidates portable identity', async () => {
  const f = await fixture();
  try {
    const manifest = await initializeProject(f.project, { name: 'Portable AWH', type: 'node' });
    await registerProject(f.dataDir, f.project);
    const before = await projectMemoryStatus(f.project);
    assert.equal(before['HANDOFF.md'], 'missing');
    await initializeProjectMemory(f.project);
    const after = await projectMemoryStatus(f.project);
    assert.equal(after['HANDOFF.md'], 'present');
    const opened = await openRegisteredProject(f.dataDir, manifest.projectId);
    assert.equal(opened.projectId, manifest.projectId);
    assert.equal((await resolveRegisteredProject(f.dataDir, manifest.projectId)).manifest.name, 'Portable AWH');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('fails closed when one portable project id is available at two local paths', async () => {
  const f = await fixture();
  const second = join(f.root, 'second');
  try {
    const manifest = await initializeProject(f.project);
    await mkdir(join(second, '.awh'), { recursive: true });
    await writeFile(join(second, PROJECT_MANIFEST_PATH), JSON.stringify(manifest));
    const now = new Date().toISOString();
    await mkdir(f.dataDir, { recursive: true });
    await writeFile(join(f.dataDir, 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [
      { projectId: manifest.projectId, workspacePath: await realpath(f.project), lastOpenedAt: now, lastUsedAt: now, pinned: false, available: true },
      { projectId: manifest.projectId, workspacePath: await realpath(second), lastOpenedAt: now, lastUsedAt: now, pinned: false, available: true },
    ] }));
    await assert.rejects(() => resolveRegisteredProject(f.dataDir, manifest.projectId), (error: unknown) => error instanceof ProjectRegistryError && error.code === 'PROJECT_ID_CONFLICT');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('enforces the workspace boundary and tests use temporary fixtures only', async () => {
  const f = await fixture();
  try {
    await initializeProject(f.project);
    await assert.rejects(() => readProjectManifest(join(f.root, '..')), /Workspace|ENOENT|invalid|initialized/i);
    assert.match(f.root, /awh-registry-/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
