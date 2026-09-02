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
  for (const label of ['Projects', 'Source Authority', 'Multi Chat', 'Tasks & Executions', 'Memory', 'Approvals', 'AI & Costs', 'Devices & Workers', 'Users & Roles', 'Security', 'Infrastructure', 'Database Studio', 'Automations', 'Runtime / lnwjud']) assert.match(source, new RegExp(label.replace(/[&/]/g, '\\$&')));
  for (const tab of ['data', 'ai', 'devices', 'people', 'account', 'system']) assert.match(source, new RegExp(`openSettings\\('${tab}'\\)`));
  assert.match(source, /project-open/);
  assert.match(source, /conversation-open/);
  assert.match(source, /action === 'tasks'.*dashboard-open-tasks/);
  assert.match(source, /action === 'approvals'.*dashboard-pulse-attention-card/);
  assert.doesNotMatch(source, /action === 'tasks' \|\| action === 'approvals'/);
  assert.match(source, /window\.location\.assign\('\.\/database\.html'\)/);
  assert.match(source, /window\.location\.assign\('\.\/infrastructure\.html'\)/);
  assert.match(source, /action === 'automations'.*return/);
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|Authorization|Bearer|\/api\/v1\/control\//i);
});

test('M20 owner Source Authority reuses the bounded control adapter instead of creating browser authority', async () => {
  const source = await readFile(join(ROOT, 'web', 'owner-center.js'), 'utf8');
  assert.match(source, /source-authority/);
  assert.match(source, /import\('\.\/control-plane-adapter\.js\?release=__AWH_WEB_RELEASE_ID__'\)/);
  assert.match(source, /api\.loadProjectSourceAuthority\(select\.value\)/);
  assert.match(source, /api\.updateProjectSourceAuthority\(\{ projectId: select\.value, action: 'BIND'/);
  assert.match(source, /api\.updateProjectSourceAuthority\(\{ projectId: select\.value, action: 'CLEAR' \}\)/);
  assert.match(source, /canonicalVaultReady === true/);
  assert.match(source, /GitHub Source · เชื่อมแล้ว/);
  assert.match(source, /Source ล่าสุด/);
  assert.match(source, /Canonical cache สำหรับ AI \/ AiPASS/);
  assert.match(source, /Working files/);
  assert.match(source, /ระบบจะไม่ทับอัตโนมัติ/);
  assert.match(source, /สร้างชุดตรวจ AiPASS ใหม่/);
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|WebSocket|Authorization|Bearer|\/api\/v1\/control\//i);
  assert.doesNotMatch(source, /indexedDB|localStorage|sessionStorage/i);
});

test('M20 AiPASS Owner flow exposes only verified direct DOCX batches', async () => {
  const [owner, exporter, publicEntry] = await Promise.all([
    readFile(join(ROOT, 'web', 'owner-center.js'), 'utf8'),
    readFile(join(ROOT, 'hub', 'src', 'HubAiPassProjectExportService.php'), 'utf8'),
    readFile(join(ROOT, 'hub', 'public', 'control-plane.php'), 'utf8'),
  ]);
  assert.match(owner, /สร้างชุดตรวจ AiPASS/);
  assert.match(owner, /api\.createAiPassProjectExport\(select\.value\)/);
  assert.match(owner, /target\.searchParams\.set\('aipass', 'page'\)/);
  assert.match(owner, /window\.location\.assign\(`\$\{target\.pathname\}\$\{target\.search\}`\)/);
  assert.match(owner, /AiPASS ใช้เฉพาะ DOCX ที่ AWH แบ่งและตรวจให้เป็น Batch/);
  assert.doesNotMatch(owner, /fetch\(|XMLHttpRequest|WebSocket|Authorization|Bearer/i);

  assert.match(exporter, /FILE_TEXT_BYTE_CEILING = 350000/);
  assert.match(exporter, /BATCH_TEXT_BYTE_CEILING = 650000/);
  assert.match(exporter, /MAX_FILES_PER_BATCH = 16/);
  assert.match(exporter, /MAX_BATCHES = 16/);
  assert.match(exporter, /AIPASS_DIRECT_DOCX/);
  assert.match(exporter, /CONSERVATIVE_UTF8_BYTE_BOUND_NOT_EXACT_PROVIDER_TOKENS/);
  assert.match(exporter, /AIPASS_INTERNAL_BUNDLE_NEVER_UPLOAD/);
  assert.match(exporter, /class HubAiPassBundleDelivery/);
  assert.match(exporter, /verifyDocxTextBudget/);
  assert.match(exporter, /ผ่านขนาดจำกัด ✓/);
  assert.match(exporter, /อัปโหลดพร้อมกัน/);
  assert.match(exporter, /ข้อความแนะนำสำหรับ AiPASS/);
  assert.match(exporter, /อย่าอัปโหลดหลาย Batch พร้อมกัน/);
  assert.doesNotMatch(exporter, /PART_TEXT_CHARS\s*=\s*750000/);

  assert.match(publicEntry, /HubAiPassBundleDelivery::landingPage/);
  assert.match(publicEntry, /HubAiPassBundleDelivery::document/);
  assert.match(publicEntry, /\$mode === 'page'/);
  assert.match(publicEntry, /\$mode === 'docx'/);
  assert.match(publicEntry, /AIPASS_DELIVERY_INVALID/);
  assert.match(publicEntry, /artifactDownload have already validated the session/);
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

test('V1.6 owner can preview the teacher Home without mutating auth, role or durable state', async () => {
  const [source, css] = await Promise.all([
    readFile(join(ROOT, 'web', 'owner-center.js'), 'utf8'),
    readFile(join(ROOT, 'web', 'owner-center.css'), 'utf8'),
  ]);
  assert.match(source, /ดูในมุมครู/);
  assert.match(source, /PREVIEW_CLASS = 'awh-teacher-preview'/);
  assert.match(source, /Preview หน้าแรกเท่านั้น · สิทธิ์ Owner ไม่เปลี่ยน/);
  assert.match(source, /action === 'teacher-preview'/);
  assert.match(source, /back\.textContent = 'กลับ Owner'/);
  assert.match(source, /workspace\.hidden\) exitTeacherPreview\(\)/);
  assert.match(source, /attributeFilter: \['hidden'\]/);
  assert.match(css, /body\.awh-teacher-preview #dashboard-owner-center/);
  assert.match(css, /\.awh-teacher-preview-bar/);
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|Authorization|Bearer|\/api\//i);
  assert.doesNotMatch(source, /setRole|updateRole|impersonat|roleOverride/i);
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
  assert.match(dashboard, /dashboard-owner-source-center/);
  assert.match(dashboard, /control-plane-adapter\.js\?release=owner-center-fixture/);
  assert.match(dashboard, /สร้างชุดตรวจ AiPASS/);
  assert.match(dashboard, /Dashboard correctness guardrails/);
  assert.match(dashboard, /GIF แบบเคลื่อนไหวยังไม่รองรับ/);
  assert.match(dashboard, /ดูในมุมครู/);
  assert.match(dashboard, /awh-teacher-preview-bar/);
  assert.match(css, /\.awh-owner-command-center/);
  assert.match(css, /\.awh-teacher-preview-bar/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(html, /dashboard\.js\?release=owner-center-fixture/);
  assert.match(worker, /dashboard\.js\?release=owner-center-fixture/);
  assert.doesNotMatch(`${dashboard}\n${html}`, /__AWH_WEB_RELEASE_ID__/);
});