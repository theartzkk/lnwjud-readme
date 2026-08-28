import type { MutationKind, RiskClass, TrustTier } from './contracts.js';

export type IntegrationAdapterKind = 'existing-mcp' | 'hub-rest' | 'future-adapter';
export type IntegrationAdapterState = 'ready' | 'adapter-required' | 'disabled';

export interface IntegrationToolDescriptor {
  id: string;
  title: string;
  description: string;
  adapter: IntegrationAdapterKind;
  target: string;
  state: IntegrationAdapterState;
  mutationKind: MutationKind;
  riskClass: RiskClass;
  trustTier: TrustTier;
  defaultEnabled: boolean;
  projectScoped: boolean;
}

/**
 * One catalog for ChatGPT Plugin/MCP exposure. Existing MCP and Hub APIs stay
 * authoritative; this catalog only describes what may be exposed and at what
 * trust tier. M1 deliberately exposes read-only capabilities by default.
 */
export const AWH_INTEGRATION_TOOLS = Object.freeze([
  tool('awh.health', 'AWH Health', 'Check the packaged AWH runtime and safe-mode settings.', 'existing-mcp', 'health', 'ready', false),
  tool('awh.workspace.info', 'Workspace Info', 'Inspect the authorized workspace and Git summary.', 'existing-mcp', 'workspace_info', 'ready', true),
  tool('awh.workspace.tree', 'Workspace Tree', 'List a bounded authorized workspace tree.', 'existing-mcp', 'workspace_tree', 'ready', true),
  tool('awh.file.read', 'Read File', 'Read a bounded page from an authorized non-secret text file.', 'existing-mcp', 'read_file', 'ready', true),
  tool('awh.workspace.search', 'Search Workspace', 'Search bounded text inside an authorized workspace.', 'existing-mcp', 'search_text', 'ready', true),
  tool('awh.git.status', 'Git Status', 'Read Git working-tree status for the authorized workspace.', 'existing-mcp', 'git_status', 'ready', true),
  tool('awh.git.diff', 'Git Diff', 'Read a bounded, secret-filtered Git diff.', 'existing-mcp', 'git_diff', 'ready', true),
  tool('awh.git.log', 'Git Log', 'Read recent Git commit history.', 'existing-mcp', 'git_log', 'ready', true),

  tool('awh.hub.status', 'Hub Status', 'Read central AWH Hub status.', 'hub-rest', 'GET /api/v1/status', 'adapter-required', false),
  tool('awh.projects.list', 'Projects', 'List projects visible to the authenticated AWH identity.', 'hub-rest', 'GET /api/v1/projects', 'adapter-required', false),
  tool('awh.devices.list', 'Devices', 'List authorized AWH devices and worker identities.', 'hub-rest', 'GET /api/v1/devices', 'adapter-required', false),
  tool('awh.builds.list', 'Builds', 'Read central build metadata.', 'hub-rest', 'GET /api/v1/builds', 'adapter-required', false),
  tool('awh.releases.list', 'Releases', 'Read central release metadata.', 'hub-rest', 'GET /api/v1/releases', 'adapter-required', false),

  mutationTool('awh.project.register', 'Register Project', 'Register or update a project through the existing Hub authority.', 'hub-rest', 'PUT /api/v1/projects/{projectId}', 'REPLACE', 'HIGH', 'privileged'),
  mutationTool('awh.workspace.write', 'Write Workspace File', 'Write a scoped workspace file through the existing local MCP authority.', 'existing-mcp', 'write_file', 'REPLACE', 'HIGH', 'privileged'),
  mutationTool('awh.workspace.patch', 'Apply Workspace Patch', 'Apply guarded exact-text replacements with an existing AWH checkpoint.', 'existing-mcp', 'apply_patch', 'REPLACE', 'HIGH', 'privileged'),
  mutationTool('awh.project.command', 'Run Project Command', 'Run only the existing allow-listed package scripts.', 'existing-mcp', 'project_command', 'EXECUTE', 'HIGH', 'privileged'),
] satisfies IntegrationToolDescriptor[]);

export function enabledIntegrationTools(): IntegrationToolDescriptor[] {
  return AWH_INTEGRATION_TOOLS.filter((item) => item.defaultEnabled);
}

export function integrationToolById(id: string): IntegrationToolDescriptor | undefined {
  return AWH_INTEGRATION_TOOLS.find((item) => item.id === id);
}

function tool(
  id: string,
  title: string,
  description: string,
  adapter: IntegrationAdapterKind,
  target: string,
  state: IntegrationAdapterState,
  projectScoped: boolean,
): IntegrationToolDescriptor {
  return {
    id,
    title,
    description,
    adapter,
    target,
    state,
    mutationKind: 'READ',
    riskClass: 'LOW',
    trustTier: 'observe',
    defaultEnabled: state === 'ready',
    projectScoped,
  };
}

function mutationTool(
  id: string,
  title: string,
  description: string,
  adapter: IntegrationAdapterKind,
  target: string,
  mutationKind: Exclude<MutationKind, 'READ'>,
  riskClass: RiskClass,
  trustTier: Exclude<TrustTier, 'observe'>,
): IntegrationToolDescriptor {
  return {
    id,
    title,
    description,
    adapter,
    target,
    state: 'disabled',
    mutationKind,
    riskClass,
    trustTier,
    defaultEnabled: false,
    projectScoped: true,
  };
}
