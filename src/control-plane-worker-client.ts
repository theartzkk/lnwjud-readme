import { CredentialStore, DEVICE_TOKEN_CREDENTIAL_KEY } from './credential-store.js';
import { DeviceIdentity, loadOrCreateDeviceIdentity } from './device-identity.js';
import type { WorkspaceWipCheckpoint } from './workspace-continuity.js';

const MAX_RESPONSE_BYTES = 64 * 1024;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY = /^[a-z][a-z0-9:._-]{0,63}$/;
const STATE = new Set(['READY', 'WORKING', 'OFFLINE']);
const TASK_STATE = new Set(['WAITING_FOR_WORKER', 'PREPARING', 'RUNNING', 'QA', 'WAITING_FOR_APPROVAL', 'COMPLETED', 'FAILED']);

export class ControlPlaneWorkerError extends Error {
  constructor(message: string, readonly code = 'CONTROL_PLANE_WORKER_FAILED') { super(message); this.name = 'ControlPlaneWorkerError'; }
}

export interface WorkerTask {
  taskId: string;
  projectId: string;
  conversationId: string | null;
  goal: string;
  state: string;
  progress: number;
  assignedDevice: string | null;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | null;
}

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
  return { taskId: task.taskId, projectId: task.projectId, conversationId: task.conversationId === undefined || task.conversationId === null ? null : task.conversationId, goal: task.goal, state: task.state, progress: task.progress, assignedDevice: task.assignedDevice, approvalStatus: task.approvalStatus === undefined ? null : task.approvalStatus as WorkerTask['approvalStatus'] };
}

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
    if (response.schemaVersion !== 1) throw new ControlPlaneWorkerError('Worker conversation response is invalid', 'RESPONSE_INVALID');
    return boundedConversation(response);
  }

  async submitConversation(projectId: string, message: string, idempotencyKey: string): Promise<WorkerConversation> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    if (!UUID_V4.test(projectId) || typeof message !== 'string' || message.trim().length < 1 || message.length > 2_000 || !/^[A-Za-z0-9._-]{8,120}$/.test(idempotencyKey)) throw new ControlPlaneWorkerError('Worker conversation input is invalid', 'PAYLOAD_INVALID');
    const response = await this.post('/control/worker/conversations', { schemaVersion: 1, deviceId: identity.deviceId, projectId, message: message.trim(), idempotencyKey });
    if (response.schemaVersion !== 1) throw new ControlPlaneWorkerError('Worker conversation response is invalid', 'RESPONSE_INVALID');
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

  async registerProject(project: { projectId: string; name: string; type: string; sourceRevision: string | null }): Promise<void> {
    const identity = await loadOrCreateDeviceIdentity(this.dataDir);
    if (!project || !UUID_V4.test(project.projectId) || typeof project.name !== 'string' || !project.name.trim() || project.name.trim().length > 120 || /[\\/\u0000-\u001f\u007f]/.test(project.name) || typeof project.type !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(project.type) || (project.sourceRevision !== null && !/^[0-9a-f]{40,64}$/i.test(project.sourceRevision))) throw new ControlPlaneWorkerError('Project registration is invalid', 'PAYLOAD_INVALID');
    const response = await this.post('/control/worker/projects/register', { schemaVersion: 2, deviceId: identity.deviceId, project: { projectId: project.projectId, name: project.name.trim(), type: project.type, sourceRevision: project.sourceRevision } });
    if (response.schemaVersion !== 2 || !response.project || typeof response.project !== 'object') throw new ControlPlaneWorkerError('Project registration response is invalid', 'RESPONSE_INVALID');
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

  private async post(path: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!path.startsWith('/control/') || path.includes('..') || /[?#]/.test(path)) throw new ControlPlaneWorkerError('Worker route is invalid', 'ROUTE_INVALID');
    const token = await this.credentialStore.get(DEVICE_TOKEN_CREDENTIAL_KEY);
    if (!token) throw new ControlPlaneWorkerError('Worker is not enrolled', 'DEVICE_NOT_ENROLLED');
    const response = await this.fetchImpl(new URL(`/api/v1${path}`, this.root), { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload), credentials: 'omit', cache: 'no-store' });
    const body = await response.text();
    if (body.length > MAX_RESPONSE_BYTES) throw new ControlPlaneWorkerError('Worker response is too large', 'RESPONSE_TOO_LARGE');
    let value: unknown;
    try { value = JSON.parse(body); } catch { throw new ControlPlaneWorkerError('Worker response is invalid', 'RESPONSE_INVALID'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ControlPlaneWorkerError('Worker response is invalid', 'RESPONSE_INVALID');
    const result = value as Record<string, unknown>;
    if (!response.ok) throw new ControlPlaneWorkerError(typeof result.message === 'string' ? result.message : 'Worker request was rejected', typeof result.code === 'string' ? result.code : 'WORKER_REJECTED');
    return result;
  }

  private async get(path: string): Promise<Record<string, unknown>> {
    if (!path.startsWith('/control/') || path.includes('..') || /[?#]/.test(path)) throw new ControlPlaneWorkerError('Worker route is invalid', 'ROUTE_INVALID');
    const token = await this.credentialStore.get(DEVICE_TOKEN_CREDENTIAL_KEY);
    if (!token) throw new ControlPlaneWorkerError('Worker is not enrolled', 'DEVICE_NOT_ENROLLED');
    const response = await this.fetchImpl(new URL(`/api/v1${path}`, this.root), { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, credentials: 'omit', cache: 'no-store' });
    const body = await response.text();
    if (body.length > MAX_RESPONSE_BYTES) throw new ControlPlaneWorkerError('Worker response is too large', 'RESPONSE_TOO_LARGE');
    let value: unknown; try { value = JSON.parse(body); } catch { throw new ControlPlaneWorkerError('Worker response is invalid', 'RESPONSE_INVALID'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ControlPlaneWorkerError('Worker response is invalid', 'RESPONSE_INVALID');
    const result = value as Record<string, unknown>;
    if (!response.ok) throw new ControlPlaneWorkerError(typeof result.message === 'string' ? result.message : 'Worker request was rejected', typeof result.code === 'string' ? result.code : 'WORKER_REJECTED');
    return result;
  }
}

export function isWorkerDeviceIdentity(identity: DeviceIdentity): boolean { return UUID_V4.test(identity.deviceId) && ['darwin', 'win32', 'linux'].includes(identity.platform); }
