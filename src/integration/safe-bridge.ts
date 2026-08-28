import { loadConfig, type ArtAgentConfig } from '../config.js';
import {
  ControlPlaneWorkerClient,
  type WorkerProject,
  type WorkerTask,
  type WorkerWorkspace,
} from '../control-plane-worker-client.js';
import {
  createDesktopCredentialStore,
  DEVICE_TOKEN_CREDENTIAL_KEY,
  type CredentialStore,
} from '../credential-store.js';
import { readDeviceIdentity, type DeviceIdentity } from '../device-identity.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SENSITIVE_KEY = /(token|secret|password|authorization|credential|cookie|api[_-]?key)/i;

export type SafeBridgeCommand =
  | { kind: 'capabilities' }
  | { kind: 'status' }
  | { kind: 'projects' }
  | { kind: 'results' }
  | { kind: 'workspace'; projectId: string };

export interface SafeBridgeWorkerClient {
  projects(): Promise<WorkerProject[]>;
  readResults(): Promise<{ results: WorkerTask[]; artifacts: Array<Record<string, unknown>>; approvals: Array<Record<string, unknown>> }>;
  workspace(projectId: string): Promise<WorkerWorkspace>;
}

export interface SafeBridgeRuntime {
  config: ArtAgentConfig;
  credentialStore: CredentialStore;
  device: DeviceIdentity | null;
  worker: SafeBridgeWorkerClient;
  now?: () => Date;
}

export interface SafeBridgeEnvelope {
  schemaVersion: 1;
  bridge: 'awh-safe-bridge';
  readOnly: true;
  command: SafeBridgeCommand['kind'];
  generatedAt: string;
  data: unknown;
}

export class SafeBridgeError extends Error {
  constructor(message: string, readonly code = 'SAFE_BRIDGE_INVALID') {
    super(message);
    this.name = 'SafeBridgeError';
  }
}

export function parseSafeBridgeArgs(args: readonly string[]): SafeBridgeCommand {
  if (args.length === 1 && args[0] === 'capabilities') return { kind: 'capabilities' };
  if (args.length === 1 && args[0] === 'status') return { kind: 'status' };
  if (args.length === 1 && args[0] === 'projects') return { kind: 'projects' };
  if (args.length === 1 && args[0] === 'results') return { kind: 'results' };
  if (args.length === 2 && args[0] === 'workspace' && UUID_V4.test(args[1] ?? '')) {
    return { kind: 'workspace', projectId: String(args[1]).toLowerCase() };
  }
  throw new SafeBridgeError('Only bounded read-only AWH bridge commands are allowed', 'COMMAND_NOT_ALLOWED');
}

export async function createSafeBridgeRuntime(): Promise<SafeBridgeRuntime> {
  const config = loadConfig();
  const credentialStore = createDesktopCredentialStore(config.dataDir);
  const device = await readDeviceIdentity(config.dataDir);
  const worker = new ControlPlaneWorkerClient(config.hubApiBase, config.dataDir, credentialStore);
  return { config, credentialStore, device, worker };
}

export async function executeSafeBridge(
  command: SafeBridgeCommand,
  runtime: SafeBridgeRuntime = await createSafeBridgeRuntime(),
): Promise<SafeBridgeEnvelope> {
  const generatedAt = (runtime.now ?? (() => new Date()))().toISOString();
  let data: unknown;

  switch (command.kind) {
    case 'capabilities':
      data = capabilityDocument();
      break;
    case 'status':
      data = await statusDocument(runtime);
      break;
    case 'projects':
      assertAuthenticatedReadReady(runtime);
      data = { projects: sanitize(await runtime.worker.projects()) };
      break;
    case 'results': {
      assertAuthenticatedReadReady(runtime);
      const result = await runtime.worker.readResults();
      data = {
        tasks: result.results.map(taskSummary),
        artifacts: sanitize(result.artifacts),
        approvals: sanitize(result.approvals),
      };
      break;
    }
    case 'workspace':
      assertAuthenticatedReadReady(runtime);
      data = { workspace: sanitize(await runtime.worker.workspace(command.projectId)) };
      break;
  }

  return {
    schemaVersion: 1,
    bridge: 'awh-safe-bridge',
    readOnly: true,
    command: command.kind,
    generatedAt,
    data,
  };
}

function capabilityDocument(): Record<string, unknown> {
  return {
    transportRole: 'bounded-read-adapter',
    commands: ['capabilities', 'status', 'projects', 'results', 'workspace <projectId>'],
    invariants: {
      rawShell: false,
      arbitraryPath: false,
      arbitraryUrl: false,
      write: false,
      execute: false,
      deploy: false,
      databaseMutation: false,
      providerApiKeyExposure: false,
    },
  };
}

async function statusDocument(runtime: SafeBridgeRuntime): Promise<Record<string, unknown>> {
  const enrolled = runtime.device !== null && Boolean(await runtime.credentialStore.get(DEVICE_TOKEN_CREDENTIAL_KEY));
  const base = {
    device: runtime.device
      ? {
          deviceId: runtime.device.deviceId,
          displayName: runtime.device.displayName,
          platform: runtime.device.platform,
          arch: runtime.device.arch,
        }
      : null,
    enrolled,
    hubAuthority: safeHubAuthority(runtime.config.hubApiBase),
    safety: capabilityDocument().invariants,
  };

  if (!enrolled) return { ...base, authenticatedRead: 'not-ready' };

  try {
    const [projects, result] = await Promise.all([runtime.worker.projects(), runtime.worker.readResults()]);
    return {
      ...base,
      authenticatedRead: 'ready',
      projectCount: projects.length,
      taskCount: result.results.length,
      pendingApprovalCount: result.approvals.length,
      activeTaskCount: result.results.filter((task) => !['COMPLETED', 'FAILED'].includes(task.state)).length,
    };
  } catch (error) {
    return {
      ...base,
      authenticatedRead: 'unreachable',
      error: safeErrorCode(error),
    };
  }
}

function taskSummary(task: WorkerTask): Record<string, unknown> {
  return {
    taskId: task.taskId,
    projectId: task.projectId,
    state: task.state,
    progress: task.progress,
    assignedDevice: task.assignedDevice,
    approvalStatus: task.approvalStatus,
    execution: task.execution
      ? {
          executionId: task.execution.executionId,
          executorKind: task.execution.executorKind,
          requiredCapability: task.execution.requiredCapability,
          state: task.execution.state,
        }
      : null,
  };
}

function assertAuthenticatedReadReady(runtime: SafeBridgeRuntime): void {
  if (runtime.device === null) throw new SafeBridgeError('AWH device is not enrolled', 'DEVICE_NOT_ENROLLED');
}

function safeHubAuthority(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'invalid';
  }
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    const code = (error as { code: string }).code;
    if (/^[A-Z][A-Z0-9_]{2,79}$/.test(code)) return code;
  }
  return 'SAFE_BRIDGE_READ_FAILED';
}

export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[bounded]';
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => sanitize(entry, depth + 1));
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && value.length > 4_000) return `${value.slice(0, 4_000)}…`;
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : sanitize(entry, depth + 1);
  }
  return output;
}
