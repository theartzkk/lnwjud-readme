import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('M4 control-plane browser adapter uses same-origin session cookies, not bearer storage', async () => {
  const adapter = await readFile(new URL('../web/control-plane-adapter.js', import.meta.url), 'utf8');
  const router = await readFile(new URL('../hub/src/HubControlPlaneRouter.php', import.meta.url), 'utf8');
  assert.match(adapter, /credentials:\s*'include'/);
  assert.doesNotMatch(adapter, /localStorage|sessionStorage|Authorization|accessToken|tokenHash/);
  assert.match(adapter, /X-AWH-CSRF/);
  assert.match(adapter, /idempotencyKey/);
  assert.match(router, /__Host-awh_control_session/);
  assert.match(router, /HttpOnly/);
  assert.match(router, /SameSite=Strict/);
  assert.match(router, /AWH_CONTROL_ORIGIN/);
  assert.match(router, /AUTHORIZATION_IN_URL/);
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

test('mobile control UI is phone-first and truthful when no worker is online', async () => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../web/styles.css', import.meta.url), 'utf8');
  assert.match(html, /control-pairing-code/);
  assert.match(html, /control-goal/);
  assert.match(html, /control-task-list/);
  assert.match(app, /WAITING_FOR_WORKER/);
  assert.match(app, /previousProjectId/);
  assert.match(app, /memoryReady/);
  assert.match(html, /control-empty-project/);
  assert.match(app, /ยังไม่มีโปรเจกต์/);
  assert.match(app, /control-submit.*disabled/);
  assert.match(css, /control-columns/);
  assert.match(css, /@media\(max-width:560px\)/);
});
