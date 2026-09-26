import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');

test('generic AWH Settings hub is removed from the user-facing shell',async()=>{
  const [html,app]=await Promise.all([
    readFile(join(ROOT,'web/index.html'),'utf8'),
    readFile(join(ROOT,'web/app.js'),'utf8'),
  ]);
  assert.doesNotMatch(html,/การตั้งค่า AWH/);
  assert.match(html,/id="account-sheet-title">บัญชีของฉัน</);
  assert.match(html,/class="settings-tabs"[^>]*hidden/);
  assert.match(html,/id="settings-panel-start" class="settings-panel" hidden/);
  assert.match(app,/focusedSettingsCopy/);
  assert.match(app,/requestedSettings\?\.startsWith\('panel:'\)/);
});

test('owner administration is native to Control Panel and has no Settings bounce',async()=>{
  const [app,owner,panel,panelJs]=await Promise.all([
    readFile(join(ROOT,'web/app.js'),'utf8'),
    readFile(join(ROOT,'web/owner-center.js'),'utf8'),
    readFile(join(ROOT,'web/panel.html'),'utf8'),
    readFile(join(ROOT,'web/panel.js'),'utf8'),
  ]);
  assert.match(app,/requested === 'people'.*panel\.html#users/);
  assert.match(app,/requested === 'system'.*panel\.html/);
  assert.match(owner,/action === 'ai'.*panel\.html#ai/);
  assert.match(owner,/action === 'people'.*panel\.html#users/);
  assert.match(owner,/action === 'devices'.*infrastructure\.html#capability-fabric/);
  assert.match(panel,/id="users" class="cp-section cp-admin-section"/);
  assert.match(panel,/id="ai" class="cp-section cp-admin-section"/);
  assert.match(panel,/id="cp-ai-form"/);
  assert.doesNotMatch(panel,/awh-settings=(?:people|ai|system|brand)/);
  assert.match(panelJs,/loadPeopleAccess/);
  assert.match(panelJs,/reviewAccountRequest/);
  assert.match(panelJs,/revokePerson/);
  assert.match(panelJs,/updateProviderPolicy/);
});
