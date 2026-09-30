import type { ToolLifecycleState } from './external-capability-registry.js';

export type ToolPromotionEvidenceKey =
  | 'upstream_revision_resolved'
  | 'license_verified'
  | 'package_or_binary_integrity_verified'
  | 'mcp_or_cli_smoke_pass'
  | 'smoke_pass'
  | 'capability_contract_pass'
  | 'regression_pass'
  | 'rollback_evidence_ready';

export interface ToolFabricUpdatePolicy {
  schemaVersion: 1;
  policyId: 'awh.tool-fabric.update.v1';
  authority: 'AWH_UPDATE_CENTER';
  principles: {
    pinnedByDefault: true;
    autoInstallLatest: false;
    lazyLoad: true;
    singleCatalog: true;
    rollbackRequired: true;
    licenseRecheckOnUpdate: true;
    noParallelControlPlane: true;
  };
  channels: {
    stable: { promotionRequires: ToolPromotionEvidenceKey[] };
    preview: { promotionRequires: ToolPromotionEvidenceKey[] };
  };
  updateDiscovery: {
    mode: 'metadata_only';
    defaultCadenceHours: number;
    notifyOn: string[];
    neverMutateRuntimeDuringDiscovery: true;
  };
  installation: {
    strategy: 'capability_lazy_install';
    isolatedToolRoots: true;
    atomicReplacement: true;
    keepPreviousVerified: 1;
    sharedGlobalLatestForbidden: true;
  };
  futureToolIntake: {
    source: 'TOOL_DISCOVERY_INBOX';
    requiredFields: string[];
    states: ToolLifecycleState[];
    defaultState: 'DISCOVERED';
    autoApproval: false;
    duplicateCapabilityCheck: true;
  };
}

const STATE_TRANSITIONS: Readonly<Record<ToolLifecycleState, readonly ToolLifecycleState[]>> = {
  DISCOVERED: ['REVIEWED','REJECTED'],
  REVIEWED: ['APPROVED','REJECTED'],
  APPROVED: ['PREVIEW','REJECTED','RETIRED'],
  PREVIEW: ['STABLE','APPROVED','RETIRED'],
  STABLE: ['RETIRED'],
  REJECTED: ['REVIEWED','RETIRED'],
  RETIRED: ['REVIEWED'],
};

export function validateToolFabricUpdatePolicy(value: unknown): ToolFabricUpdatePolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('TOOL_FABRIC_POLICY_INVALID');
  const row=value as Record<string,unknown>;
  if (row.schemaVersion!==1||row.policyId!=='awh.tool-fabric.update.v1'||row.authority!=='AWH_UPDATE_CENTER') throw new Error('TOOL_FABRIC_POLICY_IDENTITY_INVALID');
  const p=row.principles as Record<string,unknown>|undefined;
  if (!p||p.pinnedByDefault!==true||p.autoInstallLatest!==false||p.lazyLoad!==true||p.singleCatalog!==true||p.rollbackRequired!==true||p.licenseRecheckOnUpdate!==true||p.noParallelControlPlane!==true) throw new Error('TOOL_FABRIC_POLICY_PRINCIPLES_INVALID');
  const d=row.updateDiscovery as Record<string,unknown>|undefined;
  if (!d||d.mode!=='metadata_only'||d.neverMutateRuntimeDuringDiscovery!==true||!Number.isInteger(d.defaultCadenceHours)||Number(d.defaultCadenceHours)<1) throw new Error('TOOL_FABRIC_DISCOVERY_POLICY_INVALID');
  const i=row.installation as Record<string,unknown>|undefined;
  if (!i||i.strategy!=='capability_lazy_install'||i.isolatedToolRoots!==true||i.atomicReplacement!==true||i.keepPreviousVerified!==1||i.sharedGlobalLatestForbidden!==true) throw new Error('TOOL_FABRIC_INSTALL_POLICY_INVALID');
  const f=row.futureToolIntake as Record<string,unknown>|undefined;
  if (!f||f.source!=='TOOL_DISCOVERY_INBOX'||f.defaultState!=='DISCOVERED'||f.autoApproval!==false||f.duplicateCapabilityCheck!==true) throw new Error('TOOL_FABRIC_INTAKE_POLICY_INVALID');
  const channels=row.channels as Record<string,unknown>|undefined;
  const stable=channels?.stable as Record<string,unknown>|undefined;
  const preview=channels?.preview as Record<string,unknown>|undefined;
  if (!Array.isArray(stable?.promotionRequires)||!Array.isArray(preview?.promotionRequires)) throw new Error('TOOL_FABRIC_PROMOTION_POLICY_INVALID');
  return value as ToolFabricUpdatePolicy;
}

export function assertToolLifecycleTransition(from: ToolLifecycleState, to: ToolLifecycleState): void {
  if (from===to) return;
  if (!STATE_TRANSITIONS[from]?.includes(to)) throw new Error('TOOL_FABRIC_LIFECYCLE_TRANSITION_INVALID');
}

export function missingPromotionEvidence(
  policy: ToolFabricUpdatePolicy,
  channel: 'preview'|'stable',
  evidence: Readonly<Record<string, boolean>>,
): ToolPromotionEvidenceKey[] {
  return policy.channels[channel].promotionRequires.filter((key)=>evidence[key]!==true);
}

export function assertToolPromotion(
  policy: ToolFabricUpdatePolicy,
  from: ToolLifecycleState,
  to: 'PREVIEW'|'STABLE',
  evidence: Readonly<Record<string,boolean>>,
): void {
  assertToolLifecycleTransition(from,to);
  const missing=missingPromotionEvidence(policy,to==='STABLE'?'stable':'preview',evidence);
  if (missing.length) throw new Error('TOOL_FABRIC_PROMOTION_EVIDENCE_MISSING:'+missing.join(','));
}
