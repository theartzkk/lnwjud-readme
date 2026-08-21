import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { AutopilotRunner, detectLocalCapabilities } from './autopilot.js';
import { runCodexGoal } from './codex.js';
import { loadOrCreateDeviceIdentity } from './device-identity.js';
import { createCheckpoint } from './changes.js';
import { createContinuityCheckpoint } from './continuity.js';
import { resolveRegisteredProject, PROJECT_MEMORY_FILES } from './project-registry.js';
import { ControlPlaneWorkerClient, type WorkerTask } from './control-plane-worker-client.js';

const MUTATION_GOAL = /(?:\b(?:fix|edit|change|modify|write|render|publish|deploy|delete|remove)\b|แก้|เพิ่ม|ลบ|สร้าง|เรนเดอร์|เผยแพร่|deploy)/iu;

export interface WorkerRuntimeOptions {
  dataDir: string;
  maxReadBytes: number;
  allowExec: boolean;
  allowWrite: boolean;
  allowCodex: boolean;
}

export type WorkerRunResult =
  | { status: 'IDLE'; deviceId: string }
  | { status: 'WAITING_FOR_APPROVAL'; taskId: string; projectId: string; reason: string }
  | { status: 'COMPLETED'; taskId: string; projectId: string; artifact: string | null }
  | { status: 'FAILED'; taskId: string; projectId: string; reason: string };

function boundedSummary(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/(?:Bearer\s+)[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]').replace(/((?:password|secret|token|api[_-]?key)\s*[=:]\s*)[^\s&]+/gi, '$1[redacted]').slice(0, 500);
}

export function isMutationGoal(goal: string): boolean { return MUTATION_GOAL.test(goal); }

export async function workerCapabilities(dataDir: string): Promise<string[]> {
  const local = await detectLocalCapabilities(dataDir).catch(() => ({ git: false, node: false, php: false, ffmpeg: false, remotion: false, browsers: [] }));
  return [
    'autopilot:local', 'project:context', 'qa:bounded',
    ...(local.git ? ['git:read'] : []), ...(local.node ? ['node'] : []),
    ...(local.php ? ['php:lint'] : []), ...(local.ffmpeg ? ['ffmpeg:probe'] : []),
    ...(local.remotion ? ['remotion'] : []),
  ].slice(0, 24);
}

export class ControlPlaneWorkerRuntime {
  private running = false;

  constructor(private readonly client: ControlPlaneWorkerClient, private readonly options: WorkerRuntimeOptions) {}

  async runOnce(): Promise<WorkerRunResult> {
    if (this.running) throw new Error('Worker run is already active');
    this.running = true;
    const identity = await loadOrCreateDeviceIdentity(this.options.dataDir);
    try {
      await this.client.heartbeat(await workerCapabilities(this.options.dataDir), 'READY');
      const task = await this.client.claim();
      if (!task) return { status: 'IDLE', deviceId: identity.deviceId };
      return await this.execute(task, identity.deviceId);
    } finally { this.running = false; }
  }

  private async execute(task: WorkerTask, deviceId: string): Promise<WorkerRunResult> {
    let resolved;
    try { resolved = await resolveRegisteredProject(this.options.dataDir, task.projectId); }
    catch { await this.safeUpdate(task, 'FAILED', 0, 'Project context was rejected', 'PROJECT_CONTEXT_REJECTED'); return { status: 'FAILED', taskId: task.taskId, projectId: task.projectId, reason: 'PROJECT_CONTEXT_REJECTED' }; }

    const mutation = isMutationGoal(task.goal);
    if (mutation && task.approvalStatus !== 'APPROVED') {
      await this.safeUpdate(task, 'WAITING_FOR_APPROVAL', 0, 'Owner approval is required before a source-changing goal can run', null);
      return { status: 'WAITING_FOR_APPROVAL', taskId: task.taskId, projectId: task.projectId, reason: 'OWNER_APPROVAL_REQUIRED' };
    }
    if (!this.options.allowExec || (mutation && (!this.options.allowWrite || !this.options.allowCodex))) {
      await this.safeUpdate(task, 'WAITING_FOR_APPROVAL', 0, 'This device policy does not allow the requested execution boundary', null);
      return { status: 'WAITING_FOR_APPROVAL', taskId: task.taskId, projectId: task.projectId, reason: 'DEVICE_POLICY_REQUIRES_APPROVAL' };
    }

    try {
      await this.client.update(task.taskId, mutation ? 'RUNNING' : 'PREPARING', 5, 'Project context verified');
      if (mutation) {
        await createCheckpoint(this.options.dataDir, resolved.workspacePath, [...PROJECT_MEMORY_FILES], this.options.maxReadBytes);
        const codex = await runCodexGoal(resolved.workspacePath, task.goal, 'workspace-write');
        if (codex.code !== 0) { await this.safeUpdate(task, 'FAILED', 10, 'AI-assisted task failed safely', 'CODEX_EXECUTION_FAILED'); return { status: 'FAILED', taskId: task.taskId, projectId: task.projectId, reason: 'CODEX_EXECUTION_FAILED' }; }
      }
      await this.client.update(task.taskId, 'QA', 70, 'Running approved project QA');
      const runner = new AutopilotRunner({ dataDir: this.options.dataDir, workspace: resolved.workspacePath, manifest: resolved.manifest, deviceId, maxReadBytes: this.options.maxReadBytes, allowExec: true, allowWrite: mutation && this.options.allowWrite });
      const result = await runner.runNow({ goal: mutation ? 'Run bounded QA after the approved change' : task.goal, acceptanceCriteria: ['Project context remains bound to the canonical identity', 'Approved QA completes', 'A bounded result is available'] });
      if (result.contract.state !== 'COMPLETED') { await this.safeUpdate(task, 'FAILED', 80, 'Project QA failed', 'PROJECT_QA_FAILED'); return { status: 'FAILED', taskId: task.taskId, projectId: task.projectId, reason: 'PROJECT_QA_FAILED' }; }
      let artifactRef: string | null = result.artifact?.relativeRef ?? null;
      if (result.artifact) {
        const artifactPath = join(this.options.dataDir, result.artifact.relativeRef);
        const bytes = (await stat(artifactPath)).size;
        const sha256 = createHash('sha256').update(await readFile(artifactPath)).digest('hex');
        await this.client.addArtifact(task.taskId, { kind: result.artifact.kind, name: result.artifact.label, sha256, sizeBytes: bytes, relativeRef: result.artifact.relativeRef });
      }
      await createContinuityCheckpoint({ dataDir: this.options.dataDir, workspace: resolved.workspacePath, projectId: task.projectId, taskId: task.taskId, sourceDeviceId: deviceId, taskState: 'COMPLETED', goalSummary: task.goal, artifactRefs: artifactRef ? [artifactRef] : [] });
      await this.client.update(task.taskId, 'COMPLETED', 100, 'Completed with bounded QA and continuity', mutation ? 'Approved project change and QA completed' : 'Project context and approved QA completed');
      return { status: 'COMPLETED', taskId: task.taskId, projectId: task.projectId, artifact: artifactRef };
    } catch (error) {
      await this.safeUpdate(task, 'FAILED', 0, 'Worker execution failed safely', 'WORKER_EXECUTION_FAILED');
      return { status: 'FAILED', taskId: task.taskId, projectId: task.projectId, reason: boundedSummary(error instanceof Error ? error.message : 'WORKER_EXECUTION_FAILED') };
    }
  }

  private async safeUpdate(task: WorkerTask, state: 'WAITING_FOR_APPROVAL' | 'FAILED', progress: number, message: string, result: string | null): Promise<void> {
    try { await this.client.update(task.taskId, state, progress, message, result); } catch { /* Keep the original bounded failure state; never leak transport diagnostics. */ }
  }
}
