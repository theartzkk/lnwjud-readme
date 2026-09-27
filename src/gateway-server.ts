import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { ControlPlaneWorkerClient, WorkerPeer, WorkerProject, WorkerConversation } from './control-plane-worker-client.js';

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

function runnable(device: WorkerPeer): boolean {
  return device.routingEnabled && ['ONLINE', 'BUSY'].includes(device.activity) && !['OFFLINE', 'STALE'].includes(device.state);
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
      const [devices, projects] = await Promise.all([client.devices(), client.projects()]);
      const device = devices.find((d) => d.deviceId.toLowerCase() === targetDeviceId.toLowerCase());
      if (!device) return text({ ok: false, error: 'DEVICE_NOT_FOUND' }, true);
      if (!device.routingEnabled) return text({ ok: false, error: 'DEVICE_ROUTING_DISABLED', deviceId: device.deviceId }, true);
      if (!runnable(device)) return text({ ok: false, error: 'DEVICE_NOT_ONLINE', deviceId: device.deviceId, state: device.state, activity: device.activity, lastSeenAt: device.lastSeenAt }, true);
      if (!projects.some((p) => p.projectId.toLowerCase() === projectId.toLowerCase())) return text({ ok: false, error: 'PROJECT_NOT_AVAILABLE', projectId }, true);
      const goal = `บนเครื่องจริง ${device.displayName} เท่านั้น: ${instruction.trim()}`;
      const key = idempotencyKey ?? `gateway-${randomUUID()}`;
      const conversation = await client.submitConversation(projectId, goal, key, device.deviceId);
      const task = conversation.tasks.find((candidate) => candidate.projectId.toLowerCase() === projectId.toLowerCase() && candidate.goal === goal)
        ?? conversation.tasks.at(-1)
        ?? null;
      return text({ ok: true, target: { deviceId: device.deviceId, displayName: device.displayName }, task, idempotencyKey: key });
    } catch (error) { return safeError(error); }
  });

  server.registerTool('device_task_status', {
    description: 'Read current status of one AWH task in one project without starting new work.',
    inputSchema: z.object({ projectId: z.string().uuid(), taskId: z.string().uuid() }),
  }, async ({ projectId, taskId }) => {
    try {
      const conversation = await client.readConversation(projectId);
      const task = conversation.tasks.find((candidate) => candidate.taskId.toLowerCase() === taskId.toLowerCase());
      if (!task) return text({ ok: false, error: 'TASK_NOT_FOUND', taskId }, true);
      return text({ ok: true, task });
    } catch (error) { return safeError(error); }
  });

  return server;
}
