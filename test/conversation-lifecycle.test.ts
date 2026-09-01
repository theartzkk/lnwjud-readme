import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('conversation lifecycle is reversible and preserves canonical task/artifact authority', async () => {
  const [migration, service, router, adapter, html, app, styles, dashboard, dashboardCss] = await Promise.all([
    readFile(new URL('../hub/migrations/018_conversation_lifecycle.sql', import.meta.url), 'utf8'),
    readFile(new URL('../hub/src/HubControlPlaneService.php', import.meta.url), 'utf8'),
    readFile(new URL('../hub/src/HubControlPlaneRouter.php', import.meta.url), 'utf8'),
    readFile(new URL('../web/control-plane-adapter.js', import.meta.url), 'utf8'),
    readFile(new URL('../web/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../web/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../web/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../web/dashboard.js', import.meta.url), 'utf8'),
    readFile(new URL('../web/dashboard.css', import.meta.url), 'utf8'),
  ]);
  assert.match(migration, /ALTER TABLE control_conversations ADD COLUMN deleted_at TEXT/);
  assert.match(migration, /deleted_by_user_id/);
  assert.doesNotMatch(migration, /CREATE TABLE[^;]*conversation/i);
  assert.doesNotMatch(service, /DELETE FROM control_conversations/i);
  assert.match(service, /CONVERSATION_ACTIVE_TASKS/);
  assert.match(service, /UPDATE control_project_contexts SET conversation_id=NULL/);
  assert.match(router, /conversations\/trash/);
  assert.match(router, /conversations\/thread\/.*\/lifecycle/);
  assert.match(adapter, /updateConversationLifecycle/);
  assert.match(html, /id="conversation-delete"/);
  assert.match(html, /id="conversation-trash-list"/);
  assert.match(app, /กู้คืน/);
  assert.match(app, /window\.confirm/);
  assert.match(app, /data\.scrollKey|dataset\.scrollKey/);
  assert.match(app, /threadFollowLatest/);
  assert.match(html, /id="conversation-latest"/);
  assert.match(styles, /safe-area-inset-top/);
  assert.match(dashboard, /visualViewport/);
  assert.match(dashboardCss, /repeat\(4,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(styles, /body\.work-active:not\(\.product-dashboard-active\) \.awh-mobile-nav \{ display: none; \}/);
});
