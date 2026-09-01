import { CredentialStore, DEVICE_TOKEN_CREDENTIAL_KEY } from './credential-store.js';
import { DeviceIdentity, loadOrCreateDeviceIdentity } from './device-identity.js';
import type { WorkspaceWipCheckpoint } from './workspace-continuity.js';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { extractVaultWorkspaceArchive } from './vault-transfer.js';

const MAX_RESPONSE_BYTES = 64 * 1024;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY = /^[a-z][a-z0-9:._-]{0,63}$/;
const STATE = new Set(['READY', 'WORKING', 'OFFLINE']);
const TASK_STATE = new Set(['WAITING_FOR_WORKER', 'PREPARING', 'RUNNING', 'QA', 'WAITING_FOR_APPROVAL', 'COMPLETED', 'FAILED']);

export class ControlPlaneWorkerError extends Error {
  constructor(message: string, readonly code = 'CONTROL_PLANE_WORKER_FAILED') { super(message); this.name = 'ControlPlaneWorkerError'; }
}

export interface WorkerProject { projectId: string; name: string; type: string; sourceRevision: string | null; vaultReady: boolean; }

export interface WorkerContinuation { rootTaskId: string; step: number; maxSteps: number; }

export interface WorkerTask {
  taskId: string;
  projectId: string;
  conversationId: string | null;
  goal: string;
  state: string;
  progress: number;
  assignedDevice: string | null;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | null;
  execution?: { executionId: string; executorKind: 'VPS' | 'DEVICE' | 'CODEX'; requiredCapability: string; vaultRevisionId: string | null; state: string; continuation: WorkerContinuation | null } | null;
}

export interface OfficeExecutionPacket { executionId: string; taskId: string; projectId: string; inputName: string; inputMimeType: string; sizeBytes: number; }

function apiRoot(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new ControlPlaneWorkerError('Worker API URL is invalid', 'API_URL_INVALID'); }
  if (!['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new ControlPlaneWorkerError('Worker API requires HTTPS', 'API_URL_INSECURE');
  if (url.search || url.hash || !url.pathname.endsWith('/api/v1')) throw new ControlPlaneWorkerError('Worker API path is invalid', 'API_URL_INVALID');
  url.pathname = url.pathname.replace(/\/$/, '');
  return url;
}

function boundedTask(value: unknown): WorkerTask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ControlPlaneWorkerError('Worker task response is invalid', 'RESPONSE_INVALID');
  const task = value as Record<string, unknown>;
  if (typeof task.taskId !== 'string' || !UUID_V4.test(task.taskId) || typeof task.projectId !== 'string' || !UUID_V4.test(task.projectId) || (task.conversationId !== undefined && task.conversationId !== null && (typeof task.conversationId !== 'string' || !UUID_V4.test(task.conversationId))) || typeof task.goal !== 'string' || task.goal.length > 2_000 || typeof task.state !== 'string' || typeof task.progress !== 'number' || !Number.isInteger(task.progress) || task.progress < 0 || task.progress > 100 || (task.assignedDevice !== null && (typeof task.assignedDevice !== 'string' || !UUID_V4.test(task.assignedDevice))) || (task.approvalStatus !== undefined && task.approvalStatus !== null && !['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'].includes(String(task.approvalStatus)))) throw new ControlPlaneWorkerError('Worker task response is invalid', 'RESPONSE_INVALID');
  const rawExecution = task.execution; let execution: WorkerTask['execution'] = null;
  if (rawExecution !== undefined && rawExecution !== null) {
    if (!rawExecution || typeof rawExecution !== 'object' || Array.isArray(rawExecution)) throw new ControlPlaneWorkerError('Worker task response is invalid', 'RESPONSE_INVALID');
    const item = rawExecution as Record<string, unknown>;
    if (typeof item.executionId !== 'string' || !UUID_V4.test(item.executionId) || !['VPS', 'DEVICE', 'CODEX'].includes(String(item.executorKind)) || typeof item.requiredCapability !== 'string' || !CAPABILITY.test(item.requiredCapability) || (item.vaultRevisionId !== null && (typeof item.vaultRevisionId !== 'string' || !UUID_V4.test(item.vaultRevisionId))) || typeof item.state !== 'string') throw new ControlPlaneWorkerError('Worker task response is invalid', 'RESPONSE_INVALID');
    const rawContinuation = item.continuation;
    let continuation: WorkerContinuation | null = null;
    if (rawContinuation !== undefined && rawContinuation !== null) {
      if (!rawContinuation || typeof rawContinuation !== 'object' || Array.isArray(rawContinuation)) throw new ControlPlaneWorkerError('Worker task response is invalid', 'RESPONSE_INVALID');
      const value = rawContinuation as Record<string, unknown>;
      if (typeof value.rootTaskId !== 'string' || !UUID_V4.test(value.rootTaskId) || !Number.isInteger(value.step) || Number(value.step) < 0 || !Number.isInteger(value.maxSteps) || Number(value.maxSteps) < 1 || Number(value.maxSteps) > 8 || Number(value.step) >= Number(value.maxSteps)) throw new ControlPlaneWorkerError('Worker task response is invalid', 'RESPONSE_INVALID');
      continuation = { rootTaskId: value.rootTaskId, step: value.step as number, maxSteps: value.maxSteps as number };
    }
    execution = { executionId: item.executionId, executorKind: item.executorKind as 'VPS' | 'DEVICE' | 'CODEX', requiredCapability: item.requiredCapability, vaultRevisionId: item.vaultRevisionId === null ? null : item.vaultRevisionId, state: item.state, continuation };
  }
  return { taskId: task.taskId, projectId: task.projectId, conversationId: task.conversationId === undefined || task.conversationId === null ? null : task.conversationId, goal: task.goal, state: task.state, progress: task.progress, assignedDevice: task.assignedDevice, approvalStatus: task.approvalStatus === undefined ? null : task.approvalStatus as WorkerTask['approvalStatus'], execution };
}

export interface CentralExecutionPacket { executionId: string; taskId: string; projectId: string; vaultRevisionId: string; ownerProtocol: string; }

export interface WorkerConversationMessage { messageId: string; taskId: string | null; kind: 'user' | 'assistant' | 'progress' | 'approval' | 'result' | 'failure'; sequence: number; body: string; createdAt: string; }
export interface WorkerConversation { conversation: { conversationId: string; projectId: string; createdAt: string; updatedAt: string; lastTaskId: string | null } | null; messages: WorkerConversationMessage[]; tasks: WorkerTask[]; artifacts: Array<Record<string, unknown>>; approvals: Array<Record<string, unknown>>; }
export interface WorkerWorkspace { projectId: string; syncStatus: 'NO_CHECKPOINT' | 'UNSYNCED_CHANGES' | 'HANDOFF_REQUIRED' | 'SYNCED' | 'SOURCE_OFFLINE'; checkpoint: WorkspaceWipCheckpoint | null; lease: { active: boolean; state: 'ACTIVE' | 'EXPIRED'; checkpointId: string | null; owner: { deviceId: string; displayName: string; platform: string; lastSeenAt: string | null }; leaseExpiresAt: string } | null; }
export interface OwnerPasswordResetLink { resetPath: string; expiresAt: string; }

function boundedConversation(value: Record<string, unknown>): WorkerConversation {
  const conversation = value.conversation;
  if (conversation !== null && (!conversation || typeof conversation !== 'object' || Array.isArray(conversation) || !UUID_V4.test(String((conversation as Record<string, unknown>).conversationId)) || !UUID_V4.test(String((conversation as Record<string, unknown>).projectId)))) throw new ControlPlaneWorkerError('Worker conversation response is invalid', 'RESPONSE_INVALID');
  if (!Array.isArray(value.messages) || !Array.isArray(value.tasks) || !Array.isArray(value.artifacts) || !Array.isArray(value.approvals) || value.messages.length > 250 || value.tasks.length > 100) throw new ControlPlaneWorkerError('Worker conversation response is invalid', 'RESPONSE_INVALID');
  const messages = value.messages.map((entry): WorkerConversationMessage => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new ControlPlaneWorkerError('Worker conversation response is invalid', 'RESPONSE_INVALID');
    const item = entry as Record<string, unknown>;
    if (typeof item.messageId !== 'string' || !UUID_V4.test(item.messageId) || (item.taskId !== null && (typeof item.taskId !== 'string' || !UUID_V4.test(item.taskId))) || !['user', 'assistant', 'progress', 'approval', 'result', 'failure'].includes(String(item.kind)) || !Number.isInteger(item.sequence) || Number(item.sequence) < 1 || typeof item.body !== 'string' || item.body.length > 800 || typeof item.createdAt !== 'string') throw new ControlPlaneWorkerError('Worker conversation response is invalid', 'RESPONSE_INVALID');
    return { messageId: item.messageId, taskId: item.taskId as string | null, kind: item.kind as WorkerConversationMessage['kind'], sequence: item.sequence as number, body: item.body, createdAt: item.createdAt };
  });
  return { conversation: conversation === null ? null : { conversationId: String((conversation as Record<string, unknown>).conversationId), projectId: String((conversation as Record<string, unknown>).projectId), createdAt: String((conversation as Record<string, unknown>).createdAt), updatedAt: String((conversation as Record<string, unknown>).updatedAt), lastTaskId: (conversation as Record<string, unknown>).lastTaskId === null ? null : String((conversation as Record<string, unknown>).lastTaskId) }, messages, tasks: value.tasks.map(boundedTask), artifacts: value.artifacts.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))).slice(0, 100), approvals: value.approvals.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))).slice(0, 50) };
}

function boundedWorkspace(value: Record<string, unknown>): WorkerWorkspace {
  const workspace = value.workspace;
  if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) throw new ControlPlaneWorkerError('Workspace response is invalid', 'RESPONSE_INVALID');
  const item = workspace as Record<string, unknown>;
  if (typeof item.projectId !== 'string' || !UUID_V4.test(item.projectId) || !['NO_CHECKPOINT', 'UNSYNCED_CHANGES', 'HANDOFF_REQUIRED', 'SYNCED', 'SOURCE_OFFLINE'].includes(String(item.syncStatus))) throw new ControlPlaneWorkerError('Workspace response is invalid', 'RESPONSE_INVALID');
  const checkpoint = item.checkpoint;
  let parsedCheckpoint: WorkspaceWipCheckpoint | null = null;
  if (checkpoint !== null) {
    if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) throw new ControlPlaneWorkerError('Workspace checkpoint is invalid', 'RESPONSE_INVALID');
    const record = checkpoint as Record<string, unknown>;
    if (!UUID_V4.test(String(record.checkpointId)) || !UUID_V4.test(String(record.projectId)) || String(record.projectId) !== item.projectId || !UUID_V4.test(String(record.sourceDeviceId)) || (record.taskId !== null && !UUID_V4.test(String(record.taskId))) || !/^[0-9a-f]{40,64}$/i.test(String(record.baseRevision)) || (record.wipRevision !== null && !/^[0-9a-f]{40,64}$/i.test(String(record.wipRevision))) || (record.wipRef !== null && !/^refs\/awh\/wip\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i.test(String(record.wipRef))) || !/^[0-9a-f]{40,64}$/i.test(String(record.treeRevision)) || !['CLEAN', 'SYNCED', 'UNSYNCED'].includes(String(record.syncState)) || !Array.isArray(record.files) || !Array.isArray(record.artifactRefs) || typeof record.createdAt !== 'string') throw new ControlPlaneWorkerError('Workspace checkpoint is invalid', 'RESPONSE_INVALID');
    parsedCheckpoint = { schemaVersion: 1, checkpointId: String(record.checkpointId), projectId: String(record.projectId), taskId: record.taskId === null ? null : String(record.taskId), sourceDeviceId: String(record.sourceDeviceId), baseRevision: String(record.baseRevision), wipRevision: record.wipRevision === null ? null : String(record.wipRevision), wipRef: record.wipRef === null ? null : String(record.wipRef), treeRevision: String(record.treeRevision), files: record.files as WorkspaceWipCheckpoint['files'], artifactRefs: record.artifactRefs as string[], syncState: record.syncState as WorkspaceWipCheckpoint['syncState'], createdAt: String(record.createdAt) };
  }
  const lease = item.lease;
  if (lease !== null && (!lease || typeof lease !== 'object' || Array.isArray(lease))) throw new ControlPlaneWorkerError('Workspace lease is invalid', 'RESPONSE_INVALID');
  let parsedLease: WorkerWorkspace['lease'] = null;
  if (lease !== null) {
    const record = lease as Record<string, unknown>; const owner = record.owner;
    if (typeof record.active !== 'boolean' || !['ACTIVE', 'EXPIRED'].includes(String(record.state)) || (record.checkpointId !== null && !UUID_V4.test(String(record.checkpointId))) || !owner || typeof owner !== 'object' || Array.isArray(owner) || !UUID_V4.test(String((owner as Record<string, unknown>).deviceId)) || typeof (owner as Record<string, unknown>).displayName !== 'string' || typeof (owner as Record<string, unknown>).platform !== 'string' || ((owner as Record<string, unknown>).lastSeenAt !== null && typeof (owner as Record<string, unknown>).lastSeenAt !== 'string') || typeof record.leaseExpiresAt !== 'string') throw new ControlPlaneWorkerError('Workspace lease is invalid', 'RESPONSE_INVALID');
    parsedLease = { active: record.active, state: record.state as 'ACTIVE' | 'EXPIRED', checkpointId: record.checkpointId === null ? null : String(record.checkpointId), owner: { deviceId: String((owner as Record<string, unknown>).deviceId), displayName: String((owner as Record<string, unknown>).displayName), platform: String((owner as Record<string, unknown>).platform), lastSeenAt: (owner as Record<string, unknown>).lastSeenAt === null ? null : String((owner as Record<string, unknown>).lastSeenAt) }, leaseExpiresAt: String(record.leaseExpiresAt) };
  }
  return { projectId: item.projectId, syncStatus: item.syncStatus as WorkerWorkspace['syncStatus'], checkpoint: parsedCheckpoint, lease: parsedLease };
}

export class ControlPlaneWorkerClient {
  private readonly root: URL;

  constructor(private readonly apiBase: string, private readonly dataDir: string, private readonly credentialStore: CredentialStore, private readonly fetchImpl: typeof fetch = fetch) { this.root = apiRoot(apiBase); }

  async heartbeat(capabilities: string[], state: 'READY' | 'WORKING' | 'OFFLINE' = 'READY'): Promise<{ deviceId: string; state: string; lastSeenAt: string }> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    if (!STATE.has(state) || !Array.isArray(capabilities) || capabilities.length > 24 || capabilities.some((value) => typeof value !== 'string' || !CAPABILITY.test(value))) throw new ControlPlaneWorkerError('Worker heartbeat is invalid', 'PAYLOAD_INVALID');
    const response = await this.post('/control/workers/heartbeat', { schemaVersion: 1, deviceId: identity.deviceId, state, capabilities: [...new Set(capabilities)] });
    if (response.schemaVersion !== 1 || response.deviceId !== identity.deviceId || typeof response.state !== 'string' || typeof response.lastSeenAt !== 'string') throw new ControlPlaneWorkerError('Worker heartbeat response is invalid', 'RESPONSE_INVALID');
    return { deviceId: identity.deviceId, state: response.state, lastSeenAt: response.lastSeenAt };
  }

  async claim(): Promise<WorkerTask | null> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    const response = await this.post('/control/workers/claim', { schemaVersion: 1, deviceId: identity.deviceId });
    if (response.schemaVersion !== 1) throw new ControlPlaneWorkerError('Worker claim response is invalid', 'RESPONSE_INVALID');
    return response.task === null ? null : boundedTask(response.task);
  }

  async update(taskId: string, state: string, progress: number, message: string | null = null, resultSummary: string | null = null): Promise<WorkerTask> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    if (!UUID_V4.test(taskId) || !TASK_STATE.has(state) || !Number.isInteger(progress) || progress < 0 || progress > 100 || (message !== null && (typeof message !== 'string' || message.length > 240)) || (resultSummary !== null && (typeof resultSummary !== 'string' || resultSummary.length > 500))) throw new ControlPlaneWorkerError('Worker update is invalid', 'PAYLOAD_INVALID');
    const response = await this.post(`/control/tasks/${taskId}/update`, { schemaVersion: 1, deviceId: identity.deviceId, state, progress, message, resultSummary });
    return boundedTask(response);
  }

  async addArtifact(taskId: string, input: { kind: string; name: string; sha256: string | null; sizeBytes: number; relativeRef: string | null }): Promise<WorkerTask> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    if (!UUID_V4.test(taskId) || !/^[a-z][a-z0-9-]{0,39}$/.test(input.kind) || typeof input.name !== 'string' || input.name.length < 1 || input.name.length > 160 || /[\\/\u0000-\u001f\u007f]/.test(input.name) || (input.sha256 !== null && !/^[0-9a-f]{64}$/i.test(input.sha256)) || !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0 || input.sizeBytes > 50 * 1024 * 1024 || (input.relativeRef !== null && (input.relativeRef.length > 240 || input.relativeRef.startsWith('/') || input.relativeRef.includes('..') || input.relativeRef.includes('\\')))) throw new ControlPlaneWorkerError('Worker artifact is invalid', 'PAYLOAD_INVALID');
    const response = await this.post(`/control/tasks/${taskId}/artifact`, { schemaVersion: 1, deviceId: identity.deviceId, kind: input.kind, name: input.name, sha256: input.sha256, sizeBytes: input.sizeBytes, relativeRef: input.relativeRef });
    return boundedTask(response);
  }

  async centralExecutionPacket(executionId: string): Promise<CentralExecutionPacket> {
    if (!UUID_V4.test(executionId)) throw new ControlPlaneWorkerError('Central execution reference is invalid', 'PAYLOAD_INVALID');
    const response = await this.get(`/control/worker/executions/${executionId}/packet`, true);
    const item = response.execution;
    if (!item || typeof item !== 'object' || Array.isArray(item) || String((item as Record<string, unknown>).executionId) !== executionId || !UUID_V4.test(String((item as Record<string, unknown>).taskId)) || !UUID_V4.test(String((item as Record<string, unknown>).projectId)) || !UUID_V4.test(String((item as Record<string, unknown>).vaultRevisionId)) || typeof response.ownerProtocol !== 'string' || response.ownerProtocol.length < 1 || response.ownerProtocol.length > 8_000) throw new ControlPlaneWorkerError('Central execution packet is invalid', 'RESPONSE_INVALID');
    return { executionId, taskId: String((item as Record<string, unknown>).taskId), projectId: String((item as Record<string, unknown>).projectId), vaultRevisionId: String((item as Record<string, unknown>).vaultRevisionId), ownerProtocol: response.ownerProtocol };
  }

  async materializeCentralExecutionWorkspace(executionId: string, root: string): Promise<CentralExecutionPacket & { workspace: string }> {
    const packet = await this.centralExecutionPacket(executionId); const workspace = join(root, executionId); const archive = join(root, `${executionId}.zip`);
    await mkdir(root, { recursive: true, mode: 0o700 }); await rm(workspace, { recursive: true, force: true }); await rm(archive, { force: true });
    try { await this.download(`/control/worker/executions/${executionId}/workspace`, archive); await extractVaultWorkspaceArchive(archive, workspace); return { ...packet, workspace }; }
    catch (error) { await rm(workspace, { recursive: true, force: true }); throw error; }
    finally { await rm(archive, { force: true }); }
  }

  async uploadProjectSource(projectId: string, sourceRevision: string, archive: string): Promise<Record<string, unknown>> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    if (!UUID_V4.test(projectId) || !/^[0-9a-f]{40,64}$/i.test(sourceRevision)) throw new ControlPlaneWorkerError('Project source identity is invalid', 'PAYLOAD_INVALID');
    const info = await stat(archive); if (!info.isFile() || info.size < 1 || info.size > 1024 * 1024 * 1024) throw new ControlPlaneWorkerError('Project source archive is invalid', 'PAYLOAD_INVALID');
    const token = await this.credentialStore.get(DEVICE_TOKEN_CREDENTIAL_KEY); if (!token) throw new ControlPlaneWorkerError('Worker is not enrolled', 'DEVICE_NOT_ENROLLED');
    const response = await this.fetchImpl(new URL(`/api/v1/control/worker/projects/${projectId}/source/${sourceRevision.toLowerCase()}`, this.root), { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/zip', 'Content-Length': String(info.size), Authorization: `Bearer ${token}`, 'X-AWH-Device': identity.deviceId }, body: createReadStream(archive) as unknown as BodyInit, duplex: 'half' as never, credentials: 'omit', cache: 'no-store' } as RequestInit);
    const body = await response.text(); if (body.length > MAX_RESPONSE_BYTES) throw new ControlPlaneWorkerError('Worker response is too large', 'RESPONSE_TOO_LARGE'); let value: unknown; try { value = JSON.parse(body); } catch { throw new ControlPlaneWorkerError('Worker response is invalid', 'RESPONSE_INVALID'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ControlPlaneWorkerError('Worker response is invalid', 'RESPONSE_INVALID'); const result = value as Record<string, unknown>;
    if (!response.ok) throw new ControlPlaneWorkerError(typeof result.message === 'string' ? result.message : 'Project source was rejected', typeof result.code === 'string' ? result.code : 'WORKER_REJECTED');
    return result;
  }

  async uploadCentralExecutionCandidate(executionId: string, archive: string): Promise<WorkerTask> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir); if (!UUID_V4.test(executionId)) throw new ControlPlaneWorkerError('Central execution reference is invalid', 'PAYLOAD_INVALID');
    const info = await stat(archive); if (!info.isFile() || info.size < 1 || info.size > 1024 * 1024 * 1024) throw new ControlPlaneWorkerError('Central candidate archive is invalid', 'PAYLOAD_INVALID');
    const token = await this.credentialStore.get(DEVICE_TOKEN_CREDENTIAL_KEY); if (!token) throw new ControlPlaneWorkerError('Worker is not enrolled', 'DEVICE_NOT_ENROLLED');
    const response = await this.fetchImpl(new URL(`/api/v1/control/worker/executions/${executionId}/candidate`, this.root), { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/octet-stream', 'Content-Length': String(info.size), Authorization: `Bearer ${token}`, 'X-AWH-Device': identity.deviceId }, body: createReadStream(archive) as unknown as BodyInit, duplex: 'half' as never, credentials: 'omit', cache: 'no-store' } as RequestInit);
    const body = await response.text(); if (body.length > MAX_RESPONSE_BYTES) throw new ControlPlaneWorkerError('Worker response is too large', 'RESPONSE_TOO_LARGE'); let value: unknown; try { value = JSON.parse(body); } catch { throw new ControlPlaneWorkerError('Worker response is invalid', 'RESPONSE_INVALID'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ControlPlaneWorkerError('Worker response is invalid', 'RESPONSE_INVALID'); const result = value as Record<string, unknown>;
    if (!response.ok) throw new ControlPlaneWorkerError(typeof result.message === 'string' ? result.message : 'Worker candidate was rejected', typeof result.code === 'string' ? result.code : 'WORKER_REJECTED'); return boundedTask(result);
  }

  async officeExecutionPacket(executionId: string): Promise<OfficeExecutionPacket> {
    if (!UUID_V4.test(executionId)) throw new ControlPlaneWorkerError('Office execution reference is invalid', 'PAYLOAD_INVALID');
    const response = await this.get(`/control/worker/executions/${executionId}/office-packet`, true);
    const item = response.execution;
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ControlPlaneWorkerError('Office execution packet is invalid', 'RESPONSE_INVALID');
    const row = item as Record<string, unknown>;
    if (row.executionId !== executionId || !UUID_V4.test(String(row.taskId)) || !UUID_V4.test(String(row.projectId)) || typeof row.inputName !== 'string' || row.inputName.length < 1 || row.inputName.length > 160 || typeof row.inputMimeType !== 'string' || !Number.isSafeInteger(row.sizeBytes) || Number(row.sizeBytes) < 1 || Number(row.sizeBytes) > 50 * 1024 * 1024) throw new ControlPlaneWorkerError('Office execution packet is invalid', 'RESPONSE_INVALID');
    return { executionId, taskId: String(row.taskId), projectId: String(row.projectId), inputName: row.inputName, inputMimeType: row.inputMimeType, sizeBytes: Number(row.sizeBytes) };
  }

  async materializeOfficeExecutionInput(executionId: string, root: string): Promise<OfficeExecutionPacket & { inputPath: string }> {
    const packet = await this.officeExecutionPacket(executionId);
    const safe = packet.inputName.replace(/[\\/\u0000-\u001f\u007f]/g, '_');
    const inputPath = join(root, `${executionId}-${safe}`);
    await mkdir(root, { recursive: true, mode: 0o700 }); await rm(inputPath, { force: true });
    await this.downloadExecutionFile(`/control/worker/executions/${executionId}/office-input`, inputPath, packet.sizeBytes, 'application/octet-stream');
    return { ...packet, inputPath };
  }

  async uploadOfficeExecutionArtifact(executionId: string, pdfPath: string): Promise<WorkerTask> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir); if (!UUID_V4.test(executionId)) throw new ControlPlaneWorkerError('Office execution reference is invalid', 'PAYLOAD_INVALID');
    const info = await stat(pdfPath); if (!info.isFile() || info.size < 5 || info.size > 50 * 1024 * 1024) throw new ControlPlaneWorkerError('Office PDF artifact is invalid', 'PAYLOAD_INVALID');
    const token = await this.credentialStore.get(DEVICE_TOKEN_CREDENTIAL_KEY); if (!token) throw new ControlPlaneWorkerError('Worker is not enrolled', 'DEVICE_NOT_ENROLLED');
    const response = await this.fetchImpl(new URL(`/api/v1/control/worker/executions/${executionId}/office-artifact`, this.root), { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/pdf', 'Content-Length': String(info.size), Authorization: `Bearer ${token}`, 'X-AWH-Device': identity.deviceId }, body: createReadStream(pdfPath) as unknown as BodyInit, duplex: 'half' as never, credentials: 'omit', cache: 'no-store' } as RequestInit);
    const body = await response.text(); if (body.length > MAX_RESPONSE_BYTES) throw new ControlPlaneWorkerError('Worker response is too large', 'RESPONSE_TOO_LARGE'); let value: unknown; try { value = JSON.parse(body); } catch { throw new ControlPlaneWorkerError('Worker response is invalid', 'RESPONSE_INVALID'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ControlPlaneWorkerError('Worker response is invalid', 'RESPONSE_INVALID'); const result = value as Record<string, unknown>;
    if (!response.ok) throw new ControlPlaneWorkerError(typeof result.message === 'string' ? result.message : 'Office artifact was rejected', typeof result.code === 'string' ? result.code : 'WORKER_REJECTED'); return boundedTask(result);
  }

  async deferCentralExecution(executionId: string, code: string): Promise<WorkerTask> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir); if (!UUID_V4.test(executionId) || !/^[A-Z][A-Z0-9_]{2,79}$/.test(code)) throw new ControlPlaneWorkerError('Central execution deferral is invalid', 'PAYLOAD_INVALID');
    const response = await this.post(`/control/worker/executions/${executionId}/defer`, { schemaVersion: 1, deviceId: identity.deviceId, code }, true); return boundedTask(response);
  }

  async projects(): Promise<WorkerProject[]> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    const response = await this.get(`/control/worker/projects/${identity.deviceId}`);
    if (response.schemaVersion !== 1 || !Array.isArray(response.projects) || response.projects.length > 200) throw new ControlPlaneWorkerError('Worker project response is invalid', 'RESPONSE_INVALID');
    return response.projects.map((value): WorkerProject => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ControlPlaneWorkerError('Worker project response is invalid', 'RESPONSE_INVALID');
      const item = value as Record<string, unknown>;
      if (typeof item.projectId !== 'string' || !UUID_V4.test(item.projectId) || typeof item.name !== 'string' || item.name.length < 1 || item.name.length > 120 || typeof item.type !== 'string' || item.type.length < 1 || item.type.length > 32 || (item.sourceRevision !== null && typeof item.sourceRevision !== 'string') || typeof item.vaultReady !== 'boolean') throw new ControlPlaneWorkerError('Worker project response is invalid', 'RESPONSE_INVALID');
      return { projectId: item.projectId, name: item.name, type: item.type, sourceRevision: item.sourceRevision === null ? null : item.sourceRevision as string, vaultReady: item.vaultReady };
    });
  }

  async readResults(): Promise<{ results: WorkerTask[]; artifacts: Array<Record<string, unknown>>; approvals: Array<Record<string, unknown>> }> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    const response = await this.get(`/control/worker/results/${identity.deviceId}`);
    if (response.schemaVersion !== 1 || !Array.isArray(response.results) || !Array.isArray(response.artifacts) || !Array.isArray(response.approvals)) throw new ControlPlaneWorkerError('Worker results response is invalid', 'RESPONSE_INVALID');
    return { results: response.results.map(boundedTask), artifacts: response.artifacts.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))).slice(0, 100), approvals: response.approvals.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))).slice(0, 50) };
  }

  async readConversation(projectId: string): Promise<WorkerConversation> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    if (!UUID_V4.test(projectId)) throw new ControlPlaneWorkerError('Project identity is invalid', 'PAYLOAD_INVALID');
    const response = await this.get(`/control/worker/conversations/${identity.deviceId}/${projectId}`);
    if (typeof response.schemaVersion !== 'number' || ![1, 2, 3].includes(response.schemaVersion)) throw new ControlPlaneWorkerError('Worker conversation response is invalid', 'RESPONSE_INVALID');
    return boundedConversation(response);
  }

  async submitConversation(projectId: string, message: string, idempotencyKey: string): Promise<WorkerConversation> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    if (!UUID_V4.test(projectId) || typeof message !== 'string' || message.trim().length < 1 || message.length > 2_000 || !/^[A-Za-z0-9._-]{8,120}$/.test(idempotencyKey)) throw new ControlPlaneWorkerError('Worker conversation input is invalid', 'PAYLOAD_INVALID');
    const response = await this.post('/control/worker/conversations', { schemaVersion: 1, deviceId: identity.deviceId, projectId, message: message.trim(), idempotencyKey });
    if (typeof response.schemaVersion !== 'number' || ![1, 2, 3].includes(response.schemaVersion)) throw new ControlPlaneWorkerError('Worker conversation response is invalid', 'RESPONSE_INVALID');
    return boundedConversation(response);
  }

  async workspace(projectId: string): Promise<WorkerWorkspace> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    if (!UUID_V4.test(projectId)) throw new ControlPlaneWorkerError('Project identity is invalid', 'PAYLOAD_INVALID');
    const response = await this.get(`/control/worker/workspaces/${identity.deviceId}/${projectId}`);
    if (response.schemaVersion !== 1) throw new ControlPlaneWorkerError('Workspace response is invalid', 'RESPONSE_INVALID');
    return boundedWorkspace(response);
  }

  /**
   * Publishes only portable binding metadata. In particular, a local path is
   * deliberately not accepted by this boundary: each trusted device owns its
   * own path mapping for the one canonical Hub project.
   */
  async registerProjectBinding(projectId: string, workspaceLabel: string, capabilities: string[], sourceFingerprint: string | null = null): Promise<void> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    if (!UUID_V4.test(projectId) || typeof workspaceLabel !== 'string' || !workspaceLabel.trim() || workspaceLabel.trim().length > 120 || /[\\/\u0000-\u001f\u007f]/.test(workspaceLabel) || !Array.isArray(capabilities) || capabilities.length > 24 || capabilities.some((value) => typeof value !== 'string' || !CAPABILITY.test(value)) || (sourceFingerprint !== null && !/^[0-9a-f]{40,64}$/i.test(sourceFingerprint))) throw new ControlPlaneWorkerError('Project binding is invalid', 'PAYLOAD_INVALID');
    const response = await this.post('/control/worker/projects/bindings', { schemaVersion: 2, deviceId: identity.deviceId, projectId, workspaceLabel: workspaceLabel.trim(), sourceFingerprint, capabilities: [...new Set(capabilities)] });
    if (response.schemaVersion !== 2 || !response.binding || typeof response.binding !== 'object') throw new ControlPlaneWorkerError('Project binding response is invalid', 'RESPONSE_INVALID');
  }

  async registerProject(project: { projectId: string; name: string; type: string; sourceRevision: string | null; source?: { provider: 'GITHUB'; repository: string; ref: string | null } | null }): Promise<void> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    const source = project.source ?? null;
    if (!project || !UUID_V4.test(project.projectId) || typeof project.name !== 'string' || !project.name.trim() || project.name.trim().length > 120 || /[\\/\u0000-\u001f\u007f]/.test(project.name) || typeof project.type !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(project.type) || (project.sourceRevision !== null && !/^[0-9a-f]{40,64}$/i.test(project.sourceRevision)) || (source !== null && (source.provider !== 'GITHUB' || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(source.repository) || (source.ref !== null && (!/^[A-Za-z0-9._\/-]{1,160}$/.test(source.ref) || source.ref.includes('..')))))) throw new ControlPlaneWorkerError('Project registration is invalid', 'PAYLOAD_INVALID');
    const legacy = { schemaVersion: 2, deviceId: identity.deviceId, project: { projectId: project.projectId, name: project.name.trim(), type: project.type, sourceRevision: project.sourceRevision } };
    if (source === null) { const response = await this.post('/control/worker/projects/register', legacy); if (response.schemaVersion !== 2 || !response.project || typeof response.project !== 'object') throw new ControlPlaneWorkerError('Project registration response is invalid', 'RESPONSE_INVALID'); return; }
    try {
      const response = await this.post('/control/worker/projects/register', { schemaVersion: 3, deviceId: identity.deviceId, project: { ...legacy.project, source } });
      if (response.schemaVersion !== 3 || !response.project || typeof response.project !== 'object') throw new ControlPlaneWorkerError('Project registration response is invalid', 'RESPONSE_INVALID');
    } catch (error) {
      if (!(error instanceof ControlPlaneWorkerError) || !['SCHEMA_VERSION','SCHEMA_FIELDS','PAYLOAD_INVALID'].includes(error.code)) throw error;
      const response = await this.post('/control/worker/projects/register', legacy);
      if (response.schemaVersion !== 2 || !response.project || typeof response.project !== 'object') throw new ControlPlaneWorkerError('Project registration response is invalid', 'RESPONSE_INVALID');
    }
  }

  async publishProjectMemory(projectId: string, files: Array<{ name: string; status: 'present' | 'missing'; sha256: string | null; sizeBytes: number }>): Promise<void> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    const expected = new Set(['PROJECT.md', 'HANDOFF.md', 'TASKS.md', 'ARCHITECTURE.md', 'DECISIONS.md']);
    if (!UUID_V4.test(projectId) || !Array.isArray(files) || files.length !== expected.size || new Set(files.map((file) => file.name)).size !== expected.size || files.some((file) => !expected.has(file.name) || !['present', 'missing'].includes(file.status) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0 || file.sizeBytes > 32 * 1024 || (file.status === 'present' ? (typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(file.sha256)) : (file.sha256 !== null || file.sizeBytes !== 0)))) throw new ControlPlaneWorkerError('Project memory metadata is invalid', 'PAYLOAD_INVALID');
    const response = await this.post('/control/worker/projects/memory', { schemaVersion: 1, deviceId: identity.deviceId, projectId, files });
    if (response.schemaVersion !== 1 || response.projectId !== projectId || typeof response.memoryReady !== 'boolean') throw new ControlPlaneWorkerError('Project memory metadata response is invalid', 'RESPONSE_INVALID');
  }

  async publishWorkspaceCheckpoint(checkpoint: WorkspaceWipCheckpoint): Promise<WorkerWorkspace> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    if (checkpoint.schemaVersion !== 1 || checkpoint.sourceDeviceId !== identity.deviceId || !UUID_V4.test(checkpoint.projectId) || !UUID_V4.test(checkpoint.checkpointId) || (checkpoint.taskId !== null && !UUID_V4.test(checkpoint.taskId))) throw new ControlPlaneWorkerError('Workspace checkpoint is invalid', 'PAYLOAD_INVALID');
    const response = await this.post('/control/worker/workspaces/checkpoints', { schemaVersion: 1, checkpointId: checkpoint.checkpointId, deviceId: identity.deviceId, projectId: checkpoint.projectId, taskId: checkpoint.taskId, baseRevision: checkpoint.baseRevision, wipRevision: checkpoint.wipRevision, wipRef: checkpoint.wipRef, treeRevision: checkpoint.treeRevision, files: checkpoint.files, artifactRefs: checkpoint.artifactRefs, syncState: checkpoint.syncState });
    if (response.schemaVersion !== 1) throw new ControlPlaneWorkerError('Workspace response is invalid', 'RESPONSE_INVALID');
    return boundedWorkspace(response);
  }

  async claimWorkspaceLease(projectId: string, checkpointId: string | null): Promise<WorkerWorkspace> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    if (!UUID_V4.test(projectId) || (checkpointId !== null && !UUID_V4.test(checkpointId))) throw new ControlPlaneWorkerError('Workspace lease is invalid', 'PAYLOAD_INVALID');
    const response = await this.post('/control/worker/workspaces/leases/claim', { schemaVersion: 1, deviceId: identity.deviceId, projectId, checkpointId });
    if (response.schemaVersion !== 1) throw new ControlPlaneWorkerError('Workspace response is invalid', 'RESPONSE_INVALID');
    return boundedWorkspace(response);
  }

  async renewWorkspaceLease(projectId: string): Promise<WorkerWorkspace> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    if (!UUID_V4.test(projectId)) throw new ControlPlaneWorkerError('Project identity is invalid', 'PAYLOAD_INVALID');
    const response = await this.post('/control/worker/workspaces/leases/renew', { schemaVersion: 1, deviceId: identity.deviceId, projectId });
    if (response.schemaVersion !== 1) throw new ControlPlaneWorkerError('Workspace response is invalid', 'RESPONSE_INVALID');
    return boundedWorkspace(response);
  }

  async releaseWorkspaceLease(projectId: string): Promise<WorkerWorkspace> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    if (!UUID_V4.test(projectId)) throw new ControlPlaneWorkerError('Project identity is invalid', 'PAYLOAD_INVALID');
    const response = await this.post('/control/worker/workspaces/leases/release', { schemaVersion: 1, deviceId: identity.deviceId, projectId });
    if (response.schemaVersion !== 1) throw new ControlPlaneWorkerError('Workspace response is invalid', 'RESPONSE_INVALID');
    return boundedWorkspace(response);
  }

  /** Open a short-lived owner reset link without returning the token to the renderer. */
  async issueOwnerPasswordResetLink(): Promise<OwnerPasswordResetLink> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    const response = await this.post('/control/owner/password-reset-link', { schemaVersion: 1, deviceId: identity.deviceId });
    if (response.schemaVersion !== 1 || typeof response.resetPath !== 'string' || !/^\/#awh-reset=[A-Za-z0-9_-]{43}$/.test(response.resetPath) || typeof response.expiresAt !== 'string' || !Number.isFinite(Date.parse(response.expiresAt))) throw new ControlPlaneWorkerError('Owner reset response is invalid', 'RESPONSE_INVALID');
    return { resetPath: response.resetPath, expiresAt: response.expiresAt };
  }

  private async post(path: string, payload: Record<string, unknown>, centralExecution = false): Promise<Record<string, unknown>> {
    if (!path.startsWith('/control/') || path.includes('..') || /[?#]/.test(path)) throw new ControlPlaneWorkerError('Worker route is invalid', 'ROUTE_INVALID');
    const token = await this.credentialStore.get(DEVICE_TOKEN_CREDENTIAL_KEY);
    if (!token) throw new ControlPlaneWorkerError('Worker is not enrolled', 'DEVICE_NOT_ENROLLED');
    const identity = centralExecution ? await loadOrCreateDeviceIdentity(this.dataDir) : null;
    const response = await this.fetchImpl(new URL(`/api/v1${path}`, this.root), { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(identity ? { 'X-AWH-Device': identity.deviceId } : {}) }, body: JSON.stringify(payload), credentials: 'omit', cache: 'no-store' });
    const body = await response.text();
    if (body.length > MAX_RESPONSE_BYTES) throw new ControlPlaneWorkerError('Worker response is too large', 'RESPONSE_TOO_LARGE');
    let value: unknown;
    try { value = JSON.parse(body); } catch { throw new ControlPlaneWorkerError('Worker response is invalid', 'RESPONSE_INVALID'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ControlPlaneWorkerError('Worker response is invalid', 'RESPONSE_INVALID');
    const result = value as Record<string, unknown>;
    if (!response.ok) throw new ControlPlaneWorkerError(typeof result.message === 'string' ? result.message : 'Worker request was rejected', typeof result.code === 'string' ? result.code : 'WORKER_REJECTED');
    return result;
  }

  private async get(path: string, centralExecution = false): Promise<Record<string, unknown>> {
    if (!path.startsWith('/control/') || path.includes('..') || /[?#]/.test(path)) throw new ControlPlaneWorkerError('Worker route is invalid', 'ROUTE_INVALID');
    const token = await this.credentialStore.get(DEVICE_TOKEN_CREDENTIAL_KEY);
    if (!token) throw new ControlPlaneWorkerError('Worker is not enrolled', 'DEVICE_NOT_ENROLLED');
    const identity = centralExecution ? await loadOrCreateDeviceIdentity(this.dataDir) : null;
    const response = await this.fetchImpl(new URL(`/api/v1${path}`, this.root), { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(identity ? { 'X-AWH-Device': identity.deviceId } : {}) }, credentials: 'omit', cache: 'no-store' });
    const body = await response.text();
    if (body.length > MAX_RESPONSE_BYTES) throw new ControlPlaneWorkerError('Worker response is too large', 'RESPONSE_TOO_LARGE');
    let value: unknown; try { value = JSON.parse(body); } catch { throw new ControlPlaneWorkerError('Worker response is invalid', 'RESPONSE_INVALID'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ControlPlaneWorkerError('Worker response is invalid', 'RESPONSE_INVALID');
    const result = value as Record<string, unknown>;
    if (!response.ok) throw new ControlPlaneWorkerError(typeof result.message === 'string' ? result.message : 'Worker request was rejected', typeof result.code === 'string' ? result.code : 'WORKER_REJECTED');
    return result;
  }

  private async downloadExecutionFile(path: string, destination: string, expectedBytes: number, accept: string): Promise<void> {
    if (!path.startsWith('/control/worker/executions/') || path.includes('..') || /[?#]/.test(path) || !Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > 50 * 1024 * 1024 || typeof accept !== 'string' || accept.length < 1 || accept.length > 120) throw new ControlPlaneWorkerError('Worker execution download is invalid', 'PAYLOAD_INVALID');
    const token = await this.credentialStore.get(DEVICE_TOKEN_CREDENTIAL_KEY); const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    if (!token) throw new ControlPlaneWorkerError('Worker is not enrolled', 'DEVICE_NOT_ENROLLED');
    const response = await this.fetchImpl(new URL(`/api/v1${path}`, this.root), { method: 'GET', headers: { Accept: accept, Authorization: `Bearer ${token}`, 'X-AWH-Device': identity.deviceId }, credentials: 'omit', cache: 'no-store' });
    const length = Number(response.headers.get('content-length'));
    if (!response.ok || !response.body || !Number.isSafeInteger(length) || length !== expectedBytes) throw new ControlPlaneWorkerError('Worker execution download was rejected', 'WORKSPACE_DOWNLOAD_FAILED');
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    try { await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(destination, { flags: 'wx', mode: 0o600 })); const info = await stat(destination); if (!info.isFile() || info.size !== expectedBytes) throw new ControlPlaneWorkerError('Worker execution download is incomplete', 'WORKSPACE_DOWNLOAD_FAILED'); }
    catch (error) { await rm(destination, { force: true }); throw error; }
  }

  private async download(path: string, destination: string): Promise<void> {
    if (!path.startsWith('/control/worker/executions/') || path.includes('..') || /[?#]/.test(path)) throw new ControlPlaneWorkerError('Worker route is invalid', 'ROUTE_INVALID');
    const token = await this.credentialStore.get(DEVICE_TOKEN_CREDENTIAL_KEY); const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    if (!token) throw new ControlPlaneWorkerError('Worker is not enrolled', 'DEVICE_NOT_ENROLLED');
    const response = await this.fetchImpl(new URL(`/api/v1${path}`, this.root), { method: 'GET', headers: { Accept: 'application/zip', Authorization: `Bearer ${token}`, 'X-AWH-Device': identity.deviceId }, credentials: 'omit', cache: 'no-store' });
    const length = Number(response.headers.get('content-length')); if (!response.ok || !response.body || !Number.isSafeInteger(length) || length < 1 || length > 1024 * 1024 * 1024) throw new ControlPlaneWorkerError('Central workspace download was rejected', 'WORKSPACE_DOWNLOAD_FAILED');
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    try { await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(destination, { flags: 'wx', mode: 0o600 })); const info = await stat(destination); if (info.size !== length) throw new ControlPlaneWorkerError('Central workspace download is incomplete', 'WORKSPACE_DOWNLOAD_FAILED'); }
    catch (error) { await rm(destination, { force: true }); throw error; }
  }
}

export function isWorkerDeviceIdentity(identity: DeviceIdentity): boolean { return UUID_V4.test(identity.deviceId) && ['darwin', 'win32', 'linux'].includes(identity.platform); }
