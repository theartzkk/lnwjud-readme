import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFile(join(ROOT, path), 'utf8');

function runWithInput(file: string, input: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', [file], { cwd: ROOT, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(input);
  });
}

test('authenticated Dashboard releases the Work-only viewport lock and protects mobile overlays', async () => {
  const [styles, dashboardCss, designSystem] = await Promise.all([
    read('web/styles.css'),
    read('web/dashboard.css'),
    read('web/awh-design-system.css'),
  ]);
  assert.match(styles, /body\.work-active\.product-dashboard-active\s*\{[^}]*min-height:\s*100dvh[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /body\.work-active\.product-dashboard-active \.app-shell\s*\{[^}]*height:\s*auto[^}]*overflow:\s*visible/s);
  assert.match(styles, /body\.work-active\.product-dashboard-active \.app-main\s*\{[^}]*overflow:\s*visible/s);
  assert.match(styles, /@media \(max-width: 680px\) \{ \.system-action-grid \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /\.system-action-grid > \*, \.system-feature-copy, \.system-health-details \{ min-width: 0; \}/);
  assert.match(styles, /\.system-health-card > \.system-health-details \{ display: grid; \}/);
  assert.match(styles, /@media \(max-width: 540px\) \{ \.settings-tabs \{ flex-wrap: wrap; overflow-x: visible; \} \}/);
  assert.match(dashboardCss, /body\.awh-overlay-open \.awh-mobile-nav\s*\{[^}]*display:\s*none/s);
  assert.match(dashboardCss, /body\.awh-overlay-open \.sheet\s*\{[^}]*safe-area-inset-bottom/s);
  assert.match(dashboardCss, /max-height:\s*calc\(100dvh - env\(safe-area-inset-top\)\)/);
  assert.match(dashboardCss, /\.awh-command-send,\.awh-home-prompt[^}]*min-height:\s*var\(--awh-touch-target,44px\)/s);
  assert.match(dashboardCss, /\.awh-task-filter[^}]*min-height:\s*var\(--awh-touch-target,44px\)/s);
  assert.match(dashboardCss, /\.awh-text-action,\.dashboard-home-button,\.awh-home-prompt[^}]*min-height:\s*var\(--awh-touch-target,44px\)/s);
  assert.match(dashboardCss, /\.awh-product-nav-item\s*\{[^}]*min-height:\s*var\(--awh-touch-target,44px\)/s);
  assert.match(designSystem, /--awh-touch-target:\s*44px/);
  assert.match(designSystem, /prefers-reduced-motion:\s*reduce/);
});

test('shared navigation contract owns modal history, focus escape and canonical nested-page fallback', async () => {
  const [navigation, dashboard, app, schoolTools, ownerCenter, automationSurface, designSystem] = await Promise.all([
    read('web/navigation.js'),
    read('web/dashboard.js'),
    read('web/app.js'),
    read('web/school-tools.js'),
    read('web/owner-center.js'),
    read('web/automation-surface.js'),
    read('web/awh-design-system.css'),
  ]);
  for (const contract of ['openAwhDialog', 'closeAwhDialog', 'commitAwhSurface', 'onAwhSurfaceChange', 'installAwhBackNavigation']) {
    assert.match(navigation, new RegExp(`export function ${contract}`));
  }
  assert.match(navigation, /history\.back\(\)/);
  assert.match(navigation, /addEventListener\('popstate'/);
  assert.match(navigation, /event\.key [!=]==? 'Tab'/);
  assert.match(navigation, /document\.referrer/);
  assert.match(navigation, /overlayScrollY = Math\.max\(0, window\.scrollY \|\| 0\)/);
  assert.match(navigation, /replaceState\(current, '', window\.location\.href\)/);
  assert.match(navigation, /window\.scrollTo\(\{ top: restoreY, behavior: 'auto' \}\)/);
  assert.match(dashboard, /commitAwhSurface/);
  assert.match(dashboard, /onAwhSurfaceChange/);
  assert.match(app, /openAwhDialog/);
  assert.match(app, /closeAwhDialog/);
  assert.match(app, /strip\.scrollLeft = left/);
  assert.match(schoolTools, /openAwhDialog/);
  assert.match(ownerCenter, /openAwhDialog/);
  assert.match(ownerCenter, /target\.click\(\); target\.focus\(\)/);
  assert.match(automationSurface, /openAwhDialog/);
  assert.match(automationSurface, /closeAwhDialog/);
  assert.match(designSystem, /\.awh-back-link\s*\{[^}]*min-height:\s*var\(--awh-touch-target\)/s);
});

test('every standalone Owner surface has a comfortable shared Back action and ships the navigation asset', async () => {
  for (const path of ['web/infrastructure.html', 'web/database.html', 'web/trust.html']) {
    const html = await read(path);
    assert.match(html, /data-awh-back/);
    assert.match(html, /class="[^"]*awh-back-link/);
    assert.match(html, /navigation\.js\?release=__AWH_WEB_RELEASE_ID__/);
  }

  const output = await mkdtemp(join(tmpdir(), 'awh-final-uat-shell-'));
  try {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/build-web-preview.ts', '--control'], {
      cwd: ROOT,
      shell: false,
      env: { ...process.env, AWH_WEB_OUTPUT_DIR: output, AWH_WEB_RELEASE_ID: 'final-uat-fixture', AWH_PREVIEW_GENERATED_AT: '2026-08-30T00:00:00.000Z' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => code === 0 ? resolve() : reject(new Error(stderr || `build exit ${code ?? -1}`)));
    });
    const [asset, worker, deploy, manifestBuilder] = await Promise.all([
      readFile(join(output, 'navigation.js'), 'utf8'),
      readFile(join(output, 'sw.js'), 'utf8'),
      read('deploy/awh-control-plane/deploy-control-plane.sh'),
      read('scripts/create-web-release-manifest.mjs'),
    ]);
    assert.doesNotMatch(asset, /__AWH_WEB_RELEASE_ID__/);
    assert.match(worker, /navigation\.js\?release=final-uat-fixture/);
    assert.match(deploy, /dist-web\/navigation\.js/);
    assert.match(manifestBuilder, /'navigation\.js'/);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('typed M16 deploy output contract accepts verified web manifest evidence and rejects untyped output', async () => {
  const validator = join(ROOT, 'deploy', 'awh-control-plane', 'validate-remote-output.sh');
  const accepted = await runWithInput(validator, 'DEPLOY_STAGE=WEB_RELEASE_COPY\nWEB_RELEASE_MANIFEST=PASS files=30\nDEPLOY_STAGE=WEB_MANIFEST_VERIFIED\nDEPLOY_RESULT=PASS\n');
  assert.equal(accepted.code, 0, accepted.stderr);
  assert.match(accepted.stdout, /WEB_RELEASE_MANIFEST=PASS files=30/);
  const bounded = await runWithInput(validator, 'WEB_RELEASE_MANIFEST=PASS files=101\n');
  assert.notEqual(bounded.code, 0);
  const rejected = await runWithInput(validator, 'DEPLOY_STAGE=WEB_RELEASE_COPY\nsecret=value\nDEPLOY_RESULT=PASS\n');
  assert.notEqual(rejected.code, 0);
});

test('public Desktop downloads stay hidden until the current Web manifest verifies their bytes', async () => {
  const [html, app] = await Promise.all([read('web/index.html'), read('web/app.js')]);
  assert.match(html, /class="login-downloads"[^>]*hidden/);
  assert.match(app, /async function loadVerifiedDesktopRelease/);
  assert.match(app, /desktopReleasePromise/);
  assert.match(app, /\^\[0-9a-f\]\{64\}\$/);
  assert.match(app, /Number\.isSafeInteger\(entry\.sizeBytes\)/);
  assert.match(app, /container\.hidden = available === 0/);
  assert.match(app, /link\.hidden = !entry/);
  assert.match(app, /void loadPublicDesktopRelease\(\)/);
});
