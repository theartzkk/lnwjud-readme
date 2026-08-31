import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('usage: validate-aipass-findings.mjs <findings.json> [revision]');
const expectedRevision = process.argv[3] || null;
const raw = readFileSync(file, 'utf8');
if (Buffer.byteLength(raw) > 65536) throw new Error('AIPASS_FINDINGS_INVALID: document too large');
const value = JSON.parse(raw);
const fail = (message) => { throw new Error(`AIPASS_FINDINGS_INVALID: ${message}`); };
const exactKeys = (object, allowed, optional = []) => {
  if (!object || typeof object !== 'object' || Array.isArray(object)) fail('object');
  for (const key of allowed) if (!optional.includes(key) && !Object.hasOwn(object, key)) fail(`missing ${key}`);
  for (const key of Object.keys(object)) if (!allowed.includes(key)) fail(`unexpected ${key}`);
};
const boundedText = (value, min, max, field, allowEmpty = false) => {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value) || value.length > max || (!allowEmpty && (value.trim().length < min || value.length < min))) fail(field);
};
const isScore = (n) => Number.isInteger(n) && n >= 0 && n <= 100;
const severities = new Set(['P0', 'P1', 'P2']);
const verdicts = new Set(['PASS', 'REVIEW', 'BLOCK']);
const layers = new Set(['intent-router','conversation','task-execution','artifact','navigation','composer','copy','mobile-layout','recovery','accessibility','architecture','unknown']);

exactKeys(value, ['schemaVersion','revision','reviewer','verdict','scores','findings']);
if (value.schemaVersion !== 1) fail('schemaVersion');
if (!/^[0-9a-f]{40}$/.test(value.revision || '')) fail('revision');
if (expectedRevision && value.revision !== expectedRevision) fail('revision does not match candidate');
boundedText(value.reviewer, 2, 80, 'reviewer');
if (!verdicts.has(value.verdict)) fail('verdict');
exactKeys(value.scores, ['chat','mobile','agentic','artifact','recovery']);
for (const key of ['chat','mobile','agentic','artifact','recovery']) if (!isScore(value.scores[key])) fail(`scores.${key}`);
if (!Array.isArray(value.findings) || value.findings.length > 30) fail('findings');
for (const [index, finding] of value.findings.entries()) {
  exactKeys(finding, ['id','severity','scenario','problem','evidence','expected','fixLayer','confidence','sourcePaths'], ['sourcePaths']);
  if (!/^[a-z0-9-]{3,64}$/.test(finding.id || '')) fail(`finding ${index} id`);
  if (!severities.has(finding.severity)) fail(`finding ${index} severity`);
  boundedText(finding.scenario, 2, 80, `finding ${index} scenario`);
  for (const key of ['problem','evidence','expected']) boundedText(finding[key], 5, 600, `finding ${index} ${key}`);
  if (!layers.has(finding.fixLayer)) fail(`finding ${index} fixLayer`);
  if (typeof finding.confidence !== 'number' || !Number.isFinite(finding.confidence) || finding.confidence < 0 || finding.confidence > 1) fail(`finding ${index} confidence`);
  if (finding.sourcePaths !== undefined) {
    if (!Array.isArray(finding.sourcePaths) || finding.sourcePaths.length > 8) fail(`finding ${index} sourcePaths`);
    for (const path of finding.sourcePaths) boundedText(path, 0, 240, `finding ${index} sourcePaths`, true);
  }
}
const p0 = value.findings.filter((finding) => finding.severity === 'P0');
if (p0.length > 0 && value.verdict !== 'BLOCK') fail('P0 requires BLOCK');
if (value.verdict === 'PASS' && value.findings.some((finding) => finding.severity === 'P0' || finding.severity === 'P1')) fail('PASS cannot include P0/P1');
process.stdout.write(JSON.stringify({ status: 'PASS', revision: value.revision, reviewer: value.reviewer, verdict: value.verdict, findings: value.findings.length, p0: p0.length }, null, 2) + '\n');
