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

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const ISO_INSTANT_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const COMMAND_ACTION_SET = new Set<string>(COMMAND_ACTIONS);
const RISK_CLASS_SET = new Set<string>(['routine', 'production']);
const APPROVAL_SET = new Set<string>(['not-required', 'pending', 'granted']);
const SOURCE_ADAPTER_SET = new Set<string>(['chatgpt-github-bridge', 'remote-mcp']);
const EXPECTED_KEYS = [
  'action',
  'approval',
  'jobId',
  'projectId',
  'repository',
  'requestedAt',
  'requestedBy',
  'revision',
  'riskClass',
  'schemaVersion',
].sort().join(',');
const PRODUCTION_ACTIONS = new Set<CommandAction>(['deploy_staging', 'deploy_production', 'rollback']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Command job ${key} is invalid`);
  return value;
}

export function expectedRiskClass(action: CommandAction): CommandRiskClass {
  return PRODUCTION_ACTIONS.has(action) ? 'production' : 'routine';
}

export function validateCommandJob(value: unknown): CommandJob {
  if (!isRecord(value)) throw new Error('Command job is invalid');
  if (Object.keys(value).sort().join(',') !== EXPECTED_KEYS) throw new Error('Command job contains unsupported fields');
  if (value.schemaVersion !== COMMAND_SCHEMA_VERSION) throw new Error('Command job schema version is invalid');

  const jobId = requiredString(value, 'jobId');
  const projectId = requiredString(value, 'projectId');
  const repository = requiredString(value, 'repository');
  const revision = requiredString(value, 'revision');
  const action = requiredString(value, 'action');
  const riskClass = requiredString(value, 'riskClass');
  const approval = requiredString(value, 'approval');
  const requestedAt = requiredString(value, 'requestedAt');
  const requestedBy = requiredString(value, 'requestedBy');

  if (!UUID_V4.test(jobId) || !UUID_V4.test(projectId)) throw new Error('Command job identity is invalid');
  if (!REPOSITORY.test(repository)) throw new Error('Command job repository is invalid');
  if (!GIT_SHA.test(revision)) throw new Error('Command job revision is invalid');
  if (!COMMAND_ACTION_SET.has(action)) throw new Error('Command job action is invalid');
  if (!RISK_CLASS_SET.has(riskClass)) throw new Error('Command job risk class is invalid');
  if (!APPROVAL_SET.has(approval)) throw new Error('Command job approval is invalid');
  if (!ISO_INSTANT_WITH_ZONE.test(requestedAt) || Number.isNaN(Date.parse(requestedAt))) throw new Error('Command job requestedAt is invalid');
  if (!SOURCE_ADAPTER_SET.has(requestedBy)) throw new Error('Command job source adapter is invalid');

  const parsed: CommandJob = {
    schemaVersion: COMMAND_SCHEMA_VERSION,
    jobId,
    projectId,
    repository,
    revision,
    action: action as CommandAction,
    riskClass: riskClass as CommandRiskClass,
    approval: approval as CommandApproval,
    requestedAt,
    requestedBy: requestedBy as CommandSourceAdapter,
  };

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
