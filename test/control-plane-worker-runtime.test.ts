import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ControlPlaneWorkerClient, type WorkerProject, type WorkerTask } from '../src/control-plane-worker-client.js';
import { buildCodexTaskInstruction, ControlPlaneWorkerRuntime, officeExecutionCapabilities } from '../src/control-plane-worker-runtime.js';
import { loadOrCreateDeviceIdentity } from '../src/device-identity.js';
import { execCommand } from '../src/process.js';
import type { CredentialStore } from '../src/credential-store.js';

class MemoryCredentials implements CredentialStore {
  async get(): Promise<string | null> { return null; }
  async set(): Promise<void> {}
  async delete(): Promise<void> {}
}

class FixtureWorkerClient extends ControlPlaneWorkerClient {
  heartbeatCalls = 0;
  updates: Array<{ taskId: string; state: string }> = [];
  constructor(dataDir: string, private readonly nextTask: WorkerTask | null) {
    super('https://hub.example/api/v1', dataDir, new MemoryCredentials(), async () => new Response('{}', { status: 200 }));
  }
  override async heartbeat(): Promise<{ deviceId: string; state: string; lastSeenAt: string }> {
    this.heartbeatCalls += 1;
    return { deviceId: '423b45c0-23e1-408d-ae0f-ac5eca7f6900', state: 'READY', lastSeenAt: '2026-08-21T00:00:00.000Z' };
  }
  override async claim(): Promise<WorkerTask | null> { return this.nextTask; }
  override async update(taskId: string, state: string): Promise<WorkerTask> {
    this.updates.push({ taskId, state });
    return this.nextTask ?? { taskId, projectId: '423b45c0-23e1-408d-ae0f-ac5eca7f6900', conversationId: null, goal: 'fixture', state, progress: 0, assignedDevice: null, approvalStatus: null };
  }
}

test('Office inventory becomes executable only for the matching Windows handler', () => {
  assert.deepEqual(officeExecutionCapabilities('darwin', ['tool.office.word', 'tool.office.excel']), []);
  assert.deepEqual(officeExecutionCapabilities('win32', ['tool.office.word']), ['office.word.pdf']);
  assert.deepEqual(officeExecutionCapabilities('win32', ['tool.office.excel', 'tool.office.powerpoint']).sort(), ['office.excel.pdf', 'office.powerpoint.pdf']);
  assert.deepEqual(officeExecutionCapabilities('win32', ['tool.office.word', 'tool.browser.edge']), ['office.word.pdf']);
});

test('desktop worker runtime is wired to heartbeat and truthful idle state', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'awh-worker-runtime-'));
  try {
    const identity = await loadOrCreateDeviceIdentity(dataDir);
    const client = new FixtureWorkerClient(dataDir, null);
    const runtime = new ControlPlaneWorkerRuntime(client, { dataDir, maxReadBytes: 32_000, allowExec: false, allowWrite: false, allowCodex: false });
    const result = await runtime.runOnce();
    assert.deepEqual(result, { status: 'IDLE', deviceId: identity.deviceId });
    assert.equal(client.heartbeatCalls, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('desktop worker runtime rejects an unregistered project before execution', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'awh-worker-runtime-'));
  try {
    await loadOrCreateDeviceIdentity(dataDir);
    const task: WorkerTask = { taskId: '423b45c0-23e1-408d-ae0f-ac5eca7f6900', projectId: '523b45c0-23e1-408d-ae0f-ac5eca7f6900', conversationId: null, goal: 'safe inspection', state: 'PREPARING', progress: 0, assignedDevice: '423b45c0-23e1-408d-ae0f-ac5eca7f6900', approvalStatus: null };
    const client = new FixtureWorkerClient(dataDir, task);
    const runtime = new ControlPlaneWorkerRuntime(client, { dataDir, maxReadBytes: 32_000, allowExec: true, allowWrite: false, allowCodex: false });
    const result = await runtime.runOnce();
    assert.equal(result.status, 'FAILED');
    assert.equal(result.reason, 'PROJECT_CONTEXT_REJECTED');
    assert.deepEqual(client.updates, [{ taskId: task.taskId, state: 'FAILED' }]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('Codex task instruction preserves owner protocol precedence before project memory and Goal', () => {
  const protocol = '# Art ↔ AI Working Constitution\n\nVersion: 1.0\n\nSystem-first, patch-second.';
  const goal = 'แก้ตารางรายงานโดยวิเคราะห์ระบบร่วมทั้งหมดก่อน';
  const instruction = buildCodexTaskInstruction(protocol, goal);
  const ownerIndex = instruction.indexOf('Art ↔ AI Working Constitution');
  const memoryIndex = instruction.indexOf('PROJECT CONTEXT CONTRACT');
  const goalIndex = instruction.indexOf('CURRENT OWNER GOAL');
  assert.ok(ownerIndex >= 0);
  assert.ok(memoryIndex > ownerIndex);
  assert.ok(goalIndex > memoryIndex);
  assert.match(instruction, /PROJECT\.md, HANDOFF\.md, TASKS\.md, ARCHITECTURE\.md, DECISIONS\.md/);
  assert.match(instruction, /system-first and root-cause-first/i);
  assert.match(instruction, /Do not create a parallel system/i);
  assert.match(instruction, new RegExp(goal));
});

class RecoveryWorkerClient extends FixtureWorkerClient {
  readonly canonical: WorkerProject = { projectId: '723b45c0-23e1-408d-ae0f-ac5eca7f6900', name: 'BAY EXCUSE X', type: 'school-system', sourceRevision: null, vaultReady: false };
  registered: Array<{ projectId: string; name: string; type: string; sourceRevision: string | null }> = [];
  bindings: Array<{ projectId: string; label: string; fingerprint: string | null }> = [];
  archiveEntries: string[] = [];
  memoryFiles: Array<{ name: string; status: 'present' | 'missing'; sha256: string | null; sizeBytes: number }> = [];
  override async projects(): Promise<WorkerProject[]> { return [this.canonical]; }
  override async registerProject(project: { projectId: string; name: string; type: string; sourceRevision: string | null }): Promise<void> { this.registered.push(project); }
  override async registerProjectBinding(projectId: string, label: string, _capabilities: string[], fingerprint: string | null): Promise<void> { this.bindings.push({ projectId, label, fingerprint }); }
  override async uploadProjectSource(_projectId: string, _sourceRevision: string, archive: string): Promise<Record<string, unknown>> { const list = await execCommand('unzip', ['-Z1', archive], process.cwd(), 30_000); assert.equal(list.code, 0); this.archiveEntries = list.stdout.split(/\r?\n/).filter(Boolean); return { schemaVersion: 1 }; }
  override async publishProjectMemory(_projectId: string, files: Array<{ name: string; status: 'present' | 'missing'; sha256: string | null; sizeBytes: number }>): Promise<void> { this.memoryFiles = files; }
}

test('worker self-heals a canonical empty Vault from one uniquely named local project without uploading WIP', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'awh-worker-recovery-'));
  const workspace = await mkdtemp(join(tmpdir(), 'awh-bay-workspace-'));
  try {
    await mkdir(join(workspace, '.awh'), { recursive: true });
    const localProjectId = '823b45c0-23e1-408d-ae0f-ac5eca7f6900';
    await writeFile(join(workspace, '.awh', 'project.json'), JSON.stringify({ schemaVersion: 1, projectId: localProjectId, name: 'BAY EXCUSE X', type: 'php', createdAt: '2026-08-21T00:00:00.000Z' }));
    for (const name of ['PROJECT.md', 'HANDOFF.md', 'TASKS.md', 'ARCHITECTURE.md', 'DECISIONS.md']) await writeFile(join(workspace, name), `# ${name}\ncanonical metadata fixture\n`);
    await writeFile(join(workspace, 'tracked.txt'), 'committed source\n');
    for (const args of [['init'], ['config', 'user.email', 'awh-test@example.invalid'], ['config', 'user.name', 'AWH Test'], ['add', 'tracked.txt'], ['commit', '-m', 'fixture source']]) { const result = await execCommand('git', args, workspace, 30_000); assert.equal(result.code, 0, `${args.join(' ')}: ${result.stderr}`); }
    await writeFile(join(workspace, 'wip.txt'), 'must remain local and outside source archive\n');
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [{ projectId: localProjectId, workspacePath: workspace, lastOpenedAt: '2026-08-31T00:00:00.000Z', lastUsedAt: '2026-08-31T00:00:00.000Z', pinned: false, available: true }] }));
    const client = new RecoveryWorkerClient(dataDir, null);
    const runtime = new ControlPlaneWorkerRuntime(client, { dataDir, maxReadBytes: 32_000, allowExec: false, allowWrite: false, allowCodex: false });
    const result = await runtime.runOnce();
    assert.equal(result.status, 'IDLE');
    assert.equal(client.registered.length, 1);
    assert.equal(client.registered[0]?.projectId, client.canonical.projectId);
    assert.match(client.registered[0]?.sourceRevision ?? '', /^[0-9a-f]{40}$/);
    assert.equal(client.bindings[0]?.projectId, client.canonical.projectId);
    assert.equal(client.bindings[0]?.fingerprint, client.registered[0]?.sourceRevision);
    assert.ok(client.archiveEntries.includes('tracked.txt'));
    assert.equal(client.archiveEntries.includes('wip.txt'), false);
    assert.equal(client.archiveEntries.some((name) => name.startsWith('.git/')), false);
    assert.deepEqual(client.memoryFiles.map((file) => file.name).sort(), ['ARCHITECTURE.md', 'DECISIONS.md', 'HANDOFF.md', 'PROJECT.md', 'TASKS.md']);
    assert.equal(await readFile(join(workspace, 'wip.txt'), 'utf8'), 'must remain local and outside source archive\n');
  } finally { await rm(dataDir, { recursive: true, force: true }); await rm(workspace, { recursive: true, force: true }); }
});
