#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('usage: validate-aipass-findings.mjs <findings.json> [revision]');
const expectedRevision = process.argv[3] || null;
const value = JSON.parse(readFileSync(file, 'utf8'));
const fail = (message) => { throw new Error(`AIPASS_FINDINGS_INVALID: ${message}`); };
const isScore = (n) => Number.isInteger(n) && n >= 0 && n <= 100;
const severities = new Set(['P0', 'P1', 'P2']);
const verdicts = new Set(['PASS', 'REVIEW', 'BLOCK']);
const layers = new Set(['intent-router','conversation','task-execution','artifact','navigation','composer','copy','mobile-layout','recovery','accessibility','architecture','unknown']);

if (value?.schemaVersion !== 1) fail('schemaVersion');
if (!/^[0-9a-f]{40}$/.test(value?.revision || '')) fail('revision');
if (expectedRevision && value.revision !== expectedRevision) fail('revision does not match candidate');
if (typeof value.reviewer !== 'string' || value.reviewer.trim().length < 2 || value.reviewer.length > 80) fail('reviewer');
if (!verdicts.has(value.verdict)) fail('verdict');
for (const key of ['chat','mobile','agentic','artifact','recovery']) if (!isScore(value?.scores?.[key])) fail(`scores.${key}`);
if (!Array.isArray(value.findings) || value.findings.length > 30) fail('findings');
for (const [index, finding] of value.findings.entries()) {
  if (!finding || typeof finding !== 'object' || Array.isArray(finding)) fail(`finding ${index}`);
  if (!/^[a-z0-9-]{3,64}$/.test(finding.id || '')) fail(`finding ${index} id`);
  if (!severities.has(finding.severity)) fail(`finding ${index} severity`);
  for (const key of ['scenario','problem','evidence','expected']) if (typeof finding[key] !== 'string' || finding[key].trim().length < 2) fail(`finding ${index} ${key}`);
  if (!layers.has(finding.fixLayer)) fail(`finding ${index} fixLayer`);
  if (typeof finding.confidence !== 'number' || finding.confidence < 0 || finding.confidence > 1) fail(`finding ${index} confidence`);
  if (finding.sourcePaths !== undefined && (!Array.isArray(finding.sourcePaths) || finding.sourcePaths.length > 8 || finding.sourcePaths.some((p) => typeof p !== 'string' || p.length > 240))) fail(`finding ${index} sourcePaths`);
}
const p0 = value.findings.filter((finding) => finding.severity === 'P0');
if (p0.length > 0 && value.verdict !== 'BLOCK') fail('P0 requires BLOCK');
if (value.verdict === 'PASS' && value.findings.some((finding) => finding.severity === 'P0' || finding.severity === 'P1')) fail('PASS cannot include P0/P1');
process.stdout.write(JSON.stringify({ status: 'PASS', revision: value.revision, reviewer: value.reviewer, verdict: value.verdict, findings: value.findings.length, p0: p0.length }, null, 2) + '\n');
