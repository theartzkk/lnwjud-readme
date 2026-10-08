import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { WorkerPeer, WorkerProject, WorkerConversation, WorkerTask } from './control-plane-worker-client.js';

export interface GatewayControlClient {
  devices(): Promise<WorkerPeer[]>;
  projects(): Promise<WorkerProject[]>;
  submitConversation(projectId: string, message: string, idempotencyKey: string, targetDeviceId?: string | null): Promise<WorkerConversation>;
  readConversation(projectId: string): Promise<WorkerConversation>;
}

function text(value: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
}

function safeError(error: unknown) {
  const value = error as { code?: unknown; message?: unknown };
  return text({ ok: false, error: typeof value?.code === 'string' ? value.code : 'AWH_GATEWAY_FAILED', message: typeof value?.message === 'string' ? value.message : 'AWH Gateway request failed' }, true);
}

const MAX_DEVICE_HEARTBEAT_AGE_MS = 5 * 60_000;
const MAX_DEVICE_CLOCK_SKEW_MS = 60_000;

function heartbeatFresh(lastSeenAt: string, nowMs = Date.now()): boolean {
  const seenAtMs = Date.parse(lastSeenAt);
  if (!Number.isFinite(seenAtMs)) return false;
  const ageMs = nowMs - seenAtMs;
  return ageMs >= -MAX_DEVICE_CLOCK_SKEW_MS && ageMs <= MAX_DEVICE_HEARTBEAT_AGE_MS;
}

function runnable(device: WorkerPeer): boolean {
  return device.routingEnabled && ['ONLINE', 'BUSY'].includes(device.activity)
    && ['READY', 'WORKING'].includes(device.state) && heartbeatFresh(device.lastSeenAt);
}

/**
 * The Hub owns both the device registry and the pinned execution lease.
 * Never substitute a different device or infer success from a conversation
 * response that does not acknowledge the exact DEVICE execution.
 */
export async function queueExactDeviceAction(
  client: GatewayControlClient,
  input: { targetDeviceId: string; projectId: string; instruction: string; idempotencyKey?: string | undefined },
) {
  const { targetDeviceId, projectId, instruction, idempotencyKey } = input;
  const [devices, projects] = await Promise.all([client.devices(), client.projects()]);
  const device = devices.find((item) => item.deviceId.toLowerCase() === targetDeviceId.toLowerCase());
  if (!device) return { ok: false as const, error: 'DEVICE_NOT_FOUND' };
  if (!device.routingEnabled) return { ok: false as const, error: 'DEVICE_ROUTING_DISABLED', deviceId: device.deviceId };
  if (!['ONLINE', 'BUSY'].includes(device.activity) || !['READY', 'WORKING'].includes(device.state)) {
    return { ok: false as const, error: 'DEVICE_NOT_ONLINE', deviceId: device.deviceId, state: device.state, activity: device.activity, lastSeenAt: device.lastSeenAt };
  }
  if (!heartbeatFresh(device.lastSeenAt)) {
    return { ok: false as const, error: 'DEVICE_HEARTBEAT_STALE', deviceId: device.deviceId, lastSeenAt: device.lastSeenAt };
  }
  if (!projects.some((item) => item.projectId.toLowerCase() === projectId.toLowerCase())) return { ok: false as const, error: 'PROJECT_NOT_AVAILABLE', projectId };

  // The ID, not the (potentially duplicated) display name, is the routing identity.
  // Include it in the idempotent goal to distinguish devices sharing a name.
  const goal = `บนเครื่องจริง ${device.displayName} [deviceId:${device.deviceId}] เท่านั้น: ${instruction.trim()}`;
  const key = idempotencyKey ?? `gateway-${randomUUID()}`;
  const conversation = await client.submitConversation(projectId, goal, key, device.deviceId);
  const lastTaskId = conversation.conversation?.lastTaskId;
  const task = lastTaskId
    ? conversation.tasks.find((item) => item.taskId === lastTaskId)
    : undefined;
  if (!task || task.projectId.toLowerCase() !== projectId.toLowerCase() || task.goal !== goal) {
    return { ok: false as const, error: 'DEVICE_TASK_NOT_ACKNOWLEDGED', targetDeviceId: device.deviceId, idempotencyKey: key };
  }
  if (task.assignedDevice !== null && task.assignedDevice.toLowerCase() !== device.deviceId.toLowerCase()) {
    return { ok: false as const, error: 'DEVICE_TASK_TARGET_MISMATCH', targetDeviceId: device.deviceId, taskId: task.taskId };
  }
  if (task.execution?.executorKind !== 'DEVICE') {
    return { ok: false as const, error: 'DEVICE_EXECUTION_NOT_CONFIRMED', targetDeviceId: device.deviceId, taskId: task.taskId };
  }
  if (['FAILED', 'CANCELLED'].includes(task.state)) {
    return { ok: false as const, error: 'DEVICE_TASK_REJECTED', targetDeviceId: device.deviceId, taskId: task.taskId, state: task.state };
  }
  return { ok: true as const, queued: true, target: { deviceId: device.deviceId, displayName: device.displayName }, task, idempotencyKey: key };
}

/** Read-status must stay pinned to the same device as the original action. */
export function exactDeviceTaskStatus(
  task: WorkerTask | undefined,
  input: { projectId: string; taskId: string; targetDeviceId: string },
) {
  const targetDeviceId = input.targetDeviceId.toLowerCase();
  if (!task) return { ok: false as const, error: 'TASK_NOT_FOUND', taskId: input.taskId };
  const pinnedMarker = `[deviceId:${targetDeviceId}] เท่านั้น:`;
  if (task.projectId.toLowerCase() !== input.projectId.toLowerCase()
    || !task.goal.toLowerCase().includes(pinnedMarker.toLowerCase())
    || (task.assignedDevice !== null && task.assignedDevice.toLowerCase() !== targetDeviceId)) {
    return { ok: false as const, error: 'DEVICE_TASK_TARGET_MISMATCH', taskId: input.taskId, targetDeviceId };
  }
  if (task.execution?.executorKind !== 'DEVICE') {
    return { ok: false as const, error: 'DEVICE_EXECUTION_NOT_CONFIRMED', taskId: input.taskId, targetDeviceId };
  }
  if (['FAILED', 'CANCELLED'].includes(task.state)) {
    return { ok: false as const, error: 'DEVICE_TASK_REJECTED', taskId: input.taskId, targetDeviceId, state: task.state };
  }
  const targetVerified = task.assignedDevice !== null && task.assignedDevice.toLowerCase() === targetDeviceId;
  if (!targetVerified && ['RUNNING', 'COMPLETED'].includes(task.state)) {
    return { ok: false as const, error: 'DEVICE_TASK_TARGET_UNCONFIRMED', taskId: input.taskId, targetDeviceId, state: task.state };
  }
  return { ok: true as const, targetDeviceId, targetVerified, task };
}

export function createGatewayServer(client: GatewayControlClient): McpServer {
  const server = new McpServer({ name: 'AWH Agent', version: '1.0.0' });

  server.registerTool('gateway_health', {
    description: 'Check the AWH Agent Gateway and summarize enrolled device/project routing readiness.',
    inputSchema: z.object({}),
  }, async () => {
    try {
      const [devices, projects] = await Promise.all([client.devices(), client.projects()]);
      return text({
        ok: true,
        gateway: 'AWH Agent',
        devices: { total: devices.length, runnable: devices.filter(runnable).length },
        projects: projects.length,
      });
    } catch (error) { return safeError(error); }
  });

  server.registerTool('device_list', {
    description: 'List AWH-enrolled devices with current routing state and detected capabilities. Use this before selecting a device.',
    inputSchema: z.object({}),
  }, async () => {
    try {
      const devices = await client.devices();
      return text({ devices: devices.map((d) => ({
        deviceId: d.deviceId, displayName: d.displayName, platform: d.platform, arch: d.arch,
        state: d.state, activity: d.activity, routingEnabled: d.routingEnabled, role: d.role,
        capabilities: d.capabilities, detectedTools: d.detectedTools, workloads: d.workloads,
        purpose: d.purpose, lastSeenAt: d.lastSeenAt,
      })) });
    } catch (error) { return safeError(error); }
  });

  server.registerTool('project_list', {
    description: 'List canonical AWH projects available to this Gateway identity.',
    inputSchema: z.object({}),
  }, async () => {
    try { return text({ projects: await client.projects() }); }
    catch (error) { return safeError(error); }
  });

  server.registerTool('device_run', {
    description: 'Queue one bounded action on one exact AWH-enrolled device. The Hub remains authoritative for capability routing, approvals and execution policy.',
    inputSchema: z.object({
      targetDeviceId: z.string().uuid(),
      projectId: z.string().uuid(),
      instruction: z.string().min(1).max(5_000),
      idempotencyKey: z.string().regex(/^[A-Za-z0-9._-]{8,120}$/).optional(),
    }),
  }, async ({ targetDeviceId, projectId, instruction, idempotencyKey }) => {
    try {
      const result = await queueExactDeviceAction(client, { targetDeviceId, projectId, instruction, idempotencyKey });
      return text(result, !result.ok);
    } catch (error) { return safeError(error); }
  });

  server.registerTool('device_task_status', {
    description: 'Read one task for an exact AWH deviceId and project; rejects mismatched devices and unverified completed execution.',
    inputSchema: z.object({
      projectId: z.string().uuid(),
      taskId: z.string().uuid(),
      targetDeviceId: z.string().uuid(),
    }),
  }, async ({ projectId, taskId, targetDeviceId }) => {
    try {
      const conversation = await client.readConversation(projectId);
      const task = conversation.tasks.find((candidate) => candidate.taskId.toLowerCase() === taskId.toLowerCase());
      const status = exactDeviceTaskStatus(task, { projectId, taskId, targetDeviceId });
      return text(status, !status.ok);
    } catch (error) { return safeError(error); }
  });

  return server;
}
