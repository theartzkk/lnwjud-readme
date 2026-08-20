import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AuditLog } from './audit.js';
import { createArtifact, listArtifacts, type ArtifactKind, type ArtifactRecord } from './artifacts.js';
import { createCheckpoint, restoreCheckpoint, type CheckpointSummary } from './changes.js';
import { readTextFile, writeTextFile } from './files.js';
import { buildProjectContext, PROJECT_MEMORY_FILES, projectMemoryStatus, resolveRegisteredProject, type ProjectManifest } from './project-registry.js';
import { listWorkspace } from './files.js';
import { detectProject } from './project.js';
import { execCommand, execFile, resolveExecutable, runPackageScript, type PackageCommand } from './process.js';
import { createContinuityCheckpoint, discoverContinuity, type ContinuityCheckpoint, type ContinuityDiscovery } from './continuity.js';
import { canonicalWorkspace, resolveForRead } from './security.js';
import { runDisposableVideoPipelineProbe, VideoPipelineError } from './video.js';

export const AUTOPILOT_SCHEMA_VERSION = 1 as const;
export const AUTOPILOT_STATES = ['QUEUED', 'PLANNING', 'WORKING', 'TESTING', 'RETRYING', 'READY_FOR_REVIEW', 'WAITING_APPROVAL', 'COMPLETED', 'FAILED', 'INTERRUPTED'] as const;
export type AutopilotState = (typeof AUTOPILOT_STATES)[number];
export type RiskClass = 'routine' | 'source-mutation' | 'production' | 'destructive' | 'credential';
export type Capability = 'project-memory:read' | 'checkpoint:create' | 'git:read' | 'package:test' | 'package:lint' | 'package:typecheck' | 'package:build' | 'php:lint' | 'ffmpeg:probe' | 'artifact:write';
export type AutopilotProfileId = 'bay-excuse-x-php' | 'teacher-video-remotion' | 'school-website' | 'general-node';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_ID = /^[A-Za-z0-9._-]{1,120}$/;
const SAFE_CAPABILITIES = new Set<Capability>(['project-memory:read', 'checkpoint:create', 'git:read', 'package:test', 'package:lint', 'package:typecheck', 'package:build', 'php:lint', 'ffmpeg:probe', 'artifact:write']);
const SECRET_TEXT = /(?:bearer\s+|password\s*[=:]|secret\s*[=:]|token\s*[=:]|api[_-]?key\s*[=:]|-----begin\s+(?:private|open)[^-]*key)/i;
const MAX_TASK_BYTES = 64 * 1024;

export interface TaskContract {
  schemaVersion: 1;
  taskId: string;
  projectId: string;
  goal: string;
  acceptanceCriteria: string[];
  allowedCapabilities: Capability[];
  riskClass: RiskClass;
  requiredApproval: boolean;
  expectedArtifact: ArtifactKind | null;
  sourceCheckpoint: string | null;
  assignedDevice: string;
  state: AutopilotState;
  createdAt: string;
  updatedAt: string;
  artifactRefs: string[];
  retryCount: number;
  error: string | null;
}

export interface AutopilotProfile {
  id: AutopilotProfileId;
  label: string;
  capabilities: Capability[];
  packageCommands: PackageCommand[];
  additionalGates: Capability[];
  defaultArtifact: ArtifactKind;
  description: string;
}

export interface LocalCapabilities {
  git: boolean;
  node: boolean;
  php: boolean;
  ffmpeg: boolean;
  remotion: boolean;
  browsers: string[];
}

export interface GateResult { id: string; status: 'PASS' | 'FAIL' | 'SKIP'; attempts: number; summary: string; }
export interface AutopilotRunResult { contract: TaskContract; profile: AutopilotProfile; contextLoaded: boolean; checkpoint: CheckpointSummary | null; gates: GateResult[]; artifact: ArtifactRecord | null; continuity: ContinuityCheckpoint | null; }

function boundedText(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value) || SECRET_TEXT.test(value)) throw new Error(`${field} is invalid`);
  return value.trim();
}

function boundedCriteria(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) throw new Error('Acceptance criteria are invalid');
  return value.map((item) => boundedText(item, 240, 'Acceptance criterion'));
}

function validateTaskContract(value: unknown): TaskContract {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Task Contract is invalid');
  const record = value as Record<string, unknown>;
  const expected = 'acceptanceCriteria,allowedCapabilities,artifactRefs,assignedDevice,createdAt,error,expectedArtifact,goal,projectId,requiredApproval,retryCount,riskClass,schemaVersion,sourceCheckpoint,state,taskId,updatedAt';
  if (Object.keys(record).sort().join(',') !== expected) throw new Error('Task Contract contains unsupported fields');
  if (record.schemaVersion !== 1 || typeof record.taskId !== 'string' || !TASK_ID.test(record.taskId) || typeof record.projectId !== 'string' || !UUID_V4.test(record.projectId) || typeof record.assignedDevice !== 'string' || !UUID_V4.test(record.assignedDevice)) throw new Error('Task Contract identity is invalid');
  const goal = boundedText(record.goal, 2_000, 'Task goal');
  const acceptanceCriteria = boundedCriteria(record.acceptanceCriteria);
  if (!Array.isArray(record.allowedCapabilities) || record.allowedCapabilities.length > 12 || record.allowedCapabilities.some((item) => typeof item !== 'string' || !SAFE_CAPABILITIES.has(item as Capability))) throw new Error('Task capabilities are invalid');
  if (!['routine', 'source-mutation', 'production', 'destructive', 'credential'].includes(record.riskClass as string)) throw new Error('Task risk class is invalid');
  const highRisk = record.riskClass !== 'routine';
  if (typeof record.requiredApproval !== 'boolean' || highRisk && record.requiredApproval !== true) throw new Error('Task approval gate is invalid');
  if (record.expectedArtifact !== null && (typeof record.expectedArtifact !== 'string' || !['qa-report', 'zip', 'release-candidate', 'patch', 'video-preview', 'video-final', 'pdf', 'screenshot', 'staging-url', 'rollback-package'].includes(record.expectedArtifact))) throw new Error('Expected artifact is invalid');
  if (record.sourceCheckpoint !== null && (typeof record.sourceCheckpoint !== 'string' || !TASK_ID.test(record.sourceCheckpoint))) throw new Error('Source checkpoint is invalid');
  if (typeof record.state !== 'string' || !(AUTOPILOT_STATES as readonly string[]).includes(record.state) || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt)) || typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt)) || !Array.isArray(record.artifactRefs) || record.artifactRefs.length > 20 || record.artifactRefs.some((ref) => typeof ref !== 'string' || ref.length > 240 || ref.startsWith('/') || ref.includes('..')) || typeof record.retryCount !== 'number' || !Number.isInteger(record.retryCount) || record.retryCount < 0 || record.retryCount > 2 || (record.error !== null && typeof record.error !== 'string')) throw new Error('Task Contract lifecycle fields are invalid');
  return { ...record, goal, acceptanceCriteria } as TaskContract;
}

function stateUpdate(contract: TaskContract, state: AutopilotState, patch: Partial<TaskContract> = {}): TaskContract {
  return validateTaskContract({ ...contract, ...patch, state, updatedAt: new Date().toISOString() });
}

export function createTaskContract(input: { projectId: string; goal: string; acceptanceCriteria: string[]; allowedCapabilities: Capability[]; riskClass: RiskClass; requiredApproval: boolean; expectedArtifact: ArtifactKind | null; assignedDevice: string }): TaskContract {
  const now = new Date().toISOString();
  return validateTaskContract({ schemaVersion: 1, taskId: randomUUID(), projectId: input.projectId, goal: input.goal, acceptanceCriteria: input.acceptanceCriteria, allowedCapabilities: [...new Set(input.allowedCapabilities)], riskClass: input.riskClass, requiredApproval: input.requiredApproval, expectedArtifact: input.expectedArtifact, sourceCheckpoint: null, assignedDevice: input.assignedDevice, state: 'QUEUED', createdAt: now, updatedAt: now, artifactRefs: [], retryCount: 0, error: null });
}

export const AUTOPILOT_PROFILES: Record<AutopilotProfileId, AutopilotProfile> = {
  'bay-excuse-x-php': { id: 'bay-excuse-x-php', label: 'BAY EXCUSE X PHP/Web', capabilities: ['project-memory:read', 'checkpoint:create', 'git:read', 'php:lint', 'artifact:write'], packageCommands: ['test', 'lint'], additionalGates: ['php:lint'], defaultArtifact: 'release-candidate', description: 'Source audit, PHP lint, tests, QA hooks, package and rollback contract.' },
  'teacher-video-remotion': { id: 'teacher-video-remotion', label: 'Teacher Video / Remotion', capabilities: ['project-memory:read', 'checkpoint:create', 'git:read', 'package:test', 'package:build', 'ffmpeg:probe', 'artifact:write'], packageCommands: ['test', 'build'], additionalGates: ['ffmpeg:probe'], defaultArtifact: 'video-preview', description: 'Asset audit, timeline, preview render, frame extraction and final render contract.' },
  'school-website': { id: 'school-website', label: 'School Website', capabilities: ['project-memory:read', 'checkpoint:create', 'git:read', 'package:test', 'package:build', 'artifact:write'], packageCommands: ['test', 'build'], additionalGates: [], defaultArtifact: 'release-candidate', description: 'Web assets, mobile/desktop QA, staging preview, publish approval and rollback.' },
  'general-node': { id: 'general-node', label: 'General Node Project', capabilities: ['project-memory:read', 'checkpoint:create', 'git:read', 'package:test', 'package:typecheck', 'package:build', 'artifact:write'], packageCommands: ['test', 'typecheck', 'build'], additionalGates: [], defaultArtifact: 'qa-report', description: 'Bounded local test, typecheck and build loop for a Node project.' },
};

export function selectAutopilotProfile(manifest: ProjectManifest, detected: Awaited<ReturnType<typeof detectProject>>): AutopilotProfile {
  if (manifest.type === 'remotion' || detected.manifests.some((value) => value.toLowerCase().includes('remotion'))) return AUTOPILOT_PROFILES['teacher-video-remotion'];
  if (manifest.type === 'php' || detected.ecosystems.includes('php')) return AUTOPILOT_PROFILES['bay-excuse-x-php'];
  if (manifest.type === 'web') return AUTOPILOT_PROFILES['school-website'];
  return AUTOPILOT_PROFILES['general-node'];
}

export async function detectLocalCapabilities(workspace: string): Promise<LocalCapabilities> {
  const available = async (command: string): Promise<boolean> => { try { await resolveExecutable(command); return true; } catch { return false; } };
  const node = await available('node');
  const ffmpeg = await available('ffmpeg');
  const remotion = ffmpeg && await available('npx').catch(() => false);
  const browsers: string[] = [];
  if (process.platform === 'darwin') for (const candidate of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Safari.app/Contents/MacOS/Safari']) if (await available(candidate).catch(() => false)) browsers.push(candidate.split('/').pop() ?? 'browser');
  return { git: await available('git'), node, php: await available('php'), ffmpeg, remotion, browsers };
}

function redact(value: string, workspace: string, dataDir: string): string {
  return value.replaceAll(workspace, '[workspace]').replaceAll(dataDir, '[data-dir]').replace(/(?:Bearer\s+)[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]').replace(/((?:password|secret|token|api[_-]?key)\s*[=:]\s*)[^\s&]+/gi, '$1[redacted]').replace(/(?:\/Users\/|\/home\/|\/private\/tmp\/|[A-Za-z]:[\\/])[^\s'"`]+/g, '[path]').slice(0, 1_200);
}

function safeExecutionEnvironment(): NodeJS.ProcessEnv {
  const allowed = ['PATH', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'TMP', 'TEMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL'];
  const env: NodeJS.ProcessEnv = { AWH_ALLOW_WRITE: '0', AWH_ALLOW_EXEC: '0', AWH_ALLOW_CODEX: '0' };
  for (const key of allowed) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

async function runFixedCapability(workspace: string, capability: Capability, maxReadBytes: number): Promise<{ available: boolean; code: number; stdout: string; stderr: string; summary: string }> {
  if (capability === 'ffmpeg:probe') {
    try {
      const result = await runDisposableVideoPipelineProbe(workspace);
      return { available: true, code: 0, stdout: '', stderr: '', summary: `FFmpeg/FFprobe frame-sequence E2E passed (${result.frameCount} frames, ${result.fps} FPS, ${result.codec}/${result.pixelFormat})` };
    } catch (error) {
      if (error instanceof VideoPipelineError && error.code === 'TOOL_UNAVAILABLE') return { available: false, code: 0, stdout: '', stderr: '', summary: 'FFmpeg and FFprobe are not both available on this device' };
      const summary = error instanceof VideoPipelineError ? error.message : 'FFmpeg/FFprobe frame-sequence E2E failed';
      return { available: true, code: 1, stdout: '', stderr: '', summary };
    }
  }
  if (capability === 'php:lint') {
    try {
      const php = await resolveExecutable('php');
      const paths = (await listWorkspace(workspace, 6, 300)).filter((path) => path.toLowerCase().endsWith('.php')).slice(0, 100);
      if (paths.length === 0) return { available: true, code: 0, stdout: '', stderr: '', summary: 'No PHP files were found in the bounded workspace scan' };
      for (const path of paths) {
        const target = await resolveForRead(workspace, path);
        const result = await execFile(php, ['-l', target], workspace, 30_000, safeExecutionEnvironment());
        if (result.code !== 0) return { available: true, ...result, summary: `PHP lint failed for ${path}` };
      }
      return { available: true, code: 0, stdout: '', stderr: '', summary: `PHP lint passed for ${paths.length} file(s)` };
    } catch { return { available: false, code: 0, stdout: '', stderr: '', summary: 'PHP is not available on this device' }; }
  }
  return { available: false, code: 0, stdout: '', stderr: '', summary: 'Capability is not available in this profile' };
}

/** Run one fixed local capability probe without returning process output. */
export async function probeLocalCapability(workspace: string, capability: Capability): Promise<{ available: boolean; code: number; summary: string }> {
  const result = await runFixedCapability(workspace, capability, 512 * 1024);
  return { available: result.available, code: result.code, summary: result.summary };
}

interface RunnerOptions { dataDir: string; workspace: string; manifest: ProjectManifest; deviceId: string; maxReadBytes: number; allowExec: boolean; allowWrite: boolean; }

export class AutopilotRunner {
  private readonly records = new Map<string, TaskContract>();
  private readonly audit: AuditLog;
  private running = new Set<string>();

  constructor(private readonly options: RunnerOptions) { this.audit = new AuditLog(options.dataDir); }

  async start(input: { goal: string; acceptanceCriteria: string[]; approvalGranted?: boolean }): Promise<TaskContract> {
    const detected = await detectProject(this.options.workspace);
    const profile = selectAutopilotProfile(this.options.manifest, detected);
    const allowed = profile.capabilities.filter((cap) => cap !== 'artifact:write' || true);
    const contract = createTaskContract({ projectId: this.options.manifest.projectId, goal: input.goal, acceptanceCriteria: input.acceptanceCriteria, allowedCapabilities: allowed, riskClass: 'routine', requiredApproval: false, expectedArtifact: profile.defaultArtifact, assignedDevice: this.options.deviceId });
    this.records.set(contract.taskId, contract);
    await this.persist(contract);
    if (!this.options.allowExec) { const blocked = stateUpdate(contract, 'FAILED', { error: 'Approved local execution is disabled' }); this.records.set(contract.taskId, blocked); await this.persist(blocked); return blocked; }
    void this.execute(contract, profile, detected).catch(async (error) => { const failed = stateUpdate(this.records.get(contract.taskId) ?? contract, 'FAILED', { error: 'Autopilot run failed' }); this.records.set(contract.taskId, failed); await this.persist(failed); await this.audit.write({ tool: 'autopilot', outcome: 'error', detail: `${contract.taskId}: ${error instanceof Error ? error.message : 'run failed'}` }); });
    return contract;
  }

  async runNow(input: { goal: string; acceptanceCriteria: string[]; approvalGranted?: boolean }): Promise<AutopilotRunResult> {
    const detected = await detectProject(this.options.workspace);
    const profile = selectAutopilotProfile(this.options.manifest, detected);
    const contract = createTaskContract({ projectId: this.options.manifest.projectId, goal: input.goal, acceptanceCriteria: input.acceptanceCriteria, allowedCapabilities: profile.capabilities, riskClass: 'routine', requiredApproval: false, expectedArtifact: profile.defaultArtifact, assignedDevice: this.options.deviceId });
    this.records.set(contract.taskId, contract);
    await this.persist(contract);
    return this.execute(contract, profile, detected);
  }

  get(taskId: string): TaskContract { const value = this.records.get(taskId); if (!value) throw new Error('Unknown autopilot task'); return value; }
  list(limit = 20): TaskContract[] { return [...this.records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, Math.max(1, Math.min(limit, 100))); }
  async artifacts(limit = 20): Promise<ArtifactRecord[]> { return listArtifacts(this.options.dataDir, limit); }
  async continuity(): Promise<ContinuityDiscovery> { return discoverContinuity(this.options.dataDir, this.options.manifest.projectId, false); }

  /** Apply only a concise checkpoint marker to canonical memory after explicit review. */
  async checkpointMemory(taskId: string): Promise<{ changed: boolean; checkpoint: CheckpointSummary }> {
    if (!this.options.allowWrite) throw new Error('Workspace writes are disabled');
    const task = this.records.get(taskId) ?? (await loadAutopilotTasks(this.options.dataDir, 100)).find((value) => value.taskId === taskId);
    if (!task) throw new Error('Unknown autopilot task');
    if (task.state !== 'COMPLETED' || task.projectId !== this.options.manifest.projectId) throw new Error('Only a completed task for the selected project can update memory');
    const checkpoint = await createCheckpoint(this.options.dataDir, this.options.workspace, ['HANDOFF.md', 'TASKS.md'], this.options.maxReadBytes);
    const marker = `<!-- AWH-AUTOPILOT-CHECKPOINT:${task.taskId} -->`;
    const block = `${marker}\n- State: ${task.state}\n- Artifact: ${task.artifactRefs[0] ?? 'none'}\n- Updated: ${new Date().toISOString()}\n${marker}`;
    try {
      for (const file of ['HANDOFF.md', 'TASKS.md'] as const) {
        const current = await readTextFile(this.options.workspace, file, this.options.maxReadBytes);
        const start = current.indexOf(marker);
        const endMarker = start >= 0 ? current.indexOf(marker, start + marker.length) : -1;
        const end = endMarker >= 0 ? endMarker + marker.length : -1;
        const next = start >= 0 && end >= 0 ? current.slice(0, start) + block + current.slice(end) : `${current.trimEnd()}\n\n## AWH Autopilot checkpoint\n${block}\n`;
        if (Buffer.byteLength(next, 'utf8') > this.options.maxReadBytes) throw new Error(`${file} exceeds the bounded memory write limit`);
        await writeTextFile(this.options.workspace, file, next);
      }
    } catch (error) {
      try { await restoreCheckpoint(this.options.dataDir, this.options.workspace, checkpoint.id); } catch { /* Preserve the original failure; the checkpoint remains available for human recovery. */ }
      throw error;
    }
    await this.audit.write({ tool: 'autopilot_memory_checkpoint', outcome: 'allowed', detail: `${task.taskId}: HANDOFF.md,TASKS.md` });
    return { changed: true, checkpoint };
  }

  private async execute(initial: TaskContract, profile: AutopilotProfile, detected: Awaited<ReturnType<typeof detectProject>>): Promise<AutopilotRunResult> {
    if (this.running.has(initial.taskId)) throw new Error('Autopilot task is already running');
    this.running.add(initial.taskId);
    let contract = stateUpdate(initial, 'PLANNING'); this.records.set(contract.taskId, contract); await this.persist(contract);
    try {
      const resolved = await resolveRegisteredProject(this.options.dataDir, this.options.manifest.projectId);
      const selectedWorkspace = await canonicalWorkspace(this.options.workspace);
      if (resolved.workspacePath !== selectedWorkspace) throw new Error('Registered project workspace does not match the selected workspace');
      await buildProjectContext(this.options.workspace);
      contract = stateUpdate(contract, 'WORKING'); this.records.set(contract.taskId, contract); await this.persist(contract);
      const present = (await projectMemoryStatus(this.options.workspace));
      const paths = PROJECT_MEMORY_FILES.filter((file) => present[file] === 'present');
      const checkpoint = paths.length > 0 ? await createCheckpoint(this.options.dataDir, this.options.workspace, paths, this.options.maxReadBytes) : null;
      contract = stateUpdate(contract, 'TESTING', { sourceCheckpoint: checkpoint?.id ?? null }); this.records.set(contract.taskId, contract); await this.persist(contract);
      const gates: GateResult[] = [];
      const specs = [
        ...profile.packageCommands.map((command) => ({ id: command, capability: `package:${command}` as Capability, command })),
        ...profile.additionalGates.map((capability) => ({ id: capability, capability, command: null })),
      ];
      for (const spec of specs) {
        if (!profile.capabilities.includes(spec.capability)) { gates.push({ id: spec.id, status: 'SKIP', attempts: 0, summary: 'Capability is not enabled by the selected profile' }); continue; }
        if (spec.command && !detected.approvedScripts.includes(spec.command)) { gates.push({ id: spec.id, status: 'SKIP', attempts: 0, summary: `Approved ${spec.command} script is not present` }); continue; }
        let attempts = 0; let result = { code: -1, stdout: '', stderr: '' };
        let fixedUnavailable = false;
        while (attempts < 2) {
          attempts += 1;
          const fixed = spec.command ? null : await runFixedCapability(this.options.workspace, spec.capability, this.options.maxReadBytes);
          if (fixed && !fixed.available) { fixedUnavailable = true; result = { code: 0, stdout: '', stderr: '' }; break; }
          result = fixed ?? await runPackageScript(this.options.workspace, detected.packageManager ?? undefined, spec.command!, safeExecutionEnvironment());
          if (result.code === 0) break;
          if (attempts === 1) { contract = stateUpdate(contract, 'RETRYING', { retryCount: 1 }); this.records.set(contract.taskId, contract); await this.persist(contract); }
        }
        const unavailable = fixedUnavailable;
        const summary = unavailable ? `${spec.id} skipped: required local tool is unavailable` : result.code === 0 ? `${spec.id} passed` : `${spec.id} failed after ${attempts} attempt(s): ${redact(result.stderr || result.stdout, this.options.workspace, this.options.dataDir)}`;
        gates.push({ id: spec.id, status: unavailable ? 'SKIP' : result.code === 0 ? 'PASS' : 'FAIL', attempts, summary });
        if (result.code !== 0) {
          contract = stateUpdate(contract, 'FAILED', { error: `${spec.id} gate failed` }); this.records.set(contract.taskId, contract); await this.persist(contract);
          await this.audit.write({ tool: 'autopilot', outcome: 'error', detail: `${contract.taskId}: ${spec.id} failed` });
          return { contract, profile, contextLoaded: true, checkpoint, gates, artifact: null, continuity: null };
        }
      }
      const artifactId = randomUUID();
      const artifactPayload = { schemaVersion: 1, taskId: contract.taskId, projectId: contract.projectId, profile: profile.id, gates };
      const artifact = await createArtifact(this.options.dataDir, { artifactId, taskId: contract.taskId, projectId: contract.projectId, kind: profile.defaultArtifact, label: `${profile.label} review artifact`, status: 'READY', relativeRef: `artifacts/${artifactId}.payload.json`, bytes: Buffer.byteLength(JSON.stringify(artifactPayload), 'utf8'), payload: artifactPayload });
      contract = stateUpdate(contract, 'READY_FOR_REVIEW', { artifactRefs: [artifact.relativeRef] }); this.records.set(contract.taskId, contract); await this.persist(contract);
      contract = stateUpdate(contract, 'COMPLETED', { artifactRefs: [artifact.relativeRef] }); this.records.set(contract.taskId, contract); await this.persist(contract);
      let continuity: ContinuityCheckpoint;
      try {
        continuity = await createContinuityCheckpoint({ dataDir: this.options.dataDir, workspace: this.options.workspace, projectId: contract.projectId, taskId: contract.taskId, sourceDeviceId: contract.assignedDevice, taskState: contract.state, goalSummary: contract.goal, artifactRefs: [artifact.relativeRef] });
      } catch (error) {
        contract = stateUpdate(contract, 'FAILED', { error: 'Continuity checkpoint could not be created' }); this.records.set(contract.taskId, contract); await this.persist(contract);
        await this.audit.write({ tool: 'autopilot', outcome: 'error', detail: `${contract.taskId}: continuity checkpoint failed` });
        throw error;
      }
      await this.audit.write({ tool: 'autopilot', outcome: 'allowed', detail: `${contract.taskId}: completed with ${gates.filter((gate) => gate.status === 'PASS').length} gate(s)` });
      return { contract, profile, contextLoaded: true, checkpoint, gates, artifact, continuity };
    } finally { this.running.delete(initial.taskId); }
  }

  private async persist(contract: TaskContract): Promise<void> {
    await mkdir(join(this.options.dataDir, 'autopilot'), { recursive: true, mode: 0o700 });
    const target = join(this.options.dataDir, 'autopilot', `${contract.taskId}.json`);
    const temporary = `${target}.tmp-${randomUUID()}`;
    await writeFile(temporary, `${JSON.stringify(contract)}\n`, { encoding: 'utf8', mode: 0o600 });
    if (process.platform !== 'win32') await chmod(temporary, 0o600);
    await rename(temporary, target);
    if (process.platform !== 'win32') await chmod(target, 0o600);
  }
}

export async function loadAutopilotTasks(dataDir: string, limit = 50): Promise<TaskContract[]> {
  let names: string[];
  try { names = await readdir(join(dataDir, 'autopilot')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const out: TaskContract[] = [];
  for (const name of names.filter((value) => value.endsWith('.json')).slice(0, 500)) {
    try { const path = join(dataDir, 'autopilot', name); const info = await lstat(path); if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_TASK_BYTES) continue; out.push(validateTaskContract(JSON.parse(await readFile(path, 'utf8')))); } catch { /* Fail closed per task record. */ }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, Math.max(1, Math.min(limit, 100)));
}
