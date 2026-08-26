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
  const [html, dashboard, css, worker, registry, schoolTools, pdfVendor, qrVendor] = await Promise.all([
    readFile(join(OUTPUT, 'index.html'), 'utf8'),
    readFile(join(OUTPUT, 'dashboard.js'), 'utf8'),
    readFile(join(OUTPUT, 'dashboard.css'), 'utf8'),
    readFile(join(OUTPUT, 'sw.js'), 'utf8'),
    readFile(join(OUTPUT, 'tool-registry.js'), 'utf8'),
    readFile(join(OUTPUT, 'school-tools.js'), 'utf8'),
    readFile(join(OUTPUT, 'vendor', 'pdf-lib.min.js'), 'utf8'),
    readFile(join(OUTPUT, 'vendor', 'qrcode.js'), 'utf8'),
  ]);
  assert.match(html, /dashboard\.css\?release=dashboard-fixture/);
  assert.match(html, /dashboard\.js\?release=dashboard-fixture/);
  assert.match(html, /vendor\/pdf-lib\.min\.js\?release=dashboard-fixture/);
  assert.match(html, /vendor\/qrcode\.js\?release=dashboard-fixture/);
  assert.doesNotMatch(`${html}\n${dashboard}`, /__AWH_WEB_RELEASE_ID__/);
  assert.match(worker, /dashboard\.css\?release=dashboard-fixture/);
  assert.match(worker, /dashboard\.js\?release=dashboard-fixture/);
  assert.match(worker, /school-tools\.js\?release=dashboard-fixture/);
  assert.match(worker, /vendor\/pdf-lib\.min\.js\?release=dashboard-fixture/);
  assert.ok(registry.length > 500);
  assert.ok(schoolTools.length > 1000);
  assert.ok(pdfVendor.length > 100000);
  assert.ok(qrVendor.length > 10000);
  assert.match(css, /body\.product-dashboard-active #workspace-view/);
  assert.match(dashboard, /loadControlData/);
  assert.match(dashboard, /goal-input/);
  assert.match(dashboard, /goal-form/);
  assert.doesNotMatch(dashboard, /fetch\(|XMLHttpRequest|WebSocket/);
});

test('teacher home is outcome-first, role-aware and exposes real zero-token school tools', async () => {
  const [dashboard, registry, schoolTools, css] = await Promise.all([
    readFile(join(ROOT, 'web', 'dashboard.js'), 'utf8'),
    readFile(join(ROOT, 'web', 'tool-registry.js'), 'utf8'),
    readFile(join(ROOT, 'web', 'school-tools.js'), 'utf8'),
    readFile(join(ROOT, 'web', 'dashboard.css'), 'utf8'),
  ]);
  for (const label of ['AI ช่วยงาน', 'สร้างเอกสาร', 'จัดการรูปภาพ', 'จัดการ PDF', 'สร้าง QR', 'แนบไฟล์ให้ AI']) assert.match(registry, new RegExp(label));
  assert.match(dashboard, /ไม่ต้องเขียน Prompt ให้เป็น/);
  assert.match(dashboard, /ประมวลผลในเครื่องนี้ ไม่อัปโหลดรูปไปที่เซิร์ฟเวอร์/);
  assert.match(dashboard, /canvas\.toBlob/);
  assert.match(dashboard, /state\.control\?\.role !== 'OWNER'/);
  assert.match(dashboard, /ศูนย์รวมทุกอย่างของเรา/);
  for (const scope of ['Projects', 'Multi Chat', 'Memory', 'Tasks & Executions', 'Devices', 'System']) assert.match(registry, new RegExp(scope.replace(/[&]/g, '\\&')));
  assert.match(schoolTools, /PDFDocument\.create/);
  assert.match(schoolTools, /copyPages/);
  assert.match(schoolTools, /setRotation/);
  assert.match(schoolTools, /qrcodeLib/);
  assert.match(schoolTools, /ไม่ใช้ AI token/);
  assert.doesNotMatch(schoolTools, /fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|Authorization|Bearer/i);
  assert.match(css, /@media\(max-width:540px\)/);
});

test('local school-tool registry is modular and production deployment bundles every required asset', async () => {
  const [registry, deploy, pkg] = await Promise.all([
    readFile(join(ROOT, 'web', 'tool-registry.js'), 'utf8'),
    readFile(join(ROOT, 'deploy', 'awh-control-plane', 'deploy-control-plane.sh'), 'utf8'),
    readFile(join(ROOT, 'package.json'), 'utf8'),
  ]);
  assert.match(registry, /id: 'pdf'[\s\S]*badge: 'ฟรี'[\s\S]*mode: 'local'/);
  assert.match(registry, /id: 'qr'[\s\S]*badge: 'ฟรี'[\s\S]*mode: 'local'/);
  for (const asset of ['dashboard.css', 'dashboard.js', 'tool-registry.js', 'school-tools.js', 'vendor/pdf-lib.min.js', 'vendor/qrcode.js']) assert.match(deploy, new RegExp(asset.replace(/[.]/g, '\\.')));
  const parsed = JSON.parse(pkg);
  assert.equal(parsed.dependencies['pdf-lib'], '1.17.1');
  assert.equal(parsed.dependencies['qrcode-generator'], '1.4.4');
});
