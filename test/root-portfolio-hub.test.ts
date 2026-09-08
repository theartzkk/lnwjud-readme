import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('authenticated root uses the same KRUART Golden Home instead of the legacy portfolio directory', async () => {
  const [html, app, css, dashboard] = await Promise.all([read('web/index.html'), read('web/app.js'), read('web/awh-light-system.css'), read('web/dashboard.js')]);
  assert.match(html, /id="public-home-view" class="public-home-view kruart-gateway"/);
  assert.match(html, /Art’s Workspace Hub/);
  assert.match(html, /id="ecosystem-home-view"/);
  assert.match(app, /function showKruartHome/);
  assert.match(app, /else \{\s*showKruartHome\(\{ replace: true \}\);\s*\}/);
  assert.match(app, /authenticatedDirectoryRequested\(\)/);
  assert.match(app, /openAwhWorkspace\('home'\)/);
  assert.match(app, /document\.querySelector\('\.brand'\)\?\.addEventListener\('click'/);
  assert.match(app, /window\.addEventListener\('awh:return-root-hub', \(\) => showKruartHome\(\)\)/);
  assert.match(dashboard, /awh:return-root-hub/);
  assert.match(css, /\.kruart-gateway/);
});

test('legacy portfolio directory remains an explicit secondary surface and reuses BAY registry authority', async () => {
  const [app, styles] = await Promise.all([read('web/app.js'), read('web/styles.css')]);
  assert.match(app, /fetch\('\/bay\/data\/projects\.json'/);
  assert.match(app, /fetch\('\/bay\/data\/releases\.json'/);
  assert.match(app, /url\.searchParams\.set\('awh-directory', '1'\)/);
  assert.match(app, /function safeText\(value, fallback = ''\)/);
  assert.match(app, /project\.id === 'awh'/);
  assert.match(app, /prototype: 'ต้นแบบ'/);
  assert.match(app, /reference: 'อ้างอิง'/);
  assert.match(app, /prototype:'pilot',reference:'internal'/);
  assert.match(styles, /\.ecosystem-project-grid/);
  assert.doesNotMatch(app, /localStorage.*ecosystem|indexedDB.*ecosystem/i);
});

test('root home and directory do not create a second project or release master authority', async () => {
  const app = await read('web/app.js');
  assert.doesNotMatch(app, /POST[^\n]*\/bay\/data\/projects|PUT[^\n]*\/bay\/data\/projects/i);
  assert.doesNotMatch(app, /ecosystemProjects\s*=\s*\[/);
  assert.match(app, /Source of Truth|BAY Ecosystem|renderEcosystemPortfolio/);
});
