import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Visual QA contract is fixture-first and does not grant deployment authority', async () => {
  const constitution = await read('docs/AWH-UX-CONSTITUTION.md');
  const guide = await read('docs/AWH-VISUAL-QA.md');
  const roles = await read('docs/AWH-REVIEW-MODEL-ROLES.md');
  assert.match(constitution, /root.*Project Portfolio Hub|Project Portfolio Hub/i);
  assert.match(constitution, /AWH Workspace.*Chat-first|Chat-first.*AWH Workspace/i);
  assert.match(constitution, /3 mobile destinations|3.*แท็บ|three/i);
  assert.match(constitution, /RUNNING|Worker|Provider|backend/i);
  assert.match(guide, /Render.*Package.*Review|render/i);
  assert.match(roles, /Review is evidence, never Production authority/i);
});

test('visual renderer binds evidence to a clean exact revision', async () => {
  const runner = await read('scripts/review/render-ai-review-scenarios.mjs');
  const capture = await read('scripts/review/visual-review-capture.cjs');
  assert.match(runner, /rev-parse/);
  assert.match(runner, /status.*--porcelain/);
  assert.match(runner, /local-contract-fixture/);
  for (const viewport of ['390x844','430x932','820x1024','1366x768','1440x900']) assert.ok(runner.includes(viewport), viewport + ' viewport must be eligible');
  assert.match(capture, /sourceId/);
  assert.match(capture, /390x844/);
  assert.match(capture, /horizontalOverflow/);
  assert.match(capture, /root-portfolio/);
  assert.match(capture, /runtimeErrors/);
  assert.match(capture, /question-identity/);
  assert.match(capture, /panel\.html/);
  assert.match(capture, /#cp-people-list/);
  assert.doesNotMatch(capture, /data-profile-section=.*people/);
});
test('review pack and findings validator preserve fail-closed evidence rules', async () => {
  const pack = await read('scripts/review/create-ai-review-pack.mjs');
  const validator = await read('scripts/review/validate-review-findings.mjs');
  const schema = JSON.parse(await read('scripts/review/review-findings.schema.json'));
  assert.match(pack, /AWH_AI_REVIEW_EVIDENCE_DIR/);
  assert.match(pack, /manifest\?\.schemaVersion !== 2/);
  assert.match(pack, /manifest\?\.commit !== commit/);
  assert.match(await read('scripts/review/render-ai-review-scenarios.mjs'), /schemaVersion: 2/);
  assert.match(pack, /manifest\?\.dirty !== false/);
  assert.match(pack, /NO_WORKING_TREE_CONTENT/);
  assert.match(pack, /FINDINGS_SCHEMA\.json/);
  assert.match(validator, /P0 requires BLOCK/);
  assert.equal(schema.properties.verdict.enum.includes('BLOCK'), true);
  assert.equal(schema.properties.findings.items.properties.severity.enum.includes('P0'), true);
});

test('visual review scenario set covers conversation, work, artifact and recovery UX', async () => {
  const config = JSON.parse(await read('scripts/review/visual-review-scenarios.json'));
  const ids = new Set(config.scenarios.map((scenario: { id: string }) => scenario.id));
  for (const id of ['root-portfolio','home-empty','question-identity','work-progress','document-artifact','failed-retry','artifact-follow-up']) assert.equal(ids.has(id), true, id);
  assert.equal(config.referenceViewports.some((item: { width: number; height: number }) => item.width === 390 && item.height === 844), true);
  assert.equal(config.referenceViewports.some((item: { width: number; height: number }) => item.width === 1440 && item.height === 900), true);
});
