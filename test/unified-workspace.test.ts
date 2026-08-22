import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ControlPlaneWorkerClient } from '../src/control-plane-worker-client.js';
import { DEVICE_TOKEN_CREDENTIAL_KEY, type CredentialStore } from '../src/credential-store.js';

const ids = { project: '523b45c0-23e1-408d-ae0f-ac5eca7f6900', device: '423b45c0-23e1-408d-ae0f-ac5eca7f6900' };
class FixtureCredentials implements CredentialStore { async get(key: string): Promise<string | null> { return key === DEVICE_TOKEN_CREDENTIAL_KEY ? 'fixture-device-token' : null; } async set(): Promise<void> {} async delete(): Promise<void> {} }

test('M8 project registration and device binding use the existing worker credential boundary without sending a local path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-unified-client-'));
  try {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new ControlPlaneWorkerClient('https://hub.example/api/v1', root, new FixtureCredentials(), async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      const path = new URL(String(url)).pathname;
      return new Response(JSON.stringify(path.endsWith('/bindings') ? { schemaVersion: 2, binding: { projectId: ids.project } } : { schemaVersion: 2, project: { projectId: ids.project } }), { status: 201 });
    });
    await client.registerProject({ projectId: ids.project, name: 'Portable Project', type: 'node', sourceRevision: null });
    await client.registerProjectBinding(ids.project, 'Portable Project', ['project:context', 'git:read']);
    assert.equal(calls[0]?.url, 'https://hub.example/api/v1/control/worker/projects/register');
    assert.equal(calls[1]?.url, 'https://hub.example/api/v1/control/worker/projects/bindings');
    for (const call of calls) {
      const body = String(call.init.body);
      assert.match(String((call.init.headers as Record<string, string>).Authorization), /^Bearer fixture-device-token$/);
      assert.doesNotMatch(body, /fixture-device-token|workspacePath|\/Users\/|[A-Za-z]:\\/);
      assert.match(body, /"deviceId":"[0-9a-f-]{36}"/i);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('M8 keeps one Hub authority for threads, context, settings and portable project bindings', async () => {
  const [migration, service, router, app, adapter] = await Promise.all([
    readFile(new URL('../hub/migrations/007_unified_workspace.sql', import.meta.url), 'utf8'),
    readFile(new URL('../hub/src/HubControlPlaneService.php', import.meta.url), 'utf8'),
    readFile(new URL('../hub/src/HubControlPlaneRouter.php', import.meta.url), 'utf8'),
    readFile(new URL('../web/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../web/control-plane-adapter.js', import.meta.url), 'utf8'),
  ]);
  assert.match(migration, /DROP INDEX IF EXISTS idx_control_conversations_user_project/);
  assert.match(migration, /control_project_device_bindings/);
  assert.match(migration, /control_project_contexts/);
  assert.match(migration, /control_product_setting_revisions/);
  assert.doesNotMatch(migration, /workspace_path|source_content|token_hash|password/i);
  assert.match(service, /registerProjectFromDevice/);
  assert.match(service, /createConversation/);
  assert.match(service, /setCurrentContext/);
  assert.match(service, /exportWorkspace/);
  assert.match(router, /conversations\/thread/);
  assert.match(router, /worker\/projects\/register/);
  assert.match(adapter, /conversations\/thread/);
  assert.match(app, /loadCurrentContext/);
  assert.match(app, /submitWorkMessage\(project\.projectId, conversationId/);
  assert.match(app, /workspace-export/);
});
