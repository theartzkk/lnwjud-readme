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
const OUTPUT = await mkdtemp(join(tmpdir(), 'awh-dashboard-'));
after(async () => { await rm(OUTPUT, { recursive: true, force: true }); });

async function build(): Promise<void> {
  await runFile(process.execPath, ['--import', 'tsx', 'scripts/build-web-preview.ts', '--control'], {
    cwd: ROOT,
    shell: false,
    env: { ...process.env, AWH_PREVIEW_GENERATED_AT: '2026-08-26T00:00:00.000Z', AWH_WEB_RELEASE_ID: 'dashboard-fixture', AWH_WEB_OUTPUT_DIR: OUTPUT },
  });
}

test('post-login dashboard is an additive presentation module over the canonical work surface', async () => {
  await build();
  const [html, dashboard, css, worker] = await Promise.all([
    readFile(join(OUTPUT, 'index.html'), 'utf8'),
    readFile(join(OUTPUT, 'dashboard.js'), 'utf8'),
    readFile(join(OUTPUT, 'dashboard.css'), 'utf8'),
    readFile(join(OUTPUT, 'sw.js'), 'utf8'),
  ]);
  assert.match(html, /dashboard\.css\?release=dashboard-fixture/);
  assert.match(html, /dashboard\.js\?release=dashboard-fixture/);
  assert.doesNotMatch(`${html}\n${dashboard}`, /__AWH_WEB_RELEASE_ID__/);
  assert.match(worker, /dashboard\.css\?release=dashboard-fixture/);
  assert.match(worker, /dashboard\.js\?release=dashboard-fixture/);
  assert.match(css, /body\.product-dashboard-active #workspace-view/);
  assert.match(dashboard, /loadControlData/);
  assert.match(dashboard, /goal-input/);
  assert.match(dashboard, /goal-form/);
  assert.doesNotMatch(dashboard, /fetch\(|XMLHttpRequest|WebSocket/);
});

test('teacher home is outcome-first, role-aware and exposes a real zero-token image tool', async () => {
  const [dashboard, css] = await Promise.all([
    readFile(join(ROOT, 'web', 'dashboard.js'), 'utf8'),
    readFile(join(ROOT, 'web', 'dashboard.css'), 'utf8'),
  ]);
  for (const label of ['AI ช่วยงาน', 'สร้างเอกสาร', 'จัดการรูปภาพ', 'จัดการ PDF', 'สร้าง QR', 'แนบไฟล์ให้ AI']) assert.match(dashboard, new RegExp(label));
  assert.match(dashboard, /ไม่ต้องเขียน Prompt ให้เป็น/);
  assert.match(dashboard, /ประมวลผลในเครื่องนี้ ไม่อัปโหลดรูปไปที่เซิร์ฟเวอร์/);
  assert.match(dashboard, /canvas\.toBlob/);
  assert.match(dashboard, /ไม่ใช้ AI token/);
  assert.match(dashboard, /state\.control\?\.role !== 'OWNER'/);
  assert.match(dashboard, /ศูนย์รวมทุกอย่างของเรา/);
  for (const scope of ['Projects', 'Multi Chat', 'Memory', 'Tasks & Executions', 'Devices', 'System']) assert.match(dashboard, new RegExp(scope.replace(/[&]/g, '\\&')));
  assert.match(css, /@media\(max-width:540px\)/);
});

test('unfinished deterministic tools are truthful rather than fake-success actions', async () => {
  const dashboard = await readFile(join(ROOT, 'web', 'dashboard.js'), 'utf8');
  assert.match(dashboard, /title: 'จัดการ PDF'[\s\S]*badge: 'กำลังเพิ่ม'[\s\S]*disabled: true/);
  assert.match(dashboard, /title: 'สร้าง QR'[\s\S]*badge: 'กำลังเพิ่ม'[\s\S]*disabled: true/);
  assert.doesNotMatch(dashboard, /StrictHostKeyChecking|api[_-]?key|Authorization|Bearer|localStorage|sessionStorage/i);
});