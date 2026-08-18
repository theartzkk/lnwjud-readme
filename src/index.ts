import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { canonicalWorkspace } from './security.js';

const config = loadConfig();
const workspace = await canonicalWorkspace(config.workspace);

void serveStdio(() => createServer(config, workspace));
console.error(`Art Agent MCP 0.1.0 running on stdio | workspace=${workspace} | write=${config.allowWrite} | exec=${config.allowExec}`);
