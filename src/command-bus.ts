import * as z from 'zod/v4';

export const COMMAND_SCHEMA_VERSION = 1 as const;

export const COMMAND_ACTIONS = [
  'inspect',
  'sync_verify',
  'qa',
  'build',
  'package',
  'deploy_staging',
  'deploy_production',
  'rollback',
] as const;

export type CommandAction = (typeof COMMAND_ACTIONS)[number];
export type CommandRiskClass = 'routine' | 'production';
export type CommandApproval = 'not-required' | 'pending' | 'granted';
export type CommandSourceAdapter = 'chatgpt-github-bridge' | 'remote-mcp';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;

const commandJobSchema = z.object({
  schemaVersion: z.literal(COMMAND_SCHEMA_VERSION),
  jobId: z.string().regex(UUID_V4),
  projectId: z.string().regex(UUID_V4),
  repository: z.string().regex(REPOSITORY),
  revision: z.string().regex(GIT_SHA),
  action: z.enum(COMMAND_ACTIONS),
  riskClass: z.enum(['routine', 'production']),
  approval: z.enum(['not-required', 'pending', 'granted']),
  requestedAt: z.iso.datetime({ offset: true }),
  requestedBy: z.enum(['chatgpt-github-bridge', 'remote-mcp']),
}).strict();

export interface CommandJob {
  schemaVersion: 1;
  jobId: string;
  projectId: string;
  repository: string;
  revision: string;
  action: CommandAction;
  riskClass: CommandRiskClass;
  approval: CommandApproval;
  requestedAt: string;
  requestedBy: CommandSourceAdapter;
}

const PRODUCTION_ACTIONS = new Set<CommandAction>(['deploy_staging', 'deploy_production', 'rollback']);

export function expectedRiskClass(action: CommandAction): CommandRiskClass {
  return PRODUCTION_ACTIONS.has(action) ? 'production' : 'routine';
}

export function validateCommandJob(value: unknown): CommandJob {
  const parsed = commandJobSchema.parse(value) as CommandJob;
  const expectedRisk = expectedRiskClass(parsed.action);
  if (parsed.riskClass !== expectedRisk) throw new Error('Command job risk class does not match the requested action');
  if (expectedRisk === 'routine' && parsed.approval !== 'not-required') throw new Error('Routine command jobs must not carry an approval transition');
  if (expectedRisk === 'production' && parsed.approval === 'not-required') throw new Error('Production command jobs require an approval state');
  return parsed;
}

export function commandRequiresApproval(job: CommandJob): boolean {
  return expectedRiskClass(job.action) === 'production';
}

export function commandReadyForExecution(job: CommandJob): boolean {
  return !commandRequiresApproval(job) || job.approval === 'granted';
}
