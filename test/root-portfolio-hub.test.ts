import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('authenticated root is the portfolio hub and reuses BAY registry authority', async () => {
  const [html, app, css, dashboard] = await Promise.all([read('web/index.html'), read('web/app.js'), read('web/styles.css'), read('web/dashboard.js')]);
  assert.match(html, /id="ecosystem-home-view"/);
  assert.match(html, /พื้นที่ทำงานของเรา/);
  assert.match(html, /id="ecosystem-project-grid"/);
  assert.match(html, /id="ecosystem-search-input"/);
  assert.match(app, /fetch\('\/bay\/data\/projects\.json'/);
  assert.match(app, /fetch\('\/bay\/data\/releases\.json'/);
  assert.match(app, /const statusPromise = fetch\('\/bay\/api\/status\.php'/);
  assert.match(app, /const \[projectResponse, releaseResponse\] = await Promise\.all/);
  assert.match(app, /function safeText\(value, fallback = ''\)/);
  assert.match(app, /showEcosystemHome\(\{ replace: true \}\)/);
  assert.match(app, /if \(authenticatedSurfaceRequested\(\)\)/);
  assert.match(app, /project\.id === 'awh'/);
  assert.match(app, /prototype: 'ต้นแบบ'/);
  assert.match(app, /reference: 'อ้างอิง'/);
  assert.match(app, /const projectLifecycle = \(project\) =>/);
  assert.match(app, /lifecycleLabel/);
  assert.match(app, /ecosystem-project-health/);
  assert.match(app, /bay-staging/);
  assert.match(app, /ไม่พบระบบหรือโปรเจกต์ที่ตรงกับ/);
  assert.match(app, /openAwhWorkspace\('home'\)/);
  assert.match(app, /syncOwnerGlobalNavigation\('awh'\)/);
  assert.match(app, /syncOwnerGlobalNavigation\('home'\)/);
  assert.match(app, /const PROJECT_VISUALS = Object\.freeze/);
  assert.match(app, /'bay-computer-lab': 'computer-lab'/);
  assert.match(app, /'bay-parent-connect': 'parent-connect'/);
  assert.match(app, /liveDetail = safeText\(live\?\.version\)/);
  for (const asset of ['project-bay-excuse-x.webp','project-learnlab.webp','project-awh.webp','project-school.webp','project-parent-connect.webp','project-computer-lab.webp','project-kruart-online.webp']) assert.ok(app.includes(asset));
  for (const logo of ['logo-bay-excuse-x.webp','logo-bay-learnlab.webp','brand-awh.webp','logo-school.webp','logo-bay-computer-lab.webp','brand-kruart-online.webp']) assert.ok(app.includes(logo));
  assert.match(app, /ecosystem-project-media/);
  assert.match(app, /ecosystem-project-banner/);
  assert.match(app, /ecosystem-project-logo/);
  assert.match(dashboard, /awh:return-root-hub/);
  assert.match(css, /\.ecosystem-project-grid/);
  assert.match(css, /body\.ecosystem-home-active \.awh-mobile-nav\{display:none!important\}/);
  assert.doesNotMatch(app, /localStorage.*ecosystem|indexedDB.*ecosystem/i);
});

test('root portfolio does not create a second project or release master authority', async () => {
  const app = await read('web/app.js');
  assert.doesNotMatch(app, /POST[^\n]*\/bay\/data\/projects|PUT[^\n]*\/bay\/data\/projects/i);
  assert.doesNotMatch(app, /ecosystemProjects\s*=\s*\[/);
  assert.match(app, /Source of Truth|Source of Truth|BAY Ecosystem|renderEcosystemPortfolio/);
});


test('all KRUART login entry points share the canonical login surface', async () => {
  const [html, app] = await Promise.all([read('web/index.html'), read('web/app.js')]);
  const triggers = html.match(/data-open-login/g) || [];
  assert.ok(triggers.length >= 5);
  assert.match(app, /function openLoginSurface\(\)/);
  assert.match(app, /querySelectorAll\('\[data-open-login\]'\)\.forEach/);
  assert.doesNotMatch(app, /\$\('public-login-open'\)\?\.addEventListener\('click'/);
  assert.match(html, /ชื่อผู้ใช้ AWH หรืออีเมลที่ผูกกับบัญชี/);
});

test('authenticated root is an AWH cockpit with live readiness and role-aware navigation', async () => {
  const [html, app, css] = await Promise.all([read('web/index.html'), read('web/app.js'), read('web/kruart-system.css')]);
  assert.match(html, /id="ecosystem-command-form"/);
  assert.match(html, /id="ecosystem-live-list"/);
  assert.match(html, /id="owner-global-nav"/);
  assert.match(app, /routeOwnerCommand/);
  assert.match(app, /liveProjectService/);
  assert.match(app, /owner-only-nav/);
  assert.match(css, /KRUART Golden Owner Home/);
  assert.match(css, /Final UX closure/);
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
  assert.match(css, /ecosystem-project-health/);
  assert.match(css, /min-height:44px!important/);
  assert.match(css, /body\.ecosystem-home-active \.kruart-header \.global-nav[\s\S]{0,180}display:none!important/);
  assert.match(html, /owner-system-directory-link[^>]*>ศูนย์ระบบ</);
});
