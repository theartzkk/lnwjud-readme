export type ReleaseChannel = 'stable' | 'preview';
export type GateState = 'VERIFIED' | 'READY' | 'PASS' | 'UNVERIFIED' | 'MISSING' | 'FAILED';

export interface ReleaseEvidence {
  schemaVersion: 1;
  channel: ReleaseChannel;
  version: string;
  gitSha: string;
  databaseSchemaVersion: number;
  backup: GateState;
  restoreDrill: GateState;
  migrationPlan: GateState;
  rollbackPlan: GateState;
  hostKeyVerification: GateState;
}

export interface ReleaseReadiness {
  status: 'READY' | 'BLOCKED';
  reasons: string[];
}

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const GIT_SHA = /^[0-9a-f]{40}$/;

export function evaluateReleaseReadiness(value: unknown, expectedVersion: string, expectedGitSha: string): ReleaseReadiness {
  const reasons: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'BLOCKED', reasons: ['RELEASE_EVIDENCE_INVALID'] };
  const row = value as Partial<ReleaseEvidence>;
  if (row.schemaVersion !== 1) reasons.push('RELEASE_EVIDENCE_SCHEMA');
  if (row.channel !== 'stable' && row.channel !== 'preview') reasons.push('RELEASE_CHANNEL_INVALID');
  if (typeof row.version !== 'string' || !VERSION.test(row.version) || row.version !== expectedVersion) reasons.push('RELEASE_VERSION_MISMATCH');
  if (typeof row.gitSha !== 'string' || !GIT_SHA.test(row.gitSha) || row.gitSha !== expectedGitSha) reasons.push('RELEASE_SHA_MISMATCH');
  if (!Number.isInteger(row.databaseSchemaVersion) || Number(row.databaseSchemaVersion) < 1) reasons.push('DATABASE_SCHEMA_UNKNOWN');
  if (row.backup !== 'VERIFIED') reasons.push('BACKUP_NOT_VERIFIED');
  if (row.restoreDrill !== 'PASS') reasons.push('RESTORE_DRILL_NOT_PASSED');
  if (row.migrationPlan !== 'READY') reasons.push('MIGRATION_PLAN_NOT_READY');
  if (row.rollbackPlan !== 'READY') reasons.push('ROLLBACK_PLAN_NOT_READY');
  if (row.hostKeyVerification !== 'VERIFIED') reasons.push('HOST_KEY_NOT_VERIFIED');
  return { status: reasons.length === 0 ? 'READY' : 'BLOCKED', reasons };
}
