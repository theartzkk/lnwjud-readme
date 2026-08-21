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
  goal: string;
  state: string;
  progress: number;
  assignedDevice: string | null;
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
  if (typeof task.taskId !== 'string' || !UUID_V4.test(task.taskId) || typeof task.projectId !== 'string' || !UUID_V4.test(task.projectId) || typeof task.goal !== 'string' || task.goal.length > 2_000 || typeof task.state !== 'string' || typeof task.progress !== 'number' || !Number.isInteger(task.progress) || task.progress < 0 || task.progress > 100 || (task.assignedDevice !== null && (typeof task.assignedDevice !== 'string' || !UUID_V4.test(task.assignedDevice)))) throw new ControlPlaneWorkerError('Worker task response is invalid', 'RESPONSE_INVALID');
  return { taskId: task.taskId, projectId: task.projectId, goal: task.goal, state: task.state, progress: task.progress, assignedDevice: task.assignedDevice };
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
}

export function isWorkerDeviceIdentity(identity: DeviceIdentity): boolean { return UUID_V4.test(identity.deviceId) && ['darwin', 'win32', 'linux'].includes(identity.platform); }
