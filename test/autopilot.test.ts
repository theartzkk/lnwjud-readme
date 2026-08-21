import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createTaskContract, detectLocalCapabilities, probeLocalCapability, selectAutopilotProfile, AutopilotRunner } from '../src/autopilot.js';
import { discoverContinuity } from '../src/continuity.js';
import { initializeProject, initializeProjectMemory, registerProject } from '../src/project-registry.js';
import { createArtifact, listArtifacts } from '../src/artifacts.js';
import { readFile as readSourceFile } from 'node:fs/promises';

const projectId = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
const deviceId = '223b45c0-23e1-408d-ae0f-ac5eca7f6900';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'awh-autopilot-'));
  const workspace = join(root, 'project');
  const dataDir = join(root, 'data');
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, 'package.json'), JSON.stringify({ name: 'fixture', private: true, scripts: {
    test: 'node -e "process.stdout.write(\'fixture test pass\')"',
    typecheck: 'node -e "process.stdout.write(\'fixture typecheck pass\')"',
    build: 'node -e "process.stdout.write(\'fixture build pass\')"',
  } }));
  const manifest = await initializeProject(workspace, { name: 'Portable Fixture', type: 'node' });
  await initializeProjectMemory(workspace);
  await registerProject(dataDir, workspace);
  return { root, workspace, dataDir, manifest };
}

test('Task Contract is bounded, explicit and rejects secret-like goal input', () => {
  const contract = createTaskContract({ projectId, assignedDevice: deviceId, goal: 'Run local QA and produce a review report', acceptanceCriteria: ['tests pass', 'artifact exists'], allowedCapabilities: ['project-memory:read', 'checkpoint:create', 'package:test'], riskClass: 'routine', requiredApproval: false, expectedArtifact: 'qa-report' });
  assert.equal(contract.state, 'QUEUED');
  assert.deepEqual(Object.keys(contract).sort(), ['acceptanceCriteria', 'allowedCapabilities', 'artifactRefs', 'assignedDevice', 'createdAt', 'error', 'expectedArtifact', 'goal', 'projectId', 'requiredApproval', 'retryCount', 'riskClass', 'schemaVersion', 'sourceCheckpoint', 'state', 'taskId', 'updatedAt']);
  assert.throws(() => createTaskContract({ projectId, assignedDevice: deviceId, goal: 'run token=secret', acceptanceCriteria: ['pass'], allowedCapabilities: ['package:test'], riskClass: 'routine', requiredApproval: false, expectedArtifact: null }), /invalid/i);
  assert.throws(() => createTaskContract({ projectId, assignedDevice: deviceId, goal: 'production task', acceptanceCriteria: ['pass'], allowedCapabilities: ['package:test'], riskClass: 'production', requiredApproval: false, expectedArtifact: null }), /approval/i);
});

test('profiles are reusable and capability detection is metadata-only', async () => {
  const f = await fixture();
  try {
    const profile = selectAutopilotProfile(f.manifest, { primary: 'php', ecosystems: ['php'], manifests: ['composer.json'], packageManager: null, approvedScripts: [], warnings: [] });
    assert.equal(profile.id, 'bay-excuse-x-php');
    const capabilities = await detectLocalCapabilities(f.workspace);
    assert.equal(typeof capabilities.node, 'boolean');
    assert.equal(JSON.stringify(capabilities).includes(f.workspace), false);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('FFmpeg capability probe uses the fixed bounded version argv when available', async () => {
  const result = await probeLocalCapability(process.cwd(), 'ffmpeg:probe');
  if (!result.available) return;
  assert.equal(result.code, 0, result.summary);
  assert.match(result.summary, /passed/i);
});

test('real local dogfood completes goal → context → checkpoint → gates → artifact → continuity', async () => {
  const f = await fixture();
  try {
    const runner = new AutopilotRunner({ dataDir: f.dataDir, workspace: f.workspace, manifest: f.manifest, deviceId, maxReadBytes: 512 * 1024, allowExec: true, allowWrite: true });
    const result = await runner.runNow({ goal: 'Validate the fixture project locally and produce a bounded QA artifact', acceptanceCriteria: ['approved gates pass', 'artifact is ready', 'continuity checkpoint is discoverable'] });
    assert.equal(result.contextLoaded, true);
    assert.equal(result.contract.state, 'COMPLETED');
    assert.ok(result.checkpoint?.id);
    assert.ok(result.gates.some((gate) => gate.id === 'test' && gate.status === 'PASS'));
    assert.ok(result.artifact?.relativeRef.startsWith('artifacts/'));
    assert.equal(result.continuity?.projectId, f.manifest.projectId);
    assert.equal(result.continuity?.taskState, 'COMPLETED');
    const artifacts = await listArtifacts(f.dataDir);
    assert.equal(artifacts.length, 1);
    assert.equal((await readFile(join(f.dataDir, result.artifact!.relativeRef), 'utf8')).includes(f.workspace), false);

    const secondDeviceData = join(f.root, 'second-device-data');
    await mkdir(join(secondDeviceData, 'continuity'), { recursive: true });
    const continuityFiles = (await readdir(join(f.dataDir, 'continuity'))).filter((name) => name.endsWith('.json'));
    await copyFile(join(f.dataDir, 'continuity', continuityFiles[0]!), join(secondDeviceData, 'continuity', continuityFiles[0]!));
    const discovered = await discoverContinuity(secondDeviceData, f.manifest.projectId, false);
    assert.equal(discovered.available, true);
    assert.equal(discovered.checkpoint?.taskId, result.contract.taskId);
    assert.equal(discovered.protectedLocalChanges, false);
    const reviewRunner = new AutopilotRunner({ dataDir: f.dataDir, workspace: f.workspace, manifest: f.manifest, deviceId, maxReadBytes: 512 * 1024, allowExec: false, allowWrite: true });
    const memoryUpdate = await reviewRunner.checkpointMemory(result.contract.taskId);
    assert.equal(memoryUpdate.changed, true);
    assert.match(await readFile(join(f.workspace, 'HANDOFF.md'), 'utf8'), /AWH-AUTOPILOT-CHECKPOINT/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('autopilot fails closed when approved execution is disabled', async () => {
  const f = await fixture();
  try {
    const runner = new AutopilotRunner({ dataDir: f.dataDir, workspace: f.workspace, manifest: f.manifest, deviceId, maxReadBytes: 512 * 1024, allowExec: false, allowWrite: false });
    const task = await runner.start({ goal: 'run safe QA', acceptanceCriteria: ['report'], approvalGranted: false });
    assert.equal(task.state, 'FAILED');
    assert.match(task.error ?? '', /disabled/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('runNow also fails closed when approved execution is disabled', async () => {
  const f = await fixture();
  try {
    const runner = new AutopilotRunner({ dataDir: f.dataDir, workspace: f.workspace, manifest: f.manifest, deviceId, maxReadBytes: 512 * 1024, allowExec: false, allowWrite: false });
    const result = await runner.runNow({ goal: 'inspect without execution', acceptanceCriteria: ['execution remains blocked'] });
    assert.equal(result.contract.state, 'FAILED');
    assert.match(result.contract.error ?? '', /disabled/i);
    assert.equal(result.contextLoaded, false);
    assert.equal(result.artifact, null);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('failed safe gates retry once and retain the retry state in the Task Contract', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.workspace, 'package.json'), JSON.stringify({ name: 'retry-fixture', private: true, scripts: {
      test: "node -e \"const fs=require('fs');const p='.awh-retry-marker';if(!fs.existsSync(p)){fs.writeFileSync(p,'1');process.exit(1)}\"",
      typecheck: 'node -e "process.exit(0)"',
      build: 'node -e "process.exit(0)"',
    } }));
    const runner = new AutopilotRunner({ dataDir: f.dataDir, workspace: f.workspace, manifest: f.manifest, deviceId, maxReadBytes: 512 * 1024, allowExec: true, allowWrite: false });
    const result = await runner.runNow({ goal: 'retry one safe local QA gate', acceptanceCriteria: ['test eventually passes'], });
    assert.equal(result.contract.state, 'COMPLETED');
    assert.equal(result.contract.retryCount, 1);
    assert.equal(result.gates.find((gate) => gate.id === 'test')?.attempts, 2);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('artifact metadata and payload never accept absolute paths or credential-like values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-artifact-'));
  try {
    await assert.rejects(() => createArtifact(root, { taskId: 'task-1', projectId, kind: 'qa-report', label: 'QA', status: 'READY', relativeRef: '/tmp/secret.json', bytes: 1 }), /portable/i);
    await assert.rejects(() => createArtifact(root, { taskId: 'task-1', projectId, kind: 'qa-report', label: 'QA', status: 'READY', relativeRef: 'artifacts/payload.json', bytes: 1, payload: { token: 'token=secret' } }), /unsafe/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('autopilot execution boundary is fixed and does not inherit credential-like environment variables', async () => {
  const source = await readSourceFile(new URL('../src/autopilot.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /spawn\(|shell\s*:\s*true|process\.env\.[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY|CREDENTIAL)/i);
  assert.match(source, /safeExecutionEnvironment/);
  assert.match(source, /AWH_ALLOW_EXEC: '0'/);
});
