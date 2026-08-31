#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const beforeDir = resolve(process.argv[2] || '');
const afterDir = resolve(process.argv[3] || '');
if (!process.argv[2] || !process.argv[3]) throw new Error('usage: compare-visual-evidence.mjs <before-dir> <after-dir> [output-dir]');

function loadEvidence(dir) {
  const manifestPath = join(dir, 'VISUAL_EVIDENCE.json');
  if (!existsSync(manifestPath)) throw new Error(`missing visual evidence manifest: ${dir}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest?.schemaVersion !== 1 || manifest?.dirty !== false || !/^[0-9a-f]{40}$/.test(manifest?.commit || '')) throw new Error(`invalid clean visual evidence: ${dir}`);
  return manifest;
}

const before = loadEvidence(beforeDir);
const after = loadEvidence(afterDir);
const pairId = `${before.commit.slice(0, 12)}-to-${after.commit.slice(0, 12)}`;
const output = resolve(process.argv[4] || join(ROOT, '.awh-local/review/compare', pairId));
rmSync(output, { recursive: true, force: true });
mkdirSync(join(output, 'before'), { recursive: true, mode: 0o700 });
mkdirSync(join(output, 'after'), { recursive: true, mode: 0o700 });
const scenarios = JSON.parse(readFileSync(join(ROOT, 'scripts/review/visual-review-scenarios.json'), 'utf8')).scenarios || [];
const viewports = Array.from(new Set([...(before.viewports || []), ...(after.viewports || [])]));
const pairs = [];
for (const scenario of scenarios) {
  for (const viewport of viewports) {
    const name = `${scenario.id}-${viewport}.png`;
    const beforePath = join(beforeDir, name); const afterPath = join(afterDir, name);
    if (!existsSync(beforePath) || !existsSync(afterPath)) continue;
    copyFileSync(beforePath, join(output, 'before', name));
    copyFileSync(afterPath, join(output, 'after', name));
    pairs.push({ scenario: scenario.id, viewport, expected: scenario.expected, before: `before/${name}`, after: `after/${name}` });
  }
}
if (pairs.length < 2) throw new Error('comparison has too few matching screenshot pairs');
const manifest = {
  schemaVersion: 1,
  kind: 'visual-before-after',
  generatedAt: new Date().toISOString(),
  beforeCommit: before.commit,
  afterCommit: after.commit,
  pairCount: pairs.length,
  pairs,
};
writeFileSync(join(output, 'COMPARE_MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
const prompt = `# AWH Before/After visual verification\n\nCompare the paired screenshots in before/ and after/. Evaluate only regressions and unresolved UX-contract defects. Do not praise unchanged areas.\n\nBefore: ${before.commit}\nAfter: ${after.commit}\nPairs: ${pairs.length}\n\nFor each defect, cite scenario + viewport and state whether it is NEW, REGRESSION, IMPROVED_BUT_OPEN, or RESOLVED. A P0 must be reproducible from the paired evidence.\n`;
writeFileSync(join(output, 'COMPARE_PROMPT.md'), prompt, { mode: 0o600 });
process.stdout.write(JSON.stringify({ status: 'PASS', output, before: before.commit, after: after.commit, pairs: pairs.length }, null, 2) + '\n');
