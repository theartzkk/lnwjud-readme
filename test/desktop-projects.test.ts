import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Projects page exposes the real portable project identity contract', async () => {
  const html = await readFile(new URL('../desktop/index.html', import.meta.url), 'utf8');
  const renderer = await readFile(new URL('../desktop/renderer.js', import.meta.url), 'utf8');
  assert.match(html, /id="section-projects"/);
  assert.match(html, /id="project-list"/);
  assert.match(html, /id="section-memory"/);
  assert.match(renderer, /project\.name/);
  assert.match(renderer, /project\.type/);
  assert.match(renderer, /project\.selected/);
  assert.match(renderer, /project\.lastOpenedAt/);
  assert.match(renderer, /project\.localAvailable/);
});

test('Project Memory view is bounded and makes missing-file initialization explicit', async () => {
  const main = await readFile(new URL('../src/desktop/main.ts', import.meta.url), 'utf8');
  const renderer = await readFile(new URL('../desktop/renderer.js', import.meta.url), 'utf8');
  assert.match(main, /MAX_HANDOFF_PREVIEW_CHARS = 4_000/);
  assert.match(main, /handoff\.slice\(0, MAX_HANDOFF_PREVIEW_CHARS\)/);
  assert.match(renderer, /status === 'present' \? 'Present' : 'Missing'/);
  assert.match(renderer, /window\.artAgent\.initializeProjectMemory/);
  assert.match(renderer, /!Object\.values\(context\.memory \|\| \{\}\)\.includes\('missing'\)/);
});
