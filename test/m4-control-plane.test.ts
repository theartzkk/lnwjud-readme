import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('M4 control-plane browser adapter uses same-origin session cookies, not bearer storage', async () => {
  const adapter = await readFile(new URL('../web/control-plane-adapter.js', import.meta.url), 'utf8');
  const router = await readFile(new URL('../hub/src/HubControlPlaneRouter.php', import.meta.url), 'utf8');
  const originPolicy = await readFile(new URL('../hub/src/HubBrowserOriginPolicy.php', import.meta.url), 'utf8');
  assert.match(adapter, /credentials:\s*'include'/);
  assert.doesNotMatch(adapter, /localStorage|sessionStorage|Authorization|accessToken|tokenHash/);
  assert.match(adapter, /X-AWH-CSRF/);
  assert.match(adapter, /idempotencyKey/);
  assert.match(router, /__Host-awh_control_session/);
  assert.match(router, /HttpOnly/);
  assert.match(router, /SameSite=Strict/);
  assert.match(router, /HubBrowserOriginPolicy/);
  assert.match(originPolicy, /AWH_CONTROL_ORIGIN/);
  assert.match(router, /AUTHORIZATION_IN_URL/);
  assert.match(originPolicy, /HTTP_SEC_FETCH_SITE/);
  assert.match(originPolicy, /same-origin/);
  assert.match(originPolicy, /mutationAllowed/);
});

test('owner username/password auth reuses the M4 cookie and exposes only bounded session controls', async () => {
  const adapter = await readFile(new URL('../web/control-plane-adapter.js', import.meta.url), 'utf8');
  const router = await readFile(new URL('../hub/src/HubOwnerAuthRouter.php', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../hub/migrations/004_owner_auth.sql', import.meta.url), 'utf8');
  assert.match(adapter, new RegExp('/api/v1/auth/login'));
  assert.match(adapter, /credentials:\s*'include'/);
  assert.doesNotMatch(adapter, /localStorage|sessionStorage|Authorization|Bearer/);
  assert.match(router, /__Host-awh_control_session/);
  assert.match(router, new RegExp('/api/v1/auth/sessions'));
  assert.match(router, /CSRF_REJECTED|sameOrigin/);
  assert.match(router, /auth\/identity/);
  assert.match(adapter, /changeUsername/);
  assert.match(migration, /owner_passwords/);
  assert.match(migration, /auth_recovery_codes/);
  assert.doesNotMatch(`${router}\n${migration}`, /plaintext|password\s+AS|SELECT .*token/i);
});

test('M4 control-plane contract is additive and keeps execution bounded', async () => {
  const migration = await readFile(new URL('../hub/migrations/003_m4_control_plane.sql', import.meta.url), 'utf8');
  const service = await readFile(new URL('../hub/src/HubControlPlaneService.php', import.meta.url), 'utf8');
  assert.match(migration, /control_tasks/);
  assert.match(migration, /control_workers/);
  assert.match(migration, /control_approvals/);
  assert.match(migration, /UNIQUE INDEX.*user_idempotency/s);
  assert.match(service, /WAITING_FOR_WORKER/);
  assert.match(service, /BEGIN IMMEDIATE/);
  assert.match(service, /goal/);
  assert.doesNotMatch(service, /shell_exec|passthru|proc_open|popen|system\s*\(/i);
  assert.doesNotMatch(service, /workspacePath|sourceContent|shell_exec|passthru|proc_open|popen|system\s*\(/i);
});

test('M6 assistant Work stream is an additive ordered view over canonical M4 tasks', async () => {
  const migration = await readFile(new URL('../hub/migrations/005_assistant_workstream.sql', import.meta.url), 'utf8');
  const service = await readFile(new URL('../hub/src/HubControlPlaneService.php', import.meta.url), 'utf8');
  const router = await readFile(new URL('../hub/src/HubControlPlaneRouter.php', import.meta.url), 'utf8');
  assert.match(migration, /control_conversations/);
  assert.match(migration, /control_conversation_messages/);
  assert.match(migration, /conversation_id/);
  assert.match(migration, /idx_control_conversation_messages_order/);
  assert.match(service, /BEGIN IMMEDIATE/);
  assert.match(service, /idempotency_key/);
  assert.match(service, /syncConversationEvent/);
  assert.match(service, /cancelTask/);
  assert.match(router, /\/cancel/);
  assert.match(router, /\/api\/v1\/control\/conversations/);
  assert.doesNotMatch(`${migration}\n${service}`, /shell_exec|passthru|proc_open|popen|system\s*\(/i);
});

test('mobile control UI is phone-first and truthful when no worker is online', async () => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const executionUx = await readFile(new URL('../web/execution-ux.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../web/styles.css', import.meta.url), 'utf8');
  assert.match(html, /id="login-form"/);
  assert.match(html, /id="project-open"/);
  assert.match(html, /id="goal-form"/);
  assert.match(html, /id="work-thread"/);
  assert.match(executionUx, /WAITING_FOR_WORKER/);
  assert.match(app, /selectedProjectId/);
  assert.match(app, /memoryReady/);
  assert.match(html, /id="project-empty"/);
  assert.match(app, /ยังไม่มีโปรเจกต์/);
  assert.match(app, /goal-submit.*disabled/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});
