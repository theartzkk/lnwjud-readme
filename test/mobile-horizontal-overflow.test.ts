import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isViewportWidthBounded } from '../web/navigation.js';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('shared mobile layout rejects a document wider than its viewport', () => {
  assert.equal(isViewportWidthBounded({ clientWidth: 390, scrollWidth: 390 }), true);
  assert.equal(isViewportWidthBounded({ clientWidth: 390, scrollWidth: 391 }), false);
  assert.equal(isViewportWidthBounded({ clientWidth: 0, scrollWidth: 0 }), false);
});

test('Web surfaces keep page width bounded while allowing scoped content scrolling', async () => {
  const [styles, responsiveLayout, build, manifest, serviceWorker, infrastructure, database, trust] = await Promise.all([
    read('web/styles.css'),
    read('web/responsive-layout.css'),
    read('scripts/build-web-preview.ts'),
    read('scripts/create-web-release-manifest.mjs'),
    read('web/sw.js'),
    read('web/infrastructure.html'),
    read('web/database.html'),
    read('web/trust.html'),
  ]);

  assert.match(styles, /html,\s*body\s*\{[^}]*max-width:\s*100%/s);
  assert.match(styles, /body\s*\{[^}]*overflow-x:\s*clip/s);
  assert.match(styles, /\.composer\s*\{[^}]*min-width:\s*0/s);
  assert.match(styles, /\.composer\s*\{[^}]*margin:\s*0/s);
  assert.match(styles, /\.workstream,\s*\.work-thread,\s*\.task-turn,\s*\.task-response,\s*\.composer\s*\{[^}]*min-width:\s*0/s);
  assert.match(styles, /pre\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/s);
  assert.match(styles, /code\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(responsiveLayout, /\.product-dashboard,[\s\S]*\.awh-command-form,[\s\S]*\.awh-mobile-nav/);
  assert.match(responsiveLayout, /min-width:\s*0;\s*max-width:\s*100%/);
  assert.match(responsiveLayout, /\.awh-mobile-nav\)\s*\{\s*max-width:\s*calc\(100% - 16px\)/s);
  assert.match(responsiveLayout, /\.awh-home-overview,[\s\S]*\.awh-task-layout[\s\S]*> \* \{ min-width: 0; max-width: 100%; \}/);
  assert.match(responsiveLayout, /\.awh-recent-panel,[\s\S]*\.awh-status-item,[\s\S]*min-width: 0; max-width: 100%/);
  assert.match(responsiveLayout, /\.awh-heading-actions\) \{ display: flex; flex-wrap: wrap; \}/);
  assert.match(responsiveLayout, /\.awh-recent-item > span,[\s\S]*flex: 1 1 auto/);
  assert.match(responsiveLayout, /\.awh-status-item strong,[\s\S]*\.awh-tool-copy strong,[\s\S]*\.awh-artifact-card small,[\s\S]*overflow-wrap: anywhere/);
  assert.match(build, /responsive-layout\.css\?release=__AWH_WEB_RELEASE_ID__/);
  assert.match(manifest, /'responsive-layout\.css'/);
  assert.match(serviceWorker, /responsive-layout\.css\?release=__AWH_WEB_RELEASE_ID__/);
  for (const html of [infrastructure, database, trust]) {
    assert.match(html, /responsive-layout\.css\?release=__AWH_WEB_RELEASE_ID__/);
  }
});
