import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('AWH navigation exposes one clear home/work/tasks model', async () => {
  const [html, dashboard] = await Promise.all([
    readFile('web/index.html', 'utf8'),
    readFile('web/dashboard.js', 'utf8'),
  ]);
  assert.match(html, /data-owner-destination="awh"[^>]*>[^<]*<img[^>]*><span>AWH<\/span>/);
  assert.match(dashboard, /function currentNavigationDestination\(\)/);
  assert.match(dashboard, /make\('⌂', 'หน้าแรก', 'home'/);
  assert.match(dashboard, /make\('✦', 'AWH', 'work'/);
  assert.match(dashboard, /make\('✓', 'งาน', 'tasks'/);
  assert.doesNotMatch(dashboard, /make\('▦', 'เครื่องมือ', 'tools'/);
  assert.match(dashboard, /60000/);
});

test('background sync cannot inherit a stale click loading state', async () => {
  const feedback = await readFile('web/interaction-feedback.js', 'utf8');
  assert.match(feedback, /function consumeRecentUserAction\(\)/);
  assert.match(feedback, /delta < 0 \|\| delta >= 500/);
  assert.match(feedback, /lastInteraction = \{ element: null, at: -Infinity \}/);
  assert.doesNotMatch(feedback, /delta < 1400/);
});

test('failed tasks are not presented as if recovery were still running', async () => {
  const execution = await readFile('web/execution-ux.js', 'utf8');
  assert.ok(execution.includes("else if (state === 'FAILED') { title = 'ทำไม่สำเร็จ';"));
  assert.match(execution, /ยังไม่ได้ทำต่ออัตโนมัติ/);
});

test('Control Panel primary navigation is task-oriented and advanced details stay secondary', async () => {
  const html = await readFile('web/panel.html', 'utf8');
  const nav = html.slice(html.indexOf('<nav class="cp-nav"'), html.indexOf('</nav>', html.indexOf('<nav class="cp-nav"')));
  for (const label of ['ภาพรวม','อัปเดต','อุปกรณ์','เว็บไซต์และช่องทาง','ผู้ใช้']) assert.match(nav, new RegExp(label));
  assert.match(nav, /class="cp-nav-advanced"/);
  assert.doesNotMatch(nav, />LINE OA</);
  assert.doesNotMatch(nav, />ระบบที่เชื่อมกัน</);
  assert.match(html, /id="cp-technical-details" class="cp-diagnostics"/);
  assert.match(html, /เปิดรายละเอียด/);
});
