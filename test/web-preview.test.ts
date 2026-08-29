import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { browserRequestOptions, isSafeRelativePath, loadWebData } from '../web/hub-read-adapter.js';
import { safeApiPath } from '../web/control-plane-adapter.js';

const runFile = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = await mkdtemp(join(tmpdir(), 'awh-web-preview-'));
after(async () => { await rm(OUTPUT, { recursive: true, force: true }); });

async function buildWeb(control = false): Promise<void> {
  await runFile(process.execPath, ['--import', 'tsx', 'scripts/build-web-preview.ts', ...(control ? ['--control'] : [])], {
    cwd: ROOT,
    shell: false,
    env: { ...process.env, AWH_PREVIEW_GENERATED_AT: '2026-01-01T00:00:00.000Z', AWH_WEB_RELEASE_ID: 'fixture-control-sha', AWH_WEB_OUTPUT_DIR: OUTPUT },
  });
}

test('web build is a generic authenticated Control shell, never a serialized project preview', async () => {
  await buildWeb(true);
  const [html, app, adapter, rawConfig, rawData, worker] = await Promise.all([
    readFile(join(OUTPUT, 'index.html'), 'utf8'),
    readFile(join(OUTPUT, 'app.js'), 'utf8'),
    readFile(join(OUTPUT, 'hub-read-adapter.js'), 'utf8'),
    readFile(join(OUTPUT, 'web-config.json'), 'utf8'),
    readFile(join(OUTPUT, 'data.json'), 'utf8'),
    readFile(join(OUTPUT, 'sw.js'), 'utf8'),
  ]);
  const config = JSON.parse(rawConfig) as Record<string, unknown>;
  const data = JSON.parse(rawData) as Record<string, any>;
  assert.equal(config.mode, 'CONTROL');
  assert.equal(config.apiBase, '/api/v1');
  assert.equal(data.surface.mode, 'CONTROL');
  assert.equal(data.surface.status, 'Sign in to continue');
  assert.equal(data.project, undefined);
  assert.equal(data.tasks, undefined);
  assert.match(html, /id="sign-in-view"/);
  assert.match(html, /id="workspace-view"/);
  assert.match(html, /id="project-sheet"/);
  assert.match(html, /id="work-thread"/);
  assert.match(html, /id="goal-form"/);
  assert.match(html, /id="account-sheet"/);
  assert.doesNotMatch(`${html}\n${app}\n${adapter}\n${rawData}`, /Remote Preview|Preview only|static build|legacy-preview|Hub Read Surface/i);
  assert.doesNotMatch(`${html}\n${app}\n${adapter}\n${rawData}`, /workspacePath|absolutePath|\/Users\/|[A-Za-z]:\\\\|accessToken|tokenHash|Authorization|privateKey/i);
  assert.match(worker, /awh-shell-fixture-control-sha/);
  assert.doesNotMatch(worker, /__AWH_WEB_RELEASE_ID__/);
  assert.match(html, /styles\.css\?release=fixture-control-sha/);
  assert.match(html, /app\.js\?release=fixture-control-sha/);
  assert.match(app, /hub-read-adapter\.js\?release=fixture-control-sha/);
  assert.match(adapter, /control-plane-adapter\.js\?release=fixture-control-sha/);
  assert.match(html, /downloads\/AWH-macOS-x64\.zip/);
  assert.match(html, /downloads\/AWH-Windows-x64\.zip/);
});

test('one canonical dark canvas is used by html, body, and the application shell', async () => {
  const [html, css] = await Promise.all([
    readFile(join(ROOT, 'web', 'index.html'), 'utf8'),
    readFile(join(ROOT, 'web', 'styles.css'), 'utf8'),
  ]);
  assert.match(html, /theme-color" content="#0b0d10"/);
  assert.match(html, /apple-mobile-web-app-status-bar-style" content="black-translucent"/);
  assert.match(css, /--canvas:\s*#0b0d10/);
  assert.match(css, /html\s*\{[\s\S]*background-color:\s*var\(--canvas\)/);
  assert.match(css, /body\s*\{[\s\S]*background:\s*var\(--canvas\)/);
  assert.match(css, /\.app-shell\s*\{[\s\S]*background-color:\s*var\(--canvas\)/);
  assert.match(css, /min-height:\s*100dvh/);
  assert.match(css, /overscroll-behavior-y:\s*none/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.doesNotMatch(css, /radial-gradient|linear-gradient|background-image/i);
  assert.doesNotMatch(css, /body\s*\{[\s\S]*#ff8a36/);
});

test('web shell uses same-origin cookies only and never stores credentials or bearer state', async () => {
  const [html, app, adapter, controlAdapter] = await Promise.all([
    readFile(join(ROOT, 'web', 'index.html'), 'utf8'),
    readFile(join(ROOT, 'web', 'app.js'), 'utf8'),
    readFile(join(ROOT, 'web', 'hub-read-adapter.js'), 'utf8'),
    readFile(join(ROOT, 'web', 'control-plane-adapter.js'), 'utf8'),
  ]);
  assert.deepEqual(browserRequestOptions(), { credentials: 'same-origin', cache: 'no-store' });
  assert.match(controlAdapter, /credentials:\s*'include'/);
  assert.match(controlAdapter, /X-AWH-CSRF/);
  assert.doesNotMatch(`${html}\n${app}\n${adapter}\n${controlAdapter}`, /localStorage|sessionStorage|Authorization|Bearer\s+|document\.cookie/i);
  assert.doesNotMatch(`${html}\n${app}`, /pairing-code|pairing-submit|openMobileSession/i);
  assert.equal(isSafeRelativePath('/api/v1/control/session'), '/api/v1/control/session');
  assert.equal(isSafeRelativePath('https://evil.example/api'), null);
  assert.equal(isSafeRelativePath('//evil.example/api'), null);
  assert.equal(isSafeRelativePath('/api/v1/control/session?token=secret'), null);
});

test('CONTROL shell uses authenticated canonical data and presents a truthful sign-in fallback', async () => {
  const controlFetch = async (path: string) => {
    if (path === '/web-config.json') return { ok: true, text: async () => JSON.stringify({ mode: 'CONTROL', apiBase: '/api/v1' }) } as Response;
    if (path === '/data.json') return { ok: true, text: async () => JSON.stringify({ product: { shortName: 'AWH', name: 'Art’s Workspace Hub' } }) } as Response;
    return { ok: false, status: 401, text: async () => JSON.stringify({ code: 'SESSION_INVALID' }) } as Response;
  };
  const data = await loadWebData(controlFetch);
  assert.equal(data.control.available, true);
  assert.equal(data.control.authenticated, false);
  assert.equal(data.control.mode, 'CONTROL');
  assert.equal(typeof data.control.error, 'string');
  assert.ok(data.control.error.length > 0);

  const inactiveFetch = async () => ({ ok: true, text: async () => JSON.stringify({ mode: 'UNAVAILABLE', apiBase: null }) }) as Response;
  const inactive = await loadWebData(inactiveFetch);
  assert.equal(inactive.control.available, false);
  assert.equal(inactive.control.authenticated, false);
});

test('canonical Work is cloud-first, mobile-first, and never blocks chat on device state', async () => {
  const [html, app, executionUx, adapter, css] = await Promise.all([
    readFile(join(ROOT, 'web', 'index.html'), 'utf8'),
    readFile(join(ROOT, 'web', 'app.js'), 'utf8'),
    readFile(join(ROOT, 'web', 'execution-ux.js'), 'utf8'),
    readFile(join(ROOT, 'web', 'control-plane-adapter.js'), 'utf8'),
    readFile(join(ROOT, 'web', 'styles.css'), 'utf8'),
  ]);
  assert.match(html, /id="project-open"/);
  assert.match(html, /id="goal-input"/);
  assert.match(html, /id="goal-submit"/);
  assert.match(app, /selectedProjectId/);
  assert.match(executionUx, /WAITING_FOR_WORKER/);
  assert.match(html, /Cloud · Online/);
  assert.match(html, /AI · Ready/);
  assert.doesNotMatch(`${html}\n${app}`, /ยังไม่มีอุปกรณ์ทำงานออนไลน์|กำลังรออุปกรณ์ทำงาน|งานจะรอ/);
  assert.match(app, /goal-submit.*disabled/);
  assert.match(app, /conversationAvailable/);
  assert.match(app, /ensureMemorySurface/);
  assert.match(app, /แก้ไขความจำของ AWH/);
  assert.match(app, /Source of Truth ปัจจุบันมีสิทธิ์เหนือความจำเสมอ/);
  assert.match(adapter, /loadMemory/);
  assert.match(adapter, /updateMemory/);
  assert.doesNotMatch(app, /Work stream นี้จะพร้อมทันทีที่ Hub ได้รับ release ล่าสุด/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /body\.work-active \{ height: 100dvh; overflow: hidden; \}/);
  assert.match(css, /body\.work-active \.work-thread[^{]*\{[^}]*overflow-y: auto/s);
  assert.match(css, /body\.work-active \.composer[^{]*\{[^}]*position: relative/s);
  assert.match(css, /\.workspace-heading \{[^}]*grid-template-columns: auto minmax\(0,1fr\) auto/s);
  assert.match(html, /id="account-open-work"/);
  assert.match(app, /awh-recovery/);
  assert.match(app, /account-open-work/);
  assert.match(css, /body\.work-active \.workspace-account/);
});

test('CONTROL work composer keeps attachment previews, camera-capable file picking, and a bounded private upload contract', async () => {
  const [html, app, adapter, css] = await Promise.all([
    readFile(join(ROOT, 'web', 'index.html'), 'utf8'),
    readFile(join(ROOT, 'web', 'app.js'), 'utf8'),
    readFile(join(ROOT, 'web', 'control-plane-adapter.js'), 'utf8'),
    readFile(join(ROOT, 'web', 'styles.css'), 'utf8'),
  ]);
  assert.match(html, /id="attachment-input"[^>]*multiple[^>]*accept="image\/\*/);
  assert.match(html, /id="pending-attachments"/);
  assert.match(app, /MAX_ATTACHMENT_BYTES/);
  assert.match(app, /localAttachments/);
  assert.match(app, /attachment\.pending/);
  assert.match(adapter, /conversations\/thread\/\$\{conversationId\}\/attachments/);
  assert.match(adapter, /maxBytes = 60 \* 1024 \* 1024/);
  assert.match(adapter, /totalBytes > maxBytes/);
  assert.match(css, /\.pending-attachments, \.message-attachments/);
  assert.doesNotMatch(`${html}\n${app}\n${adapter}`, /workspacePath|absolutePath|\/Users\/|[A-Za-z]:\\\\/);
});

test('owner self-service is a focused settings hub whose independent projections cannot hide AI setup', async () => {
  const [html, app, executionUx, css, fixture] = await Promise.all([
    readFile(join(ROOT, 'web', 'index.html'), 'utf8'),
    readFile(join(ROOT, 'web', 'app.js'), 'utf8'),
    readFile(join(ROOT, 'web', 'execution-ux.js'), 'utf8'),
    readFile(join(ROOT, 'web', 'styles.css'), 'utf8'),
    readFile(join(ROOT, 'scripts', 'qa', 'control-web-fixture.mjs'), 'utf8'),
  ]);
  for (const section of ['start', 'ai', 'account', 'devices', 'data', 'people']) assert.match(html, new RegExp(`data-settings-tab="${section}"`));
  assert.match(html, /id="settings-panel-ai"/);
  assert.match(app, /id="provider-api-key"/);
  assert.match(app, /provider-credential-settings/);
  assert.match(html, /id="settings-worker-list"/);
  assert.match(html, /id="desktop-release-list"/);
  assert.match(html, /id="memory-host"/);
  assert.match(html, /id="my-awh-host"/);
  assert.match(html, /id="system-health-details"/);
  assert.match(app, /const health = \$\('system-health-details'\)/);
  for (const key of ['backup', 'storage', 'queue', 'aiBudget', 'workerSummary']) assert.match(app, new RegExp(`status\.${key}|status\[.${key}.\]`));
  assert.match(app, /Promise\.allSettled\(requests\)/);
  assert.match(app, /function showSettingsSection/);
  assert.match(app, /const host = \$\('memory-host'\)/);
  assert.match(app, /const host = \$\('my-awh-host'\)/);
  assert.match(app, /policy\.insertBefore\(models, enabledRow\)/);
  assert.match(app, /policy\.before\(section\)/);
  assert.match(app, /history\.replaceState/);
  assert.match(app, /ลืมรหัสผ่าน\?/);
  assert.match(app, /resetPassword\(/);
  assert.match(app, /loadDesktopRelease/);
  assert.match(executionUx, /WAITING_FOR_WORKER/);
  assert.doesNotMatch(app, /กำลังรออุปกรณ์ทำงาน/);
  assert.doesNotMatch(app, /กำลังรอ capability/);
  assert.doesNotMatch(app, /schema v\$\{database\.schemaVersion/);
  assert.match(css, /\.settings-tabs/);
  assert.match(css, /\.settings-action-grid/);
  assert.match(css, /\.settings-action-grid \{ grid-template-columns: 1fr;/);
  for (const route of ['/api/v1/control/provider', '/api/v1/control/owner/status', '/api/v1/auth/profile', '/api/v1/control/memory']) assert.match(fixture, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(fixture, /api\/v1\/auth\/reset-password/);
  assert.match(fixture, /fixtureResetUsed/);
  assert.doesNotMatch(`${html}\n${app}\n${fixture}`, /localStorage|sessionStorage|document\.cookie|Authorization|Bearer\s+/);
});

test('CONTROL API adapter permits the bounded query routes used by Work while rejecting non-relative or traversal paths', () => {
  const projectId = '11111111-1111-4111-8111-111111111111';
  assert.equal(safeApiPath(`/api/v1/control/conversations?projectId=${projectId}&q=%E0%B8%97%E0%B8%94%E0%B8%AA%E0%B8%AD%E0%B8%9A`), `/api/v1/control/conversations?projectId=${projectId}&q=%E0%B8%97%E0%B8%94%E0%B8%AA%E0%B8%AD%E0%B8%9A`);
  assert.equal(safeApiPath('/api/v1/control/settings/history?settingKey=tagline'), '/api/v1/control/settings/history?settingKey=tagline');
  assert.equal(safeApiPath('/api/v1/control/memory?scope=owner'), '/api/v1/control/memory?scope=owner');
  for (const unsafe of ['https://example.invalid/api/v1/control/projects', '//example.invalid/api/v1/control/projects', '/api/v1/control/%2e%2e/auth/session', '/api/v1/control/projects#fragment']) assert.throws(() => safeApiPath(unsafe), /not safe/);
});

test('CONTROL build stays deterministic and has a safe PWA cache boundary', async () => {
  await buildWeb(true);
  const first = await readFile(join(OUTPUT, 'data.json'), 'utf8');
  await buildWeb(true);
  const second = await readFile(join(OUTPUT, 'data.json'), 'utf8');
  const worker = await readFile(join(OUTPUT, 'sw.js'), 'utf8');
  assert.equal(first, second);
  assert.match(worker, /url\.pathname\.includes\('\/api\/'\)/);
  assert.doesNotMatch(worker, /cache\.put\([^\n]*api/i);
  assert.match(worker, /fetch\(request\)\.then\(\(response\)/);
  assert.match(worker, /\.catch\(\(\) => caches\.match\(request\)\)/);
  assert.match(worker, /skipWaiting/);
  assert.match(worker, /clients\.claim/);
});

test('Work renders inspection evidence through the existing same-origin artifact authority', async () => {
  const app = await readFile(join(ROOT, 'web/app.js'), 'utf8');
  assert.match(app, /function renderInspectionEvidence\(artifact\)/);
  assert.match(app, /artifact\.kind === 'project-inspection'/);
  assert.match(app, /credentials: 'same-origin'/);
  assert.match(app, /data\?\.kind !== 'project-inspection'/);
  assert.match(app, /data\?\.readOnly !== true/);
  assert.match(app, /Source revision/);
  assert.match(app, /ดูหลักฐานที่ AWH ใช้วิเคราะห์/);
  assert.match(app, /for \(const turn of messages\)[\s\S]{0,420}visibleMessages\.push\(turn\)/);
  assert.match(app, /empty-work[\s\S]{0,180}for \(const turn of visibleMessages\)/);
  assert.doesNotMatch(app, /inspection-evidence[^\n]*(?:localStorage|sessionStorage|Authorization|Bearer)/);
});
