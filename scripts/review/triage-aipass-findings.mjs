#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const input = resolve(process.argv[2] || '');
const revision = process.argv[3] || '';
if (!process.argv[2] || !/^[0-9a-f]{40}$/.test(revision)) throw new Error('usage: triage-aipass-findings.mjs <findings.json> <revision> [output.md]');
execFileSync(process.execPath, ['scripts/review/validate-aipass-findings.mjs', input, revision], { cwd: ROOT, stdio: 'inherit' });
const findings = JSON.parse(readFileSync(input, 'utf8'));
const reviewer = String(findings.reviewer || 'reviewer').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 50) || 'reviewer';
const output = resolve(process.argv[4] || `.awh-local/review/triage/${revision.slice(0, 12)}-${reviewer}.md`);
const groups = Object.fromEntries(['P0','P1','P2'].map((severity) => [severity, findings.findings.filter((item) => item.severity === severity)]));
const scoreLine = Object.entries(findings.scores).map(([key, value]) => `${key} ${value}/100`).join(' · ');
const lines = [
  '# AWH Visual Review Triage', '',
  `Revision: \`${revision}\``,
  `Reviewer: ${findings.reviewer}`,
  `Verdict: **${findings.verdict}**`,
  `Scores: ${scoreLine}`, '',
];
for (const severity of ['P0','P1','P2']) {
  lines.push(`## ${severity} · ${groups[severity].length}`, '');
  for (const item of groups[severity]) {
    lines.push(`### ${item.id} — ${item.scenario}`);
    lines.push(`- Problem: ${item.problem}`);
    lines.push(`- Evidence: ${item.evidence}`);
    lines.push(`- Expected: ${item.expected}`);
    lines.push(`- Fix layer: \`${item.fixLayer}\` · confidence ${Math.round(item.confidence * 100)}%`);
    if (Array.isArray(item.sourcePaths) && item.sourcePaths.length) lines.push(`- Source hints: ${item.sourcePaths.map((path) => `\`${path}\``).join(', ')}`);
    lines.push('');
  }
}
lines.push('## Authority note', '', 'This triage is reviewer evidence only. It does not create a second issue queue and does not authorize source or Production changes.', '');
mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
writeFileSync(output, lines.join('\n'), { mode: 0o600 });
process.stdout.write(JSON.stringify({ status: 'PASS', revision, reviewer: findings.reviewer, verdict: findings.verdict, output, counts: Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, value.length])) }, null, 2) + '\n');
