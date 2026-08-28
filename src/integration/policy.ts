import type {
  PolicyContext,
  PolicyDecision,
  RiskClass,
  TrustTier,
  WorkspacePermission,
} from './contracts.js';

const RISK_RANK: Record<RiskClass, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

function permissionForMutation(kind: PolicyContext['action']['mutationKind']): WorkspacePermission {
  if (kind === 'READ') return 'read';
  if (kind === 'EXECUTE' || kind === 'OPAQUE') return 'execute';
  return 'write';
}

export function requiredTrustTier(context: PolicyContext): TrustTier {
  const { action } = context;
  if (action.requiresBreakGlass === true) return 'break-glass';
  if (action.environment === 'production' && action.mutationKind !== 'READ') return 'privileged';
  if (action.destructive || action.mutationKind === 'DELETE') return 'privileged';
  if (RISK_RANK[action.riskClass] >= RISK_RANK.HIGH) return 'privileged';
  if (action.mutationKind !== 'READ') return 'safe';
  return 'observe';
}

/**
 * Deterministic boundary policy for ChatGPT/MCP and other integration adapters.
 * It does not replace AWH RBAC/approval authorities; it fails closed before a
 * request is allowed to reach those authorities.
 */
export function evaluateIntegrationPolicy(context: PolicyContext): PolicyDecision {
  const reasons: string[] = [];
  const permissions = context.scope?.permissions ?? [];
  const requiredTier = requiredTrustTier(context);

  if (!context.actor.authenticated) {
    return decision('deny', requiredTier, ['AUTH_REQUIRED'], permissions);
  }

  if (context.action.rawShell) {
    return decision('deny', 'break-glass', ['RAW_SHELL_FORBIDDEN'], permissions);
  }

  if (context.action.projectScoped) {
    if (!context.scope) return decision('deny', requiredTier, ['WORKSPACE_SCOPE_REQUIRED'], permissions);
    if (!context.action.actionId.trim()) return decision('deny', requiredTier, ['ACTION_ID_REQUIRED'], permissions);
  }

  const neededPermission = permissionForMutation(context.action.mutationKind);
  if (context.action.projectScoped && !permissions.includes(neededPermission)) {
    return decision('deny', requiredTier, [`WORKSPACE_${neededPermission.toUpperCase()}_DENIED`], permissions);
  }

  if (context.action.externalDataTransfer && context.action.dataClass === 'restricted') {
    return decision('deny', requiredTier, ['RESTRICTED_DATA_EXFILTRATION_DENIED'], permissions);
  }

  if (requiredTier === 'break-glass') {
    if (context.actor.role !== 'owner') reasons.push('BREAK_GLASS_OWNER_ONLY');
    if (!context.breakGlassGrantPresent) reasons.push('BREAK_GLASS_GRANT_REQUIRED');
    if (!context.approvalPresent) reasons.push('APPROVAL_REQUIRED');
    if (reasons.length > 0) return decision('deny', requiredTier, reasons, permissions);
    return decision('allow', requiredTier, ['BREAK_GLASS_EXPLICITLY_GRANTED'], permissions);
  }

  if (requiredTier === 'privileged') {
    if (!['owner', 'admin'].includes(context.actor.role)) reasons.push('PRIVILEGED_ROLE_REQUIRED');
    if (!context.ephemeralGrantPresent) reasons.push('EPHEMERAL_GRANT_REQUIRED');
    if (!context.approvalPresent) reasons.push('APPROVAL_REQUIRED');
    if (reasons.some((reason) => reason !== 'APPROVAL_REQUIRED')) return decision('deny', requiredTier, reasons, permissions);
    if (reasons.includes('APPROVAL_REQUIRED')) return decision('require-approval', requiredTier, reasons, permissions);
    return decision('allow', requiredTier, ['PRIVILEGED_POLICY_SATISFIED'], permissions);
  }

  if (requiredTier === 'safe') {
    if (context.action.environment === 'production') {
      return decision('require-approval', 'privileged', ['PRODUCTION_MUTATION_REQUIRES_PRIVILEGED_REVIEW'], permissions);
    }
    if (!context.ephemeralGrantPresent) {
      return decision('require-approval', requiredTier, ['EPHEMERAL_GRANT_REQUIRED'], permissions);
    }
    return decision('allow', requiredTier, ['SAFE_ACTION_POLICY_SATISFIED'], permissions);
  }

  if (context.action.riskClass === 'CRITICAL') {
    return decision('require-approval', 'privileged', ['CRITICAL_READ_REQUIRES_REVIEW'], permissions);
  }

  return decision('allow', 'observe', ['READ_ONLY_POLICY_SATISFIED'], permissions);
}

function decision(
  disposition: PolicyDecision['disposition'],
  requiredTier: TrustTier,
  reasonCodes: string[],
  effectivePermissions: WorkspacePermission[],
): PolicyDecision {
  return {
    schemaVersion: 1,
    disposition,
    requiredTier,
    reasonCodes,
    effectivePermissions: [...new Set(effectivePermissions)],
  };
}
