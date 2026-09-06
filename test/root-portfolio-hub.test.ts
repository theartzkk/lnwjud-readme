import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('authenticated root is the portfolio hub and reuses BAY registry authority', async () => {
  const [html, app, css, dashboard] = await Promise.all([read('web/index.html'), read('web/app.js'), read('web/styles.css'), read('web/dashboard.js')]);
  assert.match(html, /id="ecosystem-home-view"/);
  assert.match(html, /งานและระบบทั้งหมดของเรา/);
  assert.match(html, /id="ecosystem-project-grid"/);
  assert.match(html, /id="ecosystem-search-input"/);
  assert.match(app, /fetch\('\/bay\/data\/projects\.json'/);
  assert.match(app, /fetch\('\/bay\/data\/releases\.json'/);
  assert.match(app, /function safeText\(value, fallback = ''\)/);
  assert.match(app, /showEcosystemHome\(\{ replace: true \}\)/);
  assert.match(app, /if \(authenticatedSurfaceRequested\(\)\)/);
  assert.match(app, /project\.id === 'awh'/);
  assert.match(app, /openAwhWorkspace\('home'\)/);
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
