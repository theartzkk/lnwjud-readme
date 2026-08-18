import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { canonicalWorkspace } from './security.js';
import { ART_AGENT_VERSION } from './version.js';

export async function startStdioRuntime(): Promise<void> {
  const config = loadConfig();
  const workspace = await canonicalWorkspace(config.workspace);
  void serveStdio(() => createServer(config, workspace));
  console.error(`Art Agent MCP ${ART_AGENT_VERSION} running on stdio | workspace=${workspace} | write=${config.allowWrite} | exec=${config.allowExec} | codex=${config.allowCodex}`);
}
