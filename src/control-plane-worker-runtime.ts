import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AutopilotRunner, detectLocalCapabilities } from './autopilot.js';
import { codexStatus, runCodexGoal } from './codex.js';
import { loadOrCreateDeviceIdentity } from './device-identity.js';
import { createCheckpoint } from './changes.js';
import { createContinuityCheckpoint } from './continuity.js';
import { buildProjectContext, listProjects, readProjectManifest, resolveRegisteredProject, PROJECT_MEMORY_FILES } from './project-registry.js';
import { discoverGitHubProjectSource } from './project-source.js';
import { ControlPlaneWorkerClient, type WorkerProject, type WorkerTask } from './control-plane-worker-client.js';
import { createUnsyncedWorkspaceCheckpoint, createWorkspaceWipCheckpoint, reconstructWorkspaceWip } from './workspace-continuity.js';
import { createVaultCandidateArchive } from './vault-transfer.js';
import { composeWorkerHeartbeatCapabilities, discoverWorkerTools } from './worker-capability-discovery.js';
import { exportOfficeFileToPdf } from './windows-office-export.js';
import { execCommand } from './process.js';

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
  | { status: 'WAITING_FOR_WORKER'; taskId: string; projectId: string; reason: string }
  | { status: 'WAITING_FOR_APPROVAL'; taskId: string; projectId: string; reason: string }
  | { status: 'COMPLETED'; taskId: string; projectId: string; artifact: string | null }
  | { status: 'FAILED'; taskId: string; projectId: string; reason: string };

function boundedSummary(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/(?:Bearer\s+)[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]').replace(/((?:password|secret|token|api[_-]?key)\s*[=:]\s*)[^\s&]+/gi, '$1[redacted]').slice(0, 500);
}

export function isMutationGoal(goal: string): boolean { return MUTATION_GOAL.test(goal); }

const PROJECT_MEMORY_MAX_BYTES = 32 * 1024;

function sameProjectName(left: string, right: string): boolean { return left.trim().toLocaleLowerCase('en-US') === right.trim().toLocaleLowerCase('en-US'); }

async function localProjectMemoryMetadata(workspace: string): Promise<Array<{ name: string; status: 'present' | 'missing'; sha256: string | null; sizeBytes: number }>> {
  const output: Array<{ name: string; status: 'present' | 'missing'; sha256: string | null; sizeBytes: number }> = [];
  for (const name of PROJECT_MEMORY_FILES) {
    const path = join(workspace, name);
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isFile() || info.size > PROJECT_MEMORY_MAX_BYTES) throw new Error('PROJECT_MEMORY_INVALID');
      const data = await readFile(path);
      output.push({ name, status: 'present', sha256: createHash('sha256').update(data).digest('hex'), sizeBytes: data.length });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') output.push({ name, status: 'missing', sha256: null, sizeBytes: 0 });
      else throw error;
    }
  }
  return output;
}

async function committedProjectRevision(workspace: string, preferred: string | null): Promise<string | null> {
  const target = preferred ? `${preferred}^{commit}` : 'HEAD^{commit}';
  const result = await execCommand('git', ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'submodule.recurse=false', 'rev-parse', '--verify', target], workspace, 30_000);
  if (result.code !== 0) return null;
  const revision = result.stdout.trim().toLowerCase();
  return /^[0-9a-f]{40,64}$/.test(revision) ? revision : null;
}

async function createCommittedSourceArchive(workspace: string, revision: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await rm(destination, { force: true });
  const result = await execCommand('git', ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'submodule.recurse=false', 'archive', '--format=zip', `--output=${destination}`, revision], workspace, 120_000);
  if (result.code !== 0) throw new Error('PROJECT_SOURCE_ARCHIVE_FAILED');
  const info = await stat(destination);
  if (!info.isFile() || info.size < 1 || info.size > 1024 * 1024 * 1024) throw new Error('PROJECT_SOURCE_ARCHIVE_INVALID');
}

/**
 * Canonical AI instruction order for AWH workers. Project memory remains in the
 * canonical workspace and Codex is explicitly required to inspect it after the
 * owner-level Constitution and before implementing the current Goal.
 */
export function buildCodexTaskInstruction(ownerProtocol: string, goal: string): string {
  if (typeof ownerProtocol !== 'string' || !ownerProtocol.includes('Art ↔ AI Working Constitution')) throw new Error('Owner working protocol is unavailable');
  const memoryFiles = PROJECT_MEMORY_FILES.join(', ');
  return [
    'AWH OWNER-LEVEL WORKING CONTRACT — MANDATORY',
    ownerProtocol.trim(),
    'PROJECT CONTEXT CONTRACT',
    `Before implementation, inspect the canonical project identity and relevant Project Memory in this workspace (${memoryFiles}). Inspect current source/runtime state and treat those files as project-specific Source of Truth beneath the owner-level contract. Do not assume the user\'s wording limits analysis scope.`,
    'CURRENT OWNER GOAL',
    goal.trim(),
    'EXECUTION REQUIREMENT',
    'Apply the owner contract: system-first and root-cause-first analysis, search for shared/legacy/duplicate paths, preserve validated core and unrelated work, make one coherent bounded change, run architecture-relevant QA, and report only what is proven. Do not create a parallel system or broaden permissions.',
  ].join('\n\n');
}

export function officeExecutionCapabilities(platform: NodeJS.Platform | string, tools: readonly string[]): string[] {
  if (platform !== 'win32') return [];
  return [
    ...(tools.includes('tool.office.word') ? ['office.word.pdf'] : []),
    ...(tools.includes('tool.office.excel') ? ['office.excel.pdf'] : []),
    ...(tools.includes('tool.office.powerpoint') ? ['office.powerpoint.pdf'] : []),
  ];
}

export async function workerCapabilities(dataDir: string, allowCodex = true): Promise<string[]> {
  const local = await detectLocalCapabilities(dataDir).catch(() => ({ git: false, node: false, php: false, ffmpeg: false, remotion: false, browsers: [] }));
  const codex = allowCodex ? await codexStatus(dataDir).catch(() => ({ available: false, version: null })) : { available: false, version: null };
  const tools = await discoverWorkerTools().catch((): string[] => []);
  const executable = [
    'autopilot:local', 'project:context', 'qa:bounded',
    ...(local.git ? ['git:read'] : []), ...(local.node ? ['node'] : []),
    ...(local.php ? ['php:lint'] : []), ...(local.ffmpeg ? ['ffmpeg:probe'] : []),
    ...(local.remotion ? ['remotion'] : []),
    ...officeExecutionCapabilities(process.platform, tools),
    ...(codex.available ? ['codex:cli'] : []),
  ];
  if (codex.available) tools.push('tool.codex');
  return composeWorkerHeartbeatCapabilities(executable, tools);
}

export class ControlPlaneWorkerRuntime {
  private running = false;
  private readonly contextRecoveryAttempts = new Set<string>();

  constructor(private readonly client: ControlPlaneWorkerClient, private readonly options: WorkerRuntimeOptions) {}

  async runOnce(): Promise<WorkerRunResult> {
    if (this.running) throw new Error('Worker run is already active');
    this.running = true;
    const identity = await loadOrCreateDeviceIdentity(this.options.dataDir);
    try {
      const capabilities = await workerCapabilities(this.options.dataDir, this.options.allowCodex);
      await this.client.heartbeat(capabilities, 'READY');
      await this.recoverMissingProjectContexts(capabilities).catch(() => undefined);
      const task = await this.client.claim();
      if (!task) return { status: 'IDLE', deviceId: identity.deviceId };
      return await this.execute(task, identity.deviceId, capabilities);
    } finally { this.running = false; }
  }

  private async localWorkspaceForHubProject(project: WorkerProject): Promise<string | null> {
    const records = await listProjects(this.options.dataDir);
    const matches: string[] = [];
    for (const record of records) {
      try {
        const manifest = await readProjectManifest(record.workspacePath);
        if (sameProjectName(manifest.name, project.name)) matches.push(record.workspacePath);
      } catch { /* unavailable/stale local registry entries are not recovery candidates */ }
    }
    return matches.length === 1 ? matches[0]! : null;
  }

  /** Recover an empty canonical Hub Vault from one uniquely matched trusted local workspace.
   * Only committed Git bytes are uploaded; WIP remains local and Project Memory crosses
   * the boundary as bounded metadata only. One runtime attempts each revision once. */
  private async recoverMissingProjectContexts(capabilities: string[]): Promise<void> {
    const projects = await this.client.projects();
    for (const project of projects) {
      if (project.vaultReady) continue;
      const workspace = await this.localWorkspaceForHubProject(project);
      if (!workspace) continue;
      const revision = await committedProjectRevision(workspace, project.sourceRevision);
      if (!revision) continue;
      const key = `${project.projectId}:${revision}`;
      if (this.contextRecoveryAttempts.has(key)) continue;
      this.contextRecoveryAttempts.add(key);
      const archive = join(this.options.dataDir, 'project-source-recovery', `${project.projectId}-${revision.slice(0, 12)}.zip`);
      try {
        await this.client.registerProject({ projectId: project.projectId, name: project.name, type: project.type, sourceRevision: revision, source: await discoverGitHubProjectSource(workspace) });
        await this.client.registerProjectBinding(project.projectId, project.name, capabilities, revision);
        await createCommittedSourceArchive(workspace, revision, archive);
        await this.client.uploadProjectSource(project.projectId, revision, archive);
        await this.client.publishProjectMemory(project.projectId, await localProjectMemoryMetadata(workspace));
      } catch {
        // Recovery is opportunistic and bounded. The Hub keeps truthful SOURCE/Vault state,
        // while ordinary work continues and a future process restart may retry once.
      } finally { await rm(archive, { force: true }).catch(() => undefined); }
    }
  }

  private async execute(task: WorkerTask, deviceId: string, capabilities: string[]): Promise<WorkerRunResult> {
    if (task.execution?.executorKind === 'CODEX' && task.execution.requiredCapability === 'codex:cli' && task.execution.vaultRevisionId !== null) return this.executeCentralCodex(task, capabilities);
    if (task.execution?.executorKind === 'DEVICE' && /^office\.(?:word|excel|powerpoint)\.pdf$/.test(task.execution.requiredCapability)) return this.executeOfficePdf(task, capabilities);
    // A bounded lease is what prevents two workers from mutating one task. A
    // Codex run can legitimately exceed the initial five-minute lease, so the
    // already-authenticated worker renews it while it owns the task. Failure
    // to renew never fabricates success; the Hub's stale-lease recovery path
    // will requeue the task safely.
    let workspaceLeaseHeld = false;
    let workspaceLeaseLost = false;
    let mutationWorkspace: string | null = null;
    const leaseHeartbeat = setInterval(() => {
      void this.client.heartbeat(capabilities, 'WORKING').catch(() => undefined);
      if (workspaceLeaseHeld) void this.client.renewWorkspaceLease(task.projectId).catch(() => { workspaceLeaseLost = true; });
    }, 60_000);
    leaseHeartbeat.unref?.();
    try {
      const resolved = await resolveRegisteredProject(this.options.dataDir, task.projectId).catch(() => null);
      if (!resolved) {
        await this.safeUpdate(task, 'FAILED', 0, 'Project context was rejected', 'PROJECT_CONTEXT_REJECTED');
        return { status: 'FAILED', taskId: task.taskId, projectId: task.projectId, reason: 'PROJECT_CONTEXT_REJECTED' };
      }
      // This tells the Hub that this trusted device can restore/work on the
      // canonical project. The Hub stores no local path and binding failure
      // must not turn a safe existing task into a false success.
      try {
        await this.client.registerProjectBinding(task.projectId, resolved.manifest.name, capabilities, null);
      } catch (error) {
        // A newer desktop must not execute against an older Hub whose
        // workspace-binding contract is unavailable. Keep the claimed task
        // truthful and retryable; do not mutate the workspace or fabricate a
        // completed result.
        const reason = boundedSummary(error instanceof Error ? error.message : 'HUB_PROTOCOL_UPDATE_REQUIRED');
        await this.safeUpdate(task, 'WAITING_FOR_WORKER', 0, 'A compatible AWH Hub update is required before this workspace can run', reason);
        return { status: 'WAITING_FOR_WORKER', taskId: task.taskId, projectId: task.projectId, reason };
      }
      const mutation = isMutationGoal(task.goal);
      if (mutation && task.approvalStatus !== 'APPROVED') {
        await this.safeUpdate(task, 'WAITING_FOR_APPROVAL', 0, 'Owner approval is required before a source-changing goal can run', null);
        return { status: 'WAITING_FOR_APPROVAL', taskId: task.taskId, projectId: task.projectId, reason: 'OWNER_APPROVAL_REQUIRED' };
      }
      if (!this.options.allowExec || (mutation && (!this.options.allowWrite || !this.options.allowCodex))) {
        await this.safeUpdate(task, 'WAITING_FOR_APPROVAL', 0, 'This device policy does not allow the requested execution boundary', null);
        return { status: 'WAITING_FOR_APPROVAL', taskId: task.taskId, projectId: task.projectId, reason: 'DEVICE_POLICY_REQUIRES_APPROVAL' };
      }
      if (mutation) {
        try {
          const workspace = await this.client.workspace(task.projectId);
          if (workspace.syncStatus === 'UNSYNCED_CHANGES') throw new Error('UNSYNCED_WORKSPACE_CHANGES');
          if (workspace.lease?.active && workspace.lease.owner.deviceId !== deviceId) throw new Error('WORKSPACE_HANDOFF_REQUIRED');
          await this.client.claimWorkspaceLease(task.projectId, workspace.checkpoint?.checkpointId ?? null);
          workspaceLeaseHeld = true;
          // Claim before touching the local worktree. This closes the handoff
          // race where a second target could otherwise restore the same WIP
          // while the first target was still reconstructing it.
          if (workspace.checkpoint !== null && workspace.checkpoint.sourceDeviceId !== deviceId) {
            try {
              await reconstructWorkspaceWip({ workspace: resolved.workspacePath, checkpoint: workspace.checkpoint });
            } catch (error) {
              try { await this.client.releaseWorkspaceLease(task.projectId); } catch { /* The short Hub lease expires safely if transport is unavailable. */ }
              workspaceLeaseHeld = false;
              throw error;
            }
          }
          mutationWorkspace = resolved.workspacePath;
        } catch (error) {
          const reason = boundedSummary(error instanceof Error ? error.message : 'WORKSPACE_HANDOFF_REQUIRED');
          await this.safeUpdate(task, 'WAITING_FOR_WORKER', 0, 'Workspace handoff is required before source-changing work can continue', reason);
          return { status: 'WAITING_FOR_WORKER', taskId: task.taskId, projectId: task.projectId, reason };
        }
      }
      const context = await buildProjectContext(resolved.workspacePath);
      await this.client.update(task.taskId, mutation ? 'RUNNING' : 'PREPARING', 5, 'Owner protocol and project context verified');
      if (mutation) {
        await createCheckpoint(this.options.dataDir, resolved.workspacePath, [...PROJECT_MEMORY_FILES], this.options.maxReadBytes);
        const instruction = buildCodexTaskInstruction(context.ownerProtocol, task.goal);
        const codex = await runCodexGoal(resolved.workspacePath, instruction, 'workspace-write');
        if (codex.code !== 0) throw new Error('CODEX_EXECUTION_FAILED');
      }
      if (workspaceLeaseLost) throw new Error('WORKSPACE_LEASE_RENEWAL_FAILED');
      await this.client.update(task.taskId, 'QA', 70, 'Running approved project QA');
      const runner = new AutopilotRunner({ dataDir: this.options.dataDir, workspace: resolved.workspacePath, manifest: resolved.manifest, deviceId, maxReadBytes: this.options.maxReadBytes, allowExec: true, allowWrite: mutation && this.options.allowWrite });
      const result = await runner.runNow({ goal: mutation ? 'Run bounded QA after the approved change' : task.goal, acceptanceCriteria: ['Owner protocol and project context remain bound to the canonical identity', 'Approved QA completes', 'A bounded result is available'] });
      if (result.contract.state !== 'COMPLETED') throw new Error('PROJECT_QA_FAILED');
      const artifactRef: string | null = result.artifact?.relativeRef ?? null;
      if (result.artifact) {
        const artifactPath = join(this.options.dataDir, result.artifact.relativeRef);
        const bytes = (await stat(artifactPath)).size;
        const sha256 = createHash('sha256').update(await readFile(artifactPath)).digest('hex');
        await this.client.addArtifact(task.taskId, { kind: result.artifact.kind, name: result.artifact.label, sha256, sizeBytes: bytes, relativeRef: result.artifact.relativeRef });
      }
      if (mutation) {
        try {
          const checkpoint = await createWorkspaceWipCheckpoint({ workspace: resolved.workspacePath, projectId: task.projectId, sourceDeviceId: deviceId, taskId: task.taskId, artifactRefs: artifactRef ? [artifactRef] : [] });
          await this.client.publishWorkspaceCheckpoint(checkpoint);
          await this.client.releaseWorkspaceLease(task.projectId);
          workspaceLeaseHeld = false;
        } catch (error) {
          try {
            const unsynced = await createUnsyncedWorkspaceCheckpoint({ workspace: resolved.workspacePath, projectId: task.projectId, sourceDeviceId: deviceId, taskId: task.taskId, artifactRefs: artifactRef ? [artifactRef] : [] });
            await this.client.publishWorkspaceCheckpoint(unsynced);
          } catch { /* Hub may be offline; do not falsely claim that local WIP is synchronized. */ }
          await this.safeUpdate(task, 'FAILED', 90, 'Work completed locally but could not be synchronized safely for another device', 'WORKSPACE_CONTINUITY_REQUIRED');
          return { status: 'FAILED', taskId: task.taskId, projectId: task.projectId, reason: boundedSummary(error instanceof Error ? error.message : 'WORKSPACE_CONTINUITY_REQUIRED') };
        }
      }
      await createContinuityCheckpoint({ dataDir: this.options.dataDir, workspace: resolved.workspacePath, projectId: task.projectId, taskId: task.taskId, sourceDeviceId: deviceId, taskState: 'COMPLETED', goalSummary: task.goal, artifactRefs: artifactRef ? [artifactRef] : [] });
      const passed = result.gates.filter((gate) => gate.status === 'PASS').length;
      const summary = mutation ? `ดำเนินการตามขอบเขตที่อนุมัติแล้ว และ QA ผ่าน ${passed} รายการ` : `ตรวจบริบทและ QA แล้วผ่าน ${passed} รายการ โดยไม่ได้แก้ไข source`;
      await this.client.update(task.taskId, 'COMPLETED', 100, 'Completed with owner protocol, bounded QA and continuity', summary);
      return { status: 'COMPLETED', taskId: task.taskId, projectId: task.projectId, artifact: artifactRef };
    } catch (error) {
      if (workspaceLeaseHeld && mutationWorkspace !== null) {
        try {
          const checkpoint = await createWorkspaceWipCheckpoint({ workspace: mutationWorkspace, projectId: task.projectId, sourceDeviceId: deviceId, taskId: task.taskId });
          await this.client.publishWorkspaceCheckpoint(checkpoint);
          await this.client.releaseWorkspaceLease(task.projectId);
          workspaceLeaseHeld = false;
        } catch {
          try {
            const unsynced = await createUnsyncedWorkspaceCheckpoint({ workspace: mutationWorkspace, projectId: task.projectId, sourceDeviceId: deviceId, taskId: task.taskId });
            await this.client.publishWorkspaceCheckpoint(unsynced);
          } catch { /* A disconnected Hub must never be represented as a synced workspace. */ }
        }
      }
      await this.safeUpdate(task, 'FAILED', 0, 'Worker execution failed safely', 'WORKER_EXECUTION_FAILED');
      return { status: 'FAILED', taskId: task.taskId, projectId: task.projectId, reason: boundedSummary(error instanceof Error ? error.message : 'WORKER_EXECUTION_FAILED') };
    } finally { clearInterval(leaseHeartbeat); }
  }

  /** Office export is a non-mutating device capability. The source file is
   * downloaded from private Hub attachment storage, converted in a disposable
   * directory, and the PDF is uploaded back to Hub object storage. */
  private async executeOfficePdf(task: WorkerTask, capabilities: string[]): Promise<WorkerRunResult> {
    const execution = task.execution;
    if (!execution || execution.executorKind !== 'DEVICE') return { status: 'FAILED', taskId: task.taskId, projectId: task.projectId, reason: 'OFFICE_EXECUTION_INVALID' };
    if (!this.options.allowExec || process.platform !== 'win32' || !capabilities.includes(execution.requiredCapability)) {
      await this.client.deferCentralExecution(execution.executionId, 'OFFICE_UNAVAILABLE').catch(() => undefined);
      return { status: 'WAITING_FOR_WORKER', taskId: task.taskId, projectId: task.projectId, reason: 'OFFICE_UNAVAILABLE' };
    }
    const root = join(this.options.dataDir, 'office-task-workspaces', execution.executionId);
    const heartbeat = setInterval(() => { void this.client.heartbeat(capabilities, 'WORKING').catch(() => undefined); }, 60_000); heartbeat.unref?.();
    try {
      const materialized = await this.client.materializeOfficeExecutionInput(execution.executionId, root);
      if (materialized.taskId !== task.taskId || materialized.projectId !== task.projectId) throw new Error('OFFICE_EXECUTION_MISMATCH');
      await this.client.update(task.taskId, 'RUNNING', 25, 'AWH กำลังแปลงเอกสารด้วย Office บนอุปกรณ์ที่พร้อม');
      const converted = await exportOfficeFileToPdf(materialized.inputPath, materialized.inputName, root);
      await this.client.update(task.taskId, 'QA', 80, 'AWH กำลังตรวจไฟล์ PDF ก่อนส่งกลับ Cloud');
      const result = await this.client.uploadOfficeExecutionArtifact(execution.executionId, converted.outputPath);
      return { status: 'COMPLETED', taskId: task.taskId, projectId: task.projectId, artifact: null };
    } catch (error) {
      const reason = boundedSummary(error instanceof Error ? error.message : 'OFFICE_EXECUTION_FAILED');
      const code = reason.includes('MISMATCH') ? 'OFFICE_EXECUTION_MISMATCH' : 'OFFICE_EXECUTION_FAILED';
      await this.client.deferCentralExecution(execution.executionId, code).catch(() => undefined);
      return { status: 'WAITING_FOR_WORKER', taskId: task.taskId, projectId: task.projectId, reason: code };
    } finally { clearInterval(heartbeat); await rm(root, { recursive: true, force: true }).catch(() => undefined); }
  }

  /** Central Vault tasks deliberately bypass device-local project bindings.
   * The worker receives only an immutable archive under its active execution
   * lease, runs Codex in a disposable directory, and returns one candidate
   * archive for Hub-side validation/approval. */
  private async executeCentralCodex(task: WorkerTask, capabilities: string[]): Promise<WorkerRunResult> {
    const execution = task.execution;
    if (!execution) return { status: 'FAILED', taskId: task.taskId, projectId: task.projectId, reason: 'CENTRAL_EXECUTION_INVALID' };
    if (!this.options.allowExec || !this.options.allowWrite || !this.options.allowCodex || !capabilities.includes('codex:cli')) {
      await this.client.deferCentralExecution(execution.executionId, 'CODEX_UNAVAILABLE').catch(() => undefined);
      return { status: 'WAITING_FOR_WORKER', taskId: task.taskId, projectId: task.projectId, reason: 'CODEX_UNAVAILABLE' };
    }
    const root = join(this.options.dataDir, 'central-task-workspaces'); let workspace: string | null = null; let archive: string | null = null;
    const heartbeat = setInterval(() => { void this.client.heartbeat(capabilities, 'WORKING').catch(() => undefined); }, 60_000); heartbeat.unref?.();
    try {
      const materialized = await this.client.materializeCentralExecutionWorkspace(execution.executionId, root); workspace = materialized.workspace;
      if (materialized.taskId !== task.taskId || materialized.projectId !== task.projectId || materialized.vaultRevisionId !== execution.vaultRevisionId) throw new Error('CENTRAL_REVISION_MISMATCH');
      await this.client.update(task.taskId, 'RUNNING', 20, 'Codex is working in an isolated AWH Vault workspace');
      const codex = await runCodexGoal(workspace, `${materialized.ownerProtocol}\n\nCURRENT OWNER GOAL\n${task.goal}`, 'workspace-write');
      if (codex.code !== 0) throw new Error('CODEX_EXECUTION_FAILED');
      await this.client.update(task.taskId, 'QA', 70, 'AWH is verifying the candidate workspace before any promotion');
      archive = join(root, `${execution.executionId}.candidate.zip`); await createVaultCandidateArchive(workspace, archive);
      const result = await this.client.uploadCentralExecutionCandidate(execution.executionId, archive);
      return result.state === 'WAITING_FOR_APPROVAL'
        ? { status: 'WAITING_FOR_APPROVAL', taskId: task.taskId, projectId: task.projectId, reason: 'CANDIDATE_READY_FOR_APPROVAL' }
        : { status: 'COMPLETED', taskId: task.taskId, projectId: task.projectId, artifact: null };
    } catch (error) {
      const reason = boundedSummary(error instanceof Error ? error.message : 'CODEX_EXECUTION_FAILED');
      const code = /CODEX|CENTRAL_REVISION_MISMATCH/.test(reason) ? (reason.includes('MISMATCH') ? 'CENTRAL_REVISION_MISMATCH' : 'CODEX_EXECUTION_FAILED') : 'CENTRAL_WORKSPACE_FAILED';
      await this.client.deferCentralExecution(execution.executionId, code).catch(() => undefined);
      return { status: 'WAITING_FOR_WORKER', taskId: task.taskId, projectId: task.projectId, reason: code };
    } finally { clearInterval(heartbeat); if (archive !== null) await rm(archive, { force: true }).catch(() => undefined); if (workspace !== null) await rm(workspace, { recursive: true, force: true }).catch(() => undefined); }
  }

  private async safeUpdate(task: WorkerTask, state: 'WAITING_FOR_WORKER' | 'WAITING_FOR_APPROVAL' | 'FAILED', progress: number, message: string, result: string | null): Promise<void> {
    try { await this.client.update(task.taskId, state, progress, message, result); } catch { /* Keep the original bounded failure state; never leak transport diagnostics. */ }
  }
}
