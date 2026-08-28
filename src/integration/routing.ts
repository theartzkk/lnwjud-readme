import type {
  AuthoritativeRouteResult,
  RouteRequest,
  TargetEnvironment,
  TrustTier,
} from './contracts.js';

const CAPABILITY = /^[a-z][a-z0-9:._-]{0,127}$/;
const SAFE_PROJECT_ID = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/;

/**
 * Build a request for the existing HubCapabilityRegistryService authority.
 * This module intentionally does not score providers locally, preventing a
 * second routing truth from diverging from the Hub's cost/availability rules.
 */
export function buildAuthoritativeRouteRequest(input: {
  projectId: string;
  capability: string;
  requiredTier: TrustTier;
  environment: TargetEnvironment;
  preferCostClass?: RouteRequest['preferCostClass'];
}): RouteRequest {
  if (!SAFE_PROJECT_ID.test(input.projectId)) throw new Error('Route project id is invalid');
  if (!CAPABILITY.test(input.capability)) throw new Error('Route capability is invalid');
  return {
    schemaVersion: 1,
    projectId: input.projectId,
    capability: input.capability,
    requiredTier: input.requiredTier,
    environment: input.environment,
    preferCostClass: input.preferCostClass ?? null,
  };
}

/**
 * Validate the shape returned by the existing capability authority before an
 * integration adapter trusts it. Policy still decides whether the resulting
 * execution may proceed.
 */
export function assertAuthoritativeRouteResult(
  request: RouteRequest,
  result: AuthoritativeRouteResult,
): void {
  if (result.capability !== request.capability) throw new Error('Authoritative route capability mismatch');
  if (!result.providerId.trim()) throw new Error('Authoritative route provider id is missing');

  if (request.preferCostClass !== null && result.costClass !== request.preferCostClass) {
    // Preference is advisory: the Hub remains allowed to choose another valid
    // provider when availability/quality policy requires it.
    return;
  }
}

export interface RouteAuthorityAdapter {
  route(request: RouteRequest): Promise<AuthoritativeRouteResult | null>;
}

export async function resolveAuthoritativeRoute(
  adapter: RouteAuthorityAdapter,
  request: RouteRequest,
): Promise<AuthoritativeRouteResult | null> {
  const result = await adapter.route(request);
  if (result === null) return null;
  assertAuthoritativeRouteResult(request, result);
  return result;
}
