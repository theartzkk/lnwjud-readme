import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ControlPlaneWorkerClient } from './control-plane-worker-client.js';
import { createDesktopCredentialStore } from './credential-store.js';
import { createGatewayServer } from './gateway-server.js';

export async function startGatewayStdio(): Promise<void> {
  const dataDir = process.env.AWH_GATEWAY_DATA_DIR || '/var/lib/awh-remote/awh-gateway';
  const apiBase = process.env.AWH_HUB_API_BASE || 'https://kruart.online/api/v1';
  const client = new ControlPlaneWorkerClient(apiBase, dataDir, createDesktopCredentialStore(dataDir, process.platform));
  void serveStdio(() => createGatewayServer(client));
  console.error('AWH Agent Gateway running on stdio');
}
