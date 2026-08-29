import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('P1 Tasks surface uses canonical control data and exposes a human-readable detail view', async () => {
  const dashboard = await read('web/dashboard.js');
  assert.match(dashboard, /id = 'dashboard-tasks'/);
  assert.match(dashboard, /data-task-filter="all"/);
  assert.match(dashboard, /data-task-filter="active"/);
  assert.match(dashboard, /data-task-filter="attention"/);
  assert.match(dashboard, /data-task-filter="completed"/);
  for (const field of ['control\.tasks', 'control\.artifacts', 'control\.approvals', 'control\.workers', 'executionStatus']) assert.match(dashboard, new RegExp(field));
  for (const field of ['dashboard-task-list', 'dashboard-task-detail', 'dashboard-task-count', 'dashboard-open-tasks']) assert.match(dashboard, new RegExp(field));
  assert.match(dashboard, /task\.execution\?\.continuation/);
  assert.match(dashboard, /safeArtifactDownloadUrl/);
  assert.doesNotMatch(dashboard, /\bSTATUS_LABELS\b|\bexecutionPlace\b/);
  assert.doesNotMatch(dashboard, /demo|mock|fake/i);
});

test('P1 Tasks surface remains touch-safe and avoids exposing raw artifact URLs', async () => {
  const dashboard = await read('web/dashboard.js');
  const css = await read('web/dashboard.css');
  assert.match(dashboard, /safeArtifactDownloadUrl/);
  assert.match(dashboard, /artifact\.downloadUrl/);
  assert.match(css, /\.awh-task-layout/);
  assert.match(css, /\.awh-task-filter\{min-height:40px/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /grid-template-columns:1fr/);
});
