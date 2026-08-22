import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('M7 uses the existing control plane as metadata and lease authority, while Git remains the bounded WIP source authority', async () => {
  const [migration, service, router, runtime, client, web] = await Promise.all([
    readFile(new URL('../hub/migrations/006_workspace_continuity.sql', import.meta.url), 'utf8'),
    readFile(new URL('../hub/src/HubControlPlaneService.php', import.meta.url), 'utf8'),
    readFile(new URL('../hub/src/HubControlPlaneRouter.php', import.meta.url), 'utf8'),
    readFile(new URL('../src/control-plane-worker-runtime.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/control-plane-worker-client.ts', import.meta.url), 'utf8'),
    readFile(new URL('../web/control-plane-adapter.js', import.meta.url), 'utf8'),
  ]);
  assert.match(migration, /control_workspace_checkpoints/);
  assert.match(migration, /control_workspace_leases/);
  assert.match(migration, /control_workspace_events/);
  assert.doesNotMatch(migration, /workspace_content|source_blob|file_contents/i);
  assert.match(service, /BEGIN IMMEDIATE/);
  assert.match(service, /WORKSPACE_LEASE_HELD/);
  assert.match(service, /UNSYNCED_CHANGES/);
  assert.match(router, /\/worker\/workspaces\/checkpoints/);
  assert.match(router, /\/workspaces\//);
  assert.match(runtime, /reconstructWorkspaceWip/);
  assert.match(runtime, /createWorkspaceWipCheckpoint/);
  assert.match(runtime, /WAITING_FOR_WORKER/);
  assert.match(client, /claimWorkspaceLease/);
  assert.match(client, /renewWorkspaceLease/);
  assert.match(web, /loadWorkspaceContinuity/);
  assert.doesNotMatch(`${service}\n${router}`, /workspacePath|sourceContent|shell_exec|passthru|proc_open|popen|system\s*\(/i);
});
