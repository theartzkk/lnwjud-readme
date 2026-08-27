import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

const runFile = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = await mkdtemp(join(tmpdir(), 'awh-owner-center-'));
after(async () => { await rm(OUTPUT, { recursive: true, force: true }); });

async function build(): Promise<void> {
  await runFile(process.execPath, ['--import', 'tsx', 'scripts/build-web-preview.ts', '--control'], {
    cwd: ROOT,
    shell: false,
    env: { ...process.env, AWH_PREVIEW_GENERATED_AT: '2026-08-27T00:00:00.000Z', AWH_WEB_RELEASE_ID: 'owner-center-fixture', AWH_WEB_OUTPUT_DIR: OUTPUT },
  });
}

test('V1.3 owner center unifies existing owner surfaces without a new authority', async () => {
  const source = await readFile(join(ROOT, 'web', 'owner-center.js'), 'utf8');
  for (const label of ['Projects', 'Multi Chat', 'Tasks & Executions', 'Memory', 'Approvals', 'AI & Costs', 'Devices & Workers', 'Users & Roles', 'Security', 'System', 'Database Studio', 'Automations', 'Runtime / lnwjud']) assert.match(source, new RegExp(label.replace(/[&/]/g, '\\$&')));
  for (const tab of ['data', 'ai', 'devices', 'people', 'account', 'system']) assert.match(source, new RegExp(`openSettings\\('${tab}'\\)`));
  assert.match(source, /project-open/);
  assert.match(source, /conversation-open/);
  assert.match(source, /window\.location\.assign\('\.\/database\.html'\)/);
  assert.match(source, /action === 'automations'.*return/);
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|Authorization|Bearer|\/api\/v1\/control\//i);
});

test('V1.3 dashboard guardrails reset Home after sign-out and reject animated GIF flattening', async () => {
  const source = await readFile(join(ROOT, 'web', 'dashboard-guardrails.js'), 'utf8');
  assert.match(source, /delete document\.body\.dataset\.awhDashboardVisited/);
  assert.match(source, /workspace\?\.hidden === true/);
  assert.match(source, /input\.accept = 'image\/png,image\/jpeg,image\/webp'/);
  assert.match(source, /file\.type === 'image\/gif'/);
  assert.match(source, /\/\\\.gif\$\/i\.test\(file\.name\)/);
  assert.match(source, /stopImmediatePropagation/);
  assert.match(source, /เหลือเพียงเฟรมแรก/);
  assert.match(source, /capture: true/);
});

test('V1.3 owner center is bundled into existing dashboard assets and stays mobile-first', async () => {
  await build();
  const [dashboard, css, html, worker] = await Promise.all([
    readFile(join(OUTPUT, 'dashboard.js'), 'utf8'),
    readFile(join(OUTPUT, 'dashboard.css'), 'utf8'),
    readFile(join(OUTPUT, 'index.html'), 'utf8'),
    readFile(join(OUTPUT, 'sw.js'), 'utf8'),
  ]);
  assert.match(dashboard, /dashboard-owner-command-center/);
  assert.match(dashboard, /Dashboard correctness guardrails/);
  assert.match(dashboard, /GIF แบบเคลื่อนไหวยังไม่รองรับ/);
  assert.match(css, /\.awh-owner-command-center/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(html, /dashboard\.js\?release=owner-center-fixture/);
  assert.match(worker, /dashboard\.js\?release=owner-center-fixture/);
  assert.doesNotMatch(`${dashboard}\n${html}`, /__AWH_WEB_RELEASE_ID__/);
});
