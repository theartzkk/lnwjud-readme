import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AWH_INTEGRATION_TOOLS,
  assertIntegrationIntent,
  buildAuthoritativeRouteRequest,
  enabledIntegrationTools,
  evaluateIntegrationPolicy,
  resolveAuthoritativeRoute,
  type IntegrationIntent,
  type PolicyContext,
} from '../src/integration/index.js';

const owner = {
  userId: 'owner-1',
  role: 'owner' as const,
  authenticated: true,
};

function basePolicyContext(): PolicyContext {
  return {
    actor: owner,
    scope: {
      projectId: 'project-1',
      roots: ['/workspace/project-1'],
      permissions: ['read'],
      environment: 'preview',
    },
    action: {
      actionId: 'awh.file.read',
      capability: 'workspace.files',
      mutationKind: 'READ',
      riskClass: 'LOW',
      dataClass: 'internal',
      environment: 'preview',
      projectScoped: true,
      rawShell: false,
      destructive: false,
      externalDataTransfer: false,
    },
    ephemeralGrantPresent: false,
    approvalPresent: false,
    breakGlassGrantPresent: false,
  };
}

test('M1 plugin surface enables only existing read-only MCP tools', () => {
  const enabled = enabledIntegrationTools();
  assert.ok(enabled.length >= 8);
  assert.equal(enabled.every((tool) => tool.state === 'ready'), true);
  assert.equal(enabled.every((tool) => tool.mutationKind === 'READ'), true);
  assert.equal(enabled.every((tool) => tool.trustTier === 'observe'), true);

  const mutating = AWH_INTEGRATION_TOOLS.filter((tool) => tool.mutationKind !== 'READ');
  assert.ok(mutating.length > 0);
  assert.equal(mutating.every((tool) => tool.defaultEnabled === false && tool.state === 'disabled'), true);
});

test('observe policy allows an authenticated scoped read', () => {
  const result = evaluateIntegrationPolicy(basePolicyContext());
  assert.equal(result.disposition, 'allow');
  assert.equal(result.requiredTier, 'observe');
  assert.deepEqual(result.reasonCodes, ['READ_ONLY_POLICY_SATISFIED']);
});

test('integration boundary fails closed for raw shell regardless of role', () => {
  const context = basePolicyContext();
  context.scope = {
    projectId: 'project-1',
    roots: ['/workspace/project-1'],
    permissions: ['read', 'write', 'execute'],
    environment: 'preview',
  };
  context.action = {
    ...context.action,
    actionId: 'shell.raw',
    mutationKind: 'EXECUTE',
    riskClass: 'CRITICAL',
    rawShell: true,
  };
  context.ephemeralGrantPresent = true;
  context.approvalPresent = true;
  context.breakGlassGrantPresent = true;

  const result = evaluateIntegrationPolicy(context);
  assert.equal(result.disposition, 'deny');
  assert.equal(result.requiredTier, 'break-glass');
  assert.deepEqual(result.reasonCodes, ['RAW_SHELL_FORBIDDEN']);
});

test('production mutation requires privileged approval even for owner', () => {
  const context = basePolicyContext();
  context.scope = {
    projectId: 'project-1',
    roots: ['/workspace/project-1'],
    permissions: ['read', 'write'],
    environment: 'production',
  };
  context.action = {
    ...context.action,
    actionId: 'awh.workspace.patch',
    mutationKind: 'REPLACE',
    riskClass: 'HIGH',
    environment: 'production',
  };
  context.ephemeralGrantPresent = true;

  const result = evaluateIntegrationPolicy(context);
  assert.equal(result.disposition, 'require-approval');
  assert.equal(result.requiredTier, 'privileged');
  assert.equal(result.reasonCodes.includes('APPROVAL_REQUIRED'), true);
});

test('safe preview mutation can proceed only with scoped permission and ephemeral grant', () => {
  const context = basePolicyContext();
  context.scope = {
    projectId: 'project-1',
    roots: ['/workspace/project-1'],
    permissions: ['read', 'write'],
    environment: 'preview',
  };
  context.action = {
    ...context.action,
    actionId: 'awh.preview.generate',
    mutationKind: 'CREATE',
    riskClass: 'MEDIUM',
  };

  assert.equal(evaluateIntegrationPolicy(context).disposition, 'require-approval');
  context.ephemeralGrantPresent = true;
  assert.equal(evaluateIntegrationPolicy(context).disposition, 'allow');
});

test('restricted data cannot be exported through an external integration', () => {
  const context = basePolicyContext();
  context.action = {
    ...context.action,
    dataClass: 'restricted',
    externalDataTransfer: true,
  };
  const result = evaluateIntegrationPolicy(context);
  assert.equal(result.disposition, 'deny');
  assert.deepEqual(result.reasonCodes, ['RESTRICTED_DATA_EXFILTRATION_DENIED']);
});

test('intent contract validates bounded capability requests without creating a second task authority', () => {
  const intent: IntegrationIntent = {
    schemaVersion: 1,
    intentId: 'intent-20260828-1',
    origin: 'chatgpt-mcp',
    actor: owner,
    projectId: 'project-1',
    goal: 'Inspect AWH and report verified status.',
    constraints: ['read-only'],
    expectedArtifacts: [],
    acceptanceChecks: ['source revision identified'],
    capabilityDemands: [{ capability: 'project.read', required: true, reason: 'Inspect source truth' }],
    requestedEnvironment: 'production',
  };
  assert.doesNotThrow(() => assertIntegrationIntent(intent));
});

test('routing adapter delegates provider choice to the existing Hub authority', async () => {
  const request = buildAuthoritativeRouteRequest({
    projectId: 'project-1',
    capability: 'project.read',
    requiredTier: 'observe',
    environment: 'production',
    preferCostClass: 'PREPAID',
  });
  const routed = await resolveAuthoritativeRoute({
    route: async (received) => ({
      providerId: 'vps-native',
      kind: 'VPS',
      capability: received.capability,
      availabilityMode: 'ALWAYS_ON',
      costClass: 'PREPAID',
    }),
  }, request);
  assert.equal(routed?.providerId, 'vps-native');
});

test('routing adapter rejects capability drift from an upstream route result', async () => {
  const request = buildAuthoritativeRouteRequest({
    projectId: 'project-1',
    capability: 'project.read',
    requiredTier: 'observe',
    environment: 'production',
  });
  await assert.rejects(
    resolveAuthoritativeRoute({
      route: async () => ({
        providerId: 'unexpected-provider',
        kind: 'API',
        capability: 'project.mutate.source',
        availabilityMode: 'ON_DEMAND',
        costClass: 'METERED',
      }),
    }, request),
    /capability mismatch/i,
  );
});
