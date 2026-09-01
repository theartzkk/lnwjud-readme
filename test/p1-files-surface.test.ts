import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('P1 Files surface is a real artifact library over the canonical control projection', async () => {
  const [dashboard, review, index] = await Promise.all([read('web/dashboard.js'), read('web/review.html'), read('web/index.html')]);
  assert.match(dashboard, /id = 'dashboard-files'/);
  assert.match(dashboard, /id="dashboard-files-form"/);
  assert.match(dashboard, /id="dashboard-files-search"/);
  assert.match(dashboard, /control\.artifacts/);
  assert.match(dashboard, /artifact\.taskId/);
  assert.match(dashboard, /artifact\.projectId/);
  assert.match(dashboard, /safeArtifactDownloadUrl/);
  assert.match(dashboard, /openFilesSurface/);
  assert.match(dashboard, /requestedDeepLinkSurface/);
  assert.match(dashboard, /searchParams\.get\('awh-surface'\)/);
  assert.match(review, /href="\.\/\?awh-surface=files"/);
  assert.match(index, /id="session-check-view"/);
  assert.doesNotMatch(dashboard, /demo|mock|fake/i);
});

test('P1 Files surface keeps search, download and mobile layout bounded', async () => {
  const dashboard = await read('web/dashboard.js');
  const css = await read('web/dashboard.css');
  assert.match(dashboard, /artifact\.downloadUrl/);
  assert.match(dashboard, /link\.download/);
  assert.match(css, /\.awh-files-search/);
  assert.match(css, /\.awh-file-item/);
  assert.match(css, /@media\(max-width:540px\)/);
  assert.match(css, /grid-template-columns:auto minmax\(0,1fr\)/);
});
