import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(path, 'utf8');

test('visual QA constitution keeps AWH intent-first and hides backend vocabulary from L1/L2', async () => {
  const constitution = await read('docs/AWH-UX-CONSTITUTION.md');
  assert.match(constitution, /Home is Chat-first/);
  assert.match(constitution, /แชท · งานของฉัน · เครื่องมือ/);
  assert.match(constitution, /Backend vocabulary is forbidden in L1\/L2 UX/);
  assert.match(constitution, /390×844/);
  assert.match(constitution, /Stop/);
  assert.match(constitution, /Retry/);
});

test('AIPass findings are structured evidence rather than a parallel authority', async () => {
  const schema = JSON.parse(await read('scripts/review/aipass-findings.schema.json'));
  assert.equal(schema.properties.verdict.enum.join(','), 'PASS,REVIEW,BLOCK');
  assert.deepEqual(schema.properties.findings.items.properties.severity.enum, ['P0', 'P1', 'P2']);
  assert.equal(schema.properties.findings.items.properties.confidence.maximum, 1);
  const guide = await read('docs/AWH-VISUAL-QA.md');
  assert.match(guide, /reviewer.*, not a Production authority/i);
  assert.match(guide, /must never deploy/i);
});

test('review pack binds screenshots to the same clean committed revision', async () => {
  const pack = await read('scripts/review/create-ai-review-pack.mjs');
  assert.match(pack, /manifest\?\.commit !== commit/);
  assert.match(pack, /manifest\?\.dirty !== false/);
  assert.match(pack, /NO_WORKING_TREE_CONTENT/);
  assert.match(pack, /visual-evidence/);
  assert.doesNotMatch(pack, /curl|https:\/\/aipass/i);
});

test('visual renderer uses only the local contract fixture and reference viewports', async () => {
  const render = await read('scripts/review/render-ai-review-scenarios.mjs');
  const capture = await read('scripts/review/visual-review-capture.cjs');
  const scenarios = JSON.parse(await read('scripts/review/visual-review-scenarios.json'));
  assert.match(render, /127\.0\.0\.1/);
  assert.match(render, /390x844/);
  assert.match(render, /1440x900/);
  assert.match(capture, /horizontalOverflow/);
  assert.equal(scenarios.scenarios.length >= 8, true);
  assert.equal(scenarios.referenceViewports.length, 2);
});
