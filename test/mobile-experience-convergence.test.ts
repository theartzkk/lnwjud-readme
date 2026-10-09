import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('mobile experience convergence contract', async () => {
  const app = await read('web/app.js');
  const navigation = await read('web/navigation.js');
  const responsive = await read('web/responsive-layout.css');
  assert.ok(app.includes("sheet awh-stepup-overlay"));
  assert.ok(app.includes("sheet-card awh-stepup-card"));
  assert.ok(app.includes("openAwhDialog(overlay, { history: false })"));
  assert.ok(navigation.includes("visualViewport?.addEventListener('resize', stabilizeDialogVisualViewport"));
  assert.ok(navigation.includes('--awh-visual-viewport-height'));
  assert.ok(responsive.includes('font-size: 16px !important'));
  assert.ok(responsive.includes('min-height: 44px'));
});

test('mobile product surfaces keep forms, floating UI, and task truth consistent', async () => {
  const dashboard = await read('web/dashboard.css');
  const kruart = await read('web/kruart-system.css');
  const panel = await read('web/panel.js');
  const panelCss = await read('web/panel.css');
  const panelHtml = await read('web/panel.html');
  const hostingHtml = await read('web/hosting.html');
  const updatesCss = await read('web/updates.css');
  const chat = await read('web/chat-island/chat.css');
  const automation = await read('web/automation-surface.css');
  assert.ok(dashboard.includes('.awh-task-filter{min-height:44px'));
  assert.ok(dashboard.includes('.awh-file-open-task{min-height:44px'));
  assert.ok(kruart.includes('.owner-command-form input{min-height:44px!important;font-size:16px!important}'));
  assert.ok(panelCss.includes('font-size:16px!important'));
  assert.ok(panelCss.includes('height:var(--awh-visual-viewport-height,100dvh)'));
  for (const html of [panelHtml, hostingHtml]) {
    assert.ok(html.includes('responsive-layout.css?release=__AWH_WEB_RELEASE_ID__'));
    assert.ok(html.includes('navigation.js?release=__AWH_WEB_RELEASE_ID__'));
  }
  assert.ok(updatesCss.includes('height:var(--awh-visual-viewport-height,100dvh)'));
  assert.ok(chat.includes('.awh-chat-search input{font-size:16px}'));
  assert.ok(chat.includes('height:var(--awh-visual-viewport-height,100dvh)'));
  assert.ok(automation.includes('height:var(--awh-visual-viewport-height,100dvh)'));
  assert.ok(panel.includes('TASK_RUNNING_STATES=new Set'));
  assert.ok(panel.includes('งานที่ระบบกำลังติดตาม'));
  assert.ok(panel.includes('verificationPending'));
});
