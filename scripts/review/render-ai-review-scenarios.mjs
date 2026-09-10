#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const commit = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['-C', ROOT, 'status', '--porcelain'], { encoding: 'utf8' }).trim() !== '';
if (dirty && process.env.AWH_VISUAL_QA_ALLOW_DIRTY !== '1') throw new Error('visual review requires a clean committed revision');
const output = resolve(process.argv[2] || join(ROOT, '.awh-local/review/visual'));
const port = Number.parseInt(process.env.AWH_VISUAL_QA_PORT || '4197', 10);
const baseUrl = `http://127.0.0.1:${port}/`;
const electronCandidates = [
  process.env.AWH_ELECTRON_BIN,
  join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  join(ROOT, 'node_modules/electron/dist/electron.exe'),
  join(ROOT, 'node_modules/electron/dist/electron'),
  join(ROOT, 'node_modules/.bin/electron'),
].filter(Boolean);
const electron = electronCandidates.find((candidate) => existsSync(candidate));
if (!existsSync(join(ROOT, 'dist-web/index.html'))) throw new Error('dist-web is missing; run npm run web:build:control first');
if (!electron) throw new Error(`Electron binary is missing; checked ${electronCandidates.join(', ')}`);
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true, mode: 0o700 });

function waitForFixture(child) {
  return new Promise((resolveReady, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('visual fixture did not start')), 10000);
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk);
      if (buffer.includes(`AWH_CONTROL_WEB_FIXTURE=${baseUrl}`)) { clearTimeout(timer); resolveReady(); }
    });
    child.once('error', reject);
    child.once('exit', (code) => { if (code !== null) reject(new Error(`visual fixture exited ${code}`)); });
  });
}
function runCapture(viewport) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(electron, [join(ROOT, 'scripts/review/visual-review-capture.cjs'), baseUrl, output, viewport], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } });
    let stderr = ''; let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk).slice(0, 8192); });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolveRun({ viewport, stdout }) : reject(new Error(`capture ${viewport} failed (${code}): ${stderr.trim()}`)));
  });
}

const fixture = spawn(process.execPath, [join(ROOT, 'scripts/qa/control-web-fixture.mjs')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AWH_WEB_FIXTURE_PORT: String(port) } });
let fixtureError = '';
fixture.stderr.on('data', (chunk) => { fixtureError += String(chunk).slice(0, 8192); });
try {
  await waitForFixture(fixture);
  const runs = [];
  for (const viewport of ['390x844', '1440x900']) runs.push(await runCapture(viewport));
  const expectedScenarios = 10;
  const pngs = readdirSync(output).filter((name) => name.endsWith('.png'));
  const evidenceFiles = runs.map((run) => join(output, `evidence-${run.viewport}.json`));
  for (const file of evidenceFiles) {
    if (!existsSync(file)) throw new Error(`visual evidence file is missing: ${file}`);
    const evidence = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(evidence.evidence) || evidence.evidence.length !== expectedScenarios) throw new Error(`visual evidence scenario count mismatch: ${file}`);
    if (Array.isArray(evidence.runtimeErrors) && evidence.runtimeErrors.length) throw new Error(`visual evidence contains runtime errors: ${file}`);
    if (evidence.evidence.some((item) => item?.horizontalOverflow === true)) throw new Error(`visual evidence contains horizontal overflow: ${file}`);
  }
  const expectedScreenshots = expectedScenarios * runs.length;
  if (pngs.length !== expectedScreenshots) throw new Error(`visual screenshot count mismatch: expected ${expectedScreenshots}, found ${pngs.length}`);
  const manifest = { schemaVersion: 2, generatedAt: new Date().toISOString(), source: 'local-contract-fixture', commit, dirty, baseUrl, viewports: runs.map((run) => run.viewport), scenariosPerViewport: expectedScenarios, screenshots: pngs.length };
  writeFileSync(join(output, 'VISUAL_EVIDENCE.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write(JSON.stringify({ status: 'PASS', output, commit, dirty, screenshots: pngs.length, viewports: manifest.viewports }, null, 2) + '\n');
} finally {
  fixture.kill('SIGTERM');
  await new Promise((resolveExit) => { const timer = setTimeout(resolveExit, 1500); fixture.once('exit', () => { clearTimeout(timer); resolveExit(); }); });
  if (fixtureError.trim()) process.stderr.write(fixtureError);
}
