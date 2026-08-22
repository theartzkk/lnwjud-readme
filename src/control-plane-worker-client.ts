import { CredentialStore, DEVICE_TOKEN_CREDENTIAL_KEY } from './credential-store.js';
import { DeviceIdentity, loadOrCreateDeviceIdentity } from './device-identity.js';

const MAX_RESPONSE_BYTES = 64 * 1024;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY = /^[a-z][a-z0-9:._-]{0,63}$/;
const STATE = new Set(['READY', 'WORKING', 'OFFLINE']);
const TASK_STATE = new Set(['PREPARING', 'RUNNING', 'QA', 'WAITING_FOR_APPROVAL', 'COMPLETED', 'FAILED']);

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
