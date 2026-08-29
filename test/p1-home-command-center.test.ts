import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('P1 Home command center presents real control data with role-aware worker detail', async () => {
  const dashboard = await read('web/dashboard.js');
  const css = await read('web/dashboard.css');
  assert.match(dashboard, /pulse\.id = 'dashboard-pulse'/);
  assert.match(dashboard, /control\.projects/);
  assert.match(dashboard, /control\.tasks/);
  assert.match(dashboard, /control\.artifacts/);
  assert.match(dashboard, /control\.approvals/);
  assert.match(dashboard, /control\.role !== 'OWNER'/);
  assert.match(dashboard, /data-pulse-target="work"/);
  assert.match(dashboard, /data-pulse-target="files"/);
  assert.match(dashboard, /data-product-destination/);
  assert.match(dashboard, /aria-current/);
  assert.match(css, /\.awh-pulse-grid/);
  assert.match(css, /\.awh-pulse-card/);
  assert.match(css, /@media\(max-width:540px\)/);
  assert.doesNotMatch(dashboard, /demo|mock|fake/i);
});

test('P1 Home command center keeps critical cards keyboard and touch usable', async () => {
  const dashboard = await read('web/dashboard.js');
  const css = await read('web/dashboard.css');
  assert.match(dashboard, /class="awh-pulse-card" type="button"/);
  assert.match(css, /min-height:.*44px|padding:.*14px/);
  assert.match(css, /overflow-wrap|word-break/);
});
