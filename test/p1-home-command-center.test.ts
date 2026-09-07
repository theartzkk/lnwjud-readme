import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('P1 Home command center presents real control data with role-aware worker detail', async () => {
  const dashboard = await read('web/dashboard.js');
  const css = await read('web/dashboard.css');
  assert.match(dashboard, /pulse\.id = 'dashboard-pulse'/);
  assert.match(dashboard, /control\.projects/);
  assert.match(dashboard, /control\.tasks/);
  assert.match(dashboard, /control\.artifacts/);
  assert.match(dashboard, /control\.approvals/);
  assert.match(dashboard, /control\.role !== 'OWNER'/);
  assert.match(dashboard, /data-pulse-target="work"/);
  assert.match(dashboard, /data-pulse-target="files"/);
  assert.match(dashboard, /data-product-destination/);
  assert.match(dashboard, /aria-current/);
  assert.match(dashboard, /loadInfrastructure/);
  assert.match(dashboard, /dashboard-owner-system-card/);
  assert.match(dashboard, /พร้อมใช้งาน · AI พร้อม/);
  assert.match(dashboard, /พื้นที่ใช้งาน \${storageUsed}% · \${active} งานกำลังดำเนินการ/);
  assert.doesNotMatch(dashboard, /VPS Healthy · AI Ready|CPU \${cpu}% · RAM \${ram}% · Disk \${disk}%/);
  assert.match(dashboard, /make\('✦', 'แชท', 'work'/);
  assert.doesNotMatch(dashboard, /งาน\/AI/);
  assert.doesNotMatch(dashboard, /make\('✦', 'AI', 'ai'/);
  assert.doesNotMatch(dashboard, /make\('☰', 'แชท', 'chat'/);
  assert.match(css, /\.awh-pulse-grid/);
  assert.match(css, /\.awh-pulse-card/);
  assert.match(css, /@media\(max-width:540px\)/);
  assert.doesNotMatch(dashboard, /demo|mock|fake/i);
});

test('P1 Home command center keeps critical cards keyboard and touch usable', async () => {
  const dashboard = await read('web/dashboard.js');
  const css = await read('web/dashboard.css');
  assert.match(dashboard, /class="awh-pulse-card" type="button"/);
  assert.match(css, /min-height:.*44px|padding:.*14px/);
  assert.match(css, /overflow-wrap|word-break/);
});


test('Owner Night Shift reuses existing canonical work projections without a shadow authority', async () => {
  const dashboard = await read('web/dashboard.js');
  const css = await read('web/dashboard.css');
  assert.match(dashboard, /nightShift\.id = 'dashboard-night-shift'/);
  assert.match(dashboard, /homeIds = \[[^\]]*'dashboard-night-shift'/);
  assert.match(dashboard, /state\.control\?\.role === 'OWNER'/);
  assert.match(dashboard, /state\.infrastructure/);
  assert.match(dashboard, /morningBrief/);
  assert.match(dashboard, /executionTriage/);
  assert.match(dashboard, /WAITING_FOR_APPROVAL/);
  assert.match(dashboard, /WAITING_FOR_WORKER/);
  assert.match(dashboard, /WAITING_FOR_CAPABILITY/);
  assert.match(dashboard, /currentDefect/);
  assert.match(dashboard, /nextAction/);
  assert.match(dashboard, /\.\/infrastructure\.html/);
  assert.doesNotMatch(dashboard, /\/api\/v1\/control\/night/i);
  assert.doesNotMatch(dashboard, /localStorage|sessionStorage|indexedDB|fetch\(/);
  assert.match(css, /\.awh-night-grid/);
  assert.match(css, /@media\(max-width:760px\).*\.awh-night-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/s);
});


test('Universal Search federates existing project, task, artifact and conversation authorities without a shadow index', async () => {
  const dashboard = await read('web/dashboard.js');
  const css = await read('web/dashboard.css');
  assert.match(dashboard, /loadConversations/);
  assert.match(dashboard, /localSearchResults/);
  assert.match(dashboard, /dashboard-search-input/);
  assert.match(dashboard, /ค้นหาทั้ง AWH/);
  assert.match(dashboard, /project\.projectId/);
  assert.match(dashboard, /task\.taskId/);
  assert.match(dashboard, /artifact\.name/);
  assert.match(dashboard, /conversation\.conversationId/);
  assert.match(dashboard, /event\.metaKey \|\| event\.ctrlKey/);
  assert.doesNotMatch(dashboard, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(dashboard, /\/api\/v1\/control\/search/);
  assert.match(css, /\.awh-search-dialog/);
  assert.match(css, /\.awh-search-result/);
  assert.match(css, /@media\(max-width:540px\).*\.awh-search-card/s);
});


test('Attention Center reuses tasks, approvals and owner infrastructure projections without a notification authority', async () => {
  const dashboard = await read('web/dashboard.js');
  const css = await read('web/dashboard.css');
  assert.match(dashboard, /attentionCenterItems/);
  assert.match(dashboard, /dashboard-attention-center/);
  assert.match(dashboard, /WAITING_FOR_APPROVAL/);
  assert.match(dashboard, /state\.control\?\.approvals/);
  assert.match(dashboard, /state\.infrastructure/);
  assert.match(dashboard, /backup\?\.freshness/);
  assert.match(dashboard, /productionComplete\?\.checks/);
  assert.match(dashboard, /openTaskSurface\('attention'/);
  assert.doesNotMatch(dashboard, /notificationQueue|notifications\/create|\/api\/v1\/control\/notifications/);
  assert.match(css, /\.awh-attention-center/);
  assert.match(css, /\.awh-attention-action/);
});


test('mobile UX consolidates Work and Home with progressive disclosure', async () => {
  const dashboard = await read('web/dashboard.js');
  const css = `${await read('web/styles.css')}
${await read('web/dashboard.css')}`;
  assert.match(dashboard, /mountWorkStarterShortcuts/);
  assert.match(dashboard, /dashboard-night-toggle/);
  assert.match(dashboard, /dashboard-owner-toggle/);
  assert.match(dashboard, /งานที่ AWH กำลังดูแล/);
  assert.match(dashboard, /รอระบบพร้อม/);
  assert.match(dashboard, /ทำอะไรต่อ/);
  assert.doesNotMatch(dashboard, /<span>Current defect<\/span>|Next safe action|เปิด Control Tower|กำลังอ่าน Morning Brief/);
  assert.match(css, /body\.work-active \.composer\{background:var\(--awh-surface/);
  assert.match(css, /body\.work-active \.workspace-ecosystem-link,body\.work-active \.workspace-account,body\.work-active \.refresh-button\{display:none!important\}/);
  assert.match(css, /\.awh-owner-collapsible \.awh-owner-grid\{display:none\}/);
  assert.match(css, /\.awh-night-grid,\.awh-night-next\{display:none\}/);
  assert.match(css, /background:rgba\(255,255,255,\.96\)/);
});
