#!/usr/bin/env node
// Fail-closed evidence verification for the existing AWH UI release track.
// This is a verifier, not a release authority or a claim about other products.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const viewports = ['iphone-390','iphone-430','tablet-820','desktop-1366','desktop-1440'];
const kinds = ['Control Panel: responsive layout, mobile navigation and visual evidence',
               'Control Panel: accessibility audit on current responsive viewport'];
const shaRe = /^[a-f0-9]{40}$/i;
const hash = data => createHash('sha256').update(data).digest('hex');
function insist(condition, message) { if (!condition) throw new Error('VISUAL_RELEASE_GATE: ' + message); }

function collect(suites, output = []) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
      output.push({ title: spec.title, project: test.projectName, test });
    }
    collect(suite.suites, output);
  }
  return output;
}

export async function verifyReport(report, revision, { artifactsDir, expectedViewports = viewports } = {}) {
  insist(shaRe.test(revision), 'expected commit SHA required');
  insist(report?.config?.metadata?.revision === revision, 'Playwright report not attested to expected exact SHA');
  insist(report.stats?.unexpected === 0 && report.stats?.flaky === 0 && report.stats?.skipped === 0, 'suite has unexpected/flaky/skipped tests');
  const all = collect(report.suites);
  insist(all.length === expectedViewports.length * kinds.length, 'missing or extra viewport tests');
  const proof = [];
  for (const project of expectedViewports) for (const kind of kinds) {
    const found = all.filter(x => x.project === project && x.title === kind);
    insist(found.length === 1, project + ': expected exactly one ' + kind);
    const t = found[0].test;
    insist(t.status === 'expected' && t.results?.length === 1 && t.results[0].status === 'passed', project + ': test did not pass cleanly');
    const result = t.results[0];
    const expectedNames = kind === kinds[0] ? ['owner-panel-render.png','owner-panel-metrics.json'] : ['accessibility-findings.json'];
    const attachments = {};
    for (const name of expectedNames) {
      const att = result.attachments?.find(x => x.name === name);
      insist(att, project + ': missing attachment ' + name);
      let bytes;
      if (typeof att.body === 'string') bytes = Buffer.from(att.body, 'base64');
      else if (att.path && artifactsDir) {
        const path = resolve(att.path);
        insist(path.startsWith(resolve(artifactsDir) + '/'), 'attachment escapes test artifact directory');
        bytes = await readFile(path);
      } else throw new Error('VISUAL_RELEASE_GATE: missing attachment bytes ' + name);
      insist(bytes.length > 0, project + ': empty ' + name);
      if (name.endsWith('.png')) {
        insist(bytes.length > 1024 && bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) && bytes.toString('ascii',12,16) === 'IHDR', project + ': PNG signature/header invalid');
        insist(bytes.readUInt32BE(16) === Number(project.split('-')[1]), project + ': screenshot width does not match viewport');
      }
      if (name === 'owner-panel-metrics.json') {
        const evidence = JSON.parse(bytes.toString('utf8'));
        insist(evidence.viewport === project, 'viewport metric identifier mismatch');
        insist(evidence.metrics?.ownerDataReady === true, project + ': Owner data still loading or incomplete');
        insist(evidence.metrics?.documentWidth <= evidence.metrics?.clientWidth + 1, project + ': horizontal overflow');
        insist(Array.isArray(evidence.metrics.csp) && evidence.metrics.csp.length === 0 &&
          Array.isArray(evidence.exceptions) && evidence.exceptions.length === 0 &&
          Array.isArray(evidence.csp) && evidence.csp.length === 0, project + ': CSP/JS error evidence');
      }
      if (name === 'accessibility-findings.json') insist(JSON.parse(bytes.toString('utf8'))?.length === 0, project + ': axe violations');
      attachments[name] = { sha256: hash(bytes), bytes: bytes.length };
    }
    proof.push({ viewport: project, check: kind === kinds[0] ? 'responsive' : 'accessibility', attachments });
  }
  return { schemaVersion: 1, sourceRevision: revision, product: 'awh-control-panel',
    verdict: 'PASS', viewportCount: expectedViewports.length, checks: proof };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 3) throw new Error('Usage: visual-evidence-gate.mjs <playwright-report.json> <exact-commit-sha> <output.json>');
  const [input, revision, output] = args;
  insist(shaRe.test(revision), '40-character exact commit SHA required');
  const head = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  insist(head === revision, 'checkout HEAD is different from requested source SHA');
  // Any tracked source modifications invalidate provenance. Build outputs are ignored.
  const dirty = execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim();
  insist(!dirty, 'source checkout has uncommitted tracked changes');
  const report = JSON.parse(await readFile(input,'utf8'));
  const evidence = await verifyReport(report, revision, {artifactsDir:'.awh-local/review/playwright/artifacts'});
  await mkdir(dirname(resolve(output)),{recursive:true});
  await writeFile(output, JSON.stringify(evidence,null,2) + '\n');
  console.log('VISUAL_RELEASE_GATE=PASS');
  console.log('SHA=' + revision);
  console.log('VIEWPORTS=' + evidence.viewportCount);
  console.log('EVIDENCE=' + output);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error?.message ?? error); process.exitCode = 1; });
}
