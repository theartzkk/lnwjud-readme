import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadConfig } from './config.js';
import { createServer, type ArtAgentServerProfile } from './server.js';
import { canonicalWorkspace } from './security.js';
import { ART_AGENT_VERSION } from './version.js';
import { PRODUCT } from './product.js';

function runtimeProfile(): ArtAgentServerProfile {
  return process.argv.includes('--remote-tunnel') ? 'remote-readonly' : 'local';
}

export async function startStdioRuntime(): Promise<void> {
  const config = loadConfig();
  const workspace = await canonicalWorkspace(config.workspace);
  const profile = runtimeProfile();
  const remoteReadOnly = profile === 'remote-readonly';
  void serveStdio(() => createServer(config, workspace, profile));
  console.error(
    `${PRODUCT.legacyCodename} MCP ${ART_AGENT_VERSION} running on stdio | workspace=${workspace} | profile=${profile} | write=${remoteReadOnly ? false : config.allowWrite} | exec=${remoteReadOnly ? false : config.allowExec} | codex=${remoteReadOnly ? false : config.allowCodex}`,
  );
}
