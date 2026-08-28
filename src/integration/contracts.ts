export const AWH_INTEGRATION_SCHEMA_VERSION = 1 as const;

export type IntegrationOrigin = 'chatgpt-mcp' | 'awh-web' | 'automation' | 'codex' | 'worker';
export type TrustTier = 'observe' | 'safe' | 'privileged' | 'break-glass';
export type TargetEnvironment = 'local' | 'preview' | 'staging' | 'production';
export type DataClass = 'public' | 'internal' | 'sensitive' | 'restricted';
export type MutationKind = 'READ' | 'CREATE' | 'REPLACE' | 'DELETE' | 'EXECUTE' | 'OPAQUE';
export type RiskClass = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type WorkspacePermission = 'read' | 'write' | 'execute';
export type PolicyDisposition = 'allow' | 'deny' | 'require-approval';

export interface IntegrationActor {
  userId: string;
  role: 'owner' | 'admin' | 'director' | 'teacher' | 'staff' | 'viewer';
  authenticated: boolean;
  deviceId?: string;
}

/**
 * AWH-native scope. Protocol-specific concepts such as MCP roots are adapters
 * into this contract and never become the workspace authority themselves.
 */
export interface WorkspaceScope {
  projectId: string;
  roots: string[];
  permissions: WorkspacePermission[];
  environment: TargetEnvironment;
}

export interface CapabilityDemand {
  capability: string;
  required: boolean;
  reason: string;
}

/**
 * Intent is an adapter input only. Existing AWH control_tasks and M12 durable
 * executions remain the task/execution authorities.
 */
export interface IntegrationIntent {
  schemaVersion: 1;
  intentId: string;
  origin: IntegrationOrigin;
  actor: IntegrationActor;
  projectId: string | null;
  goal: string;
  constraints: string[];
  expectedArtifacts: string[];
  acceptanceChecks: string[];
  capabilityDemands: CapabilityDemand[];
  requestedEnvironment: TargetEnvironment;
  budgetMicrounits?: number;
}

export interface PolicyAction {
  actionId: string;
  capability: string;
  mutationKind: MutationKind;
  riskClass: RiskClass;
  dataClass: DataClass;
  environment: TargetEnvironment;
  projectScoped: boolean;
  rawShell: boolean;
  destructive: boolean;
  externalDataTransfer: boolean;
  requiresBreakGlass?: boolean;
}

export interface PolicyContext {
  actor: IntegrationActor;
  scope: WorkspaceScope | null;
  action: PolicyAction;
  ephemeralGrantPresent: boolean;
  approvalPresent: boolean;
  breakGlassGrantPresent: boolean;
}

export interface PolicyDecision {
  schemaVersion: 1;
  disposition: PolicyDisposition;
  requiredTier: TrustTier;
  reasonCodes: string[];
  effectivePermissions: WorkspacePermission[];
}

/** A provenance record points at observed truth; it is not durable truth by itself. */
export interface StateObservation {
  source: string;
  observedAt: string;
  subject: string;
  revision?: string;
  digest?: string;
  confidence: 'authoritative' | 'verified' | 'reported';
  ttlSeconds?: number;
}

export interface EvidenceCheck {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  evidenceRef?: string;
  detail?: string;
}

export interface ArtifactEvidence {
  artifactId: string;
  sha256?: string;
  revision?: string;
  mediaType?: string;
}

/**
 * EvidenceBundle is an integration projection. Artifact/log/task storage stays
 * in the existing AWH authorities; this object only links their exact refs.
 */
export interface EvidenceBundle {
  schemaVersion: 1;
  taskId: string;
  executionId: string;
  sourceRevision?: string;
  observations: StateObservation[];
  checks: EvidenceCheck[];
  artifacts: ArtifactEvidence[];
  auditEventIds: string[];
  rollbackRef?: string;
  verifiedAt?: string;
}

export interface RouteRequest {
  schemaVersion: 1;
  projectId: string;
  capability: string;
  requiredTier: TrustTier;
  environment: TargetEnvironment;
  preferCostClass: 'INCLUDED' | 'PREPAID' | 'LOCAL_FREE' | 'METERED' | null;
}

export interface AuthoritativeRouteResult {
  providerId: string;
  kind: 'VPS' | 'DEVICE' | 'CODEX' | 'MCP' | 'API' | 'BURST';
  capability: string;
  availabilityMode: 'ALWAYS_ON' | 'ON_DEMAND' | 'OPTIONAL_DEVICE';
  costClass: 'INCLUDED' | 'PREPAID' | 'LOCAL_FREE' | 'METERED';
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/;
const CAPABILITY = /^[a-z][a-z0-9:._-]{0,127}$/;

export function assertIntegrationIntent(value: IntegrationIntent): void {
  if (value.schemaVersion !== AWH_INTEGRATION_SCHEMA_VERSION) throw new Error('Unsupported integration intent schema version');
  if (!SAFE_ID.test(value.intentId)) throw new Error('Integration intent id is invalid');
  if (!value.goal.trim() || value.goal.length > 4_000) throw new Error('Integration intent goal is invalid');
  if (value.projectId !== null && !SAFE_ID.test(value.projectId)) throw new Error('Integration project id is invalid');
  if (value.budgetMicrounits !== undefined && (!Number.isSafeInteger(value.budgetMicrounits) || value.budgetMicrounits < 0)) {
    throw new Error('Integration intent budget is invalid');
  }
  if (value.capabilityDemands.length > 64) throw new Error('Integration intent has too many capability demands');
  for (const demand of value.capabilityDemands) {
    if (!CAPABILITY.test(demand.capability)) throw new Error(`Invalid capability: ${demand.capability}`);
    if (!demand.reason.trim() || demand.reason.length > 500) throw new Error(`Invalid capability reason: ${demand.capability}`);
  }
}

export function uniqueCapabilities(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => CAPABILITY.test(value)))].sort();
}

export function trustTierRank(tier: TrustTier): number {
  switch (tier) {
    case 'observe': return 0;
    case 'safe': return 1;
    case 'privileged': return 2;
    case 'break-glass': return 3;
  }
}
