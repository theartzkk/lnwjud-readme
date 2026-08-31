import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = (path: string) => readFile(path, 'utf8');

test('reviewer policy is role-based, budgeted and official-UI only', async () => {
  const policy = JSON.parse(await read('scripts/review/reviewer-policy.json'));
  assert.equal(policy.schemaVersion, 1);
  assert.equal(policy.accessBoundary, 'official-ui-only');
  assert.equal(policy.dailyCreditBudget, 10000);
  assert.ok(policy.roles['visual-primary']);
  assert.ok(policy.roles['visual-second-opinion']);
  assert.ok(policy.roles['architecture-judge']);
  assert.ok(policy.roles['final-adversarial']);
  const credits = Object.values(policy.roles).reduce((sum: number, role: any) => sum + Number(role.suggestedCredits || 0), 0);
  assert.equal(credits, 10000);
});

test('visual evidence is retained by exact revision and compared safely', async () => {
  const create = await read('scripts/review/create-visual-review-pack.mjs');
  const compare = await read('scripts/review/compare-visual-evidence.mjs');
  assert.match(create, /review\/history\/\$\{commit\.slice\(0, 12\)\}/);
  assert.match(compare, /manifest\?\.dirty !== false/);
  assert.match(compare, /beforeCommit/);
  assert.match(compare, /afterCommit/);
  assert.match(compare, /IMPROVED_BUT_OPEN/);
});
test('retention is audit-only and cannot delete review evidence', async () => {
  const retention = await read('scripts/review/cleanup-visual-review-cache.mjs');
  assert.match(retention, /AUDIT_ONLY/);
  assert.match(retention, /purgeCandidates/);
  assert.doesNotMatch(retention, /rmSync|unlinkSync|rmdirSync|execFileSync|spawn/);
});

test('findings triage validates first and stays reviewer evidence only', async () => {
  const triage = await read('scripts/review/triage-aipass-findings.mjs');
  assert.match(triage, /validate-aipass-findings\.mjs/);
  assert.match(triage, /does not create a second issue queue/);
  assert.doesNotMatch(triage, /control_tasks|INSERT INTO|deploy|activation/i);
});

test('daily review pack carries reviewer policy without granting AiPASS runtime access', async () => {
  const pack = await read('scripts/review/create-ai-review-pack.mjs');
  const pkg = JSON.parse(await read('package.json'));
  assert.match(pack, /REVIEWER_POLICY\.json/);
  assert.match(pack, /AWH-VISUAL-QA\.md/);
  assert.equal(pkg.scripts['review:compare'], 'node scripts/review/compare-visual-evidence.mjs');
  assert.equal(pkg.scripts['review:triage'], 'node scripts/review/triage-aipass-findings.mjs');
  assert.equal(pkg.scripts['review:retention'], 'node scripts/review/cleanup-visual-review-cache.mjs');
  assert.equal(pkg.scripts['review:verify'], 'node scripts/review/create-visual-verification-pack.mjs');
  const verify = await read('scripts/review/create-visual-verification-pack.mjs');
  assert.match(verify, /AWH_AI_REVIEW_COMPARE_DIR/);
  assert.match(verify, /visual verification requires a clean committed working tree/);
});


test('visual review scenarios permanently cover Owner Product Review on the iPhone reference viewport', async () => {
  const scenarios = JSON.parse(await read('scripts/review/visual-review-scenarios.json'));
  assert.ok(scenarios.referenceViewports.some((viewport: any) => viewport.id === 'iphone' && viewport.width === 390 && viewport.height === 844));
  const review = scenarios.scenarios.find((scenario: any) => scenario.id === 'product-review-cloud');
  assert.equal(review?.surface, 'review');
  assert.match(String(review?.expected || ''), /390x844/);
  assert.match(String(review?.expected || ''), /Stop/);
  assert.match(String(review?.expected || ''), /Owner step-up/);
});
