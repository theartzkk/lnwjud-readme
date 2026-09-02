import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(repoRoot, 'scripts/ops/canonical-source-preflight.mjs');
const canonicalRepository = 'theartzkk/lnwjud-readme';
const canonicalUrl = `https://github.com/${canonicalRepository}.git`;

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024,
    ...options,
  });
  return result.stdout.trim();
}

async function git(root, ...args) {
  return run('git', ['-C', root, ...args]);
}

async function preflight(root, expectedSha, extra = []) {
  try {
    const stdout = await run(process.execPath, [script, '--root', root, '--branch', 'awh/api-independence', '--repository', canonicalRepository, '--expected-sha', expectedSha, '--require-mutation-ready', ...extra]);
    const report = JSON.parse(stdout.split(/\r?\n/, 1)[0]);
    return { code: 0, stdout, report };
  } catch (error) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
    const report = stdout ? JSON.parse(stdout.split(/\r?\n/, 1)[0]) : null;
    return { code: error?.code ?? 1, stdout, report };
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'awh-canonical-source-'));
  const remote = join(root, 'remote.git');
  const seed = join(root, 'seed');
  const work = join(root, 'work');
  await run('git', ['init', '--bare', remote]);
  await mkdir(seed);
  await git(seed, 'init');
  await git(seed, 'config', 'user.email', 'qa@example.invalid');
  await git(seed, 'config', 'user.name', 'AWH QA');
  await writeFile(join(seed, 'authority.txt'), 'one\n');
  await git(seed, 'add', 'authority.txt');
  await git(seed, 'commit', '-m', 'fixture one');
  await git(seed, 'branch', '-M', 'awh/api-independence');
  await git(seed, 'remote', 'add', 'origin', remote);
  await git(seed, 'push', '-u', 'origin', 'awh/api-independence');
  const first = (await git(seed, 'rev-parse', 'HEAD')).trim().toLowerCase();
  await run('git', ['clone', '--branch', 'awh/api-independence', remote, work]);
  await git(work, 'remote', 'set-url', 'origin', canonicalUrl);
  await git(work, 'config', `url.file://${remote}.insteadOf`, canonicalUrl);
  return { root, remote, seed, work, first };
}

test('canonical source preflight passes only for live exact clean source', async () => {
  const fx = await fixture();
  try {
    const result = await preflight(fx.work, fx.first);
    assert.equal(result.code, 0);
    assert.equal(result.report.state, 'PASS');
    assert.equal(result.report.reason, 'PASS');
    assert.equal(result.report.remoteRepository, canonicalRepository);
    assert.equal(result.report.liveSha, fx.first);
    assert.equal(result.report.headSha, fx.first);
    assert.equal(result.report.mutationReady, true);
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test('live ls-remote outranks a stale local remote-tracking ref', async () => {
  const fx = await fixture();
  try {
    await writeFile(join(fx.seed, 'authority.txt'), 'two\n');
    await git(fx.seed, 'add', 'authority.txt');
    await git(fx.seed, 'commit', '-m', 'fixture two');
    await git(fx.seed, 'push', 'origin', 'awh/api-independence');
    const second = (await git(fx.seed, 'rev-parse', 'HEAD')).trim().toLowerCase();
    const result = await preflight(fx.work, second);
    assert.equal(result.code, 2);
    assert.equal(result.report.reason, 'HEAD_STALE');
    assert.equal(result.report.liveSha, second);
    assert.equal(result.report.headSha, fx.first);
    assert.equal(result.report.trackingSha, fx.first);
    assert.equal(result.report.trackingStale, true);
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test('dirty source and stale approval SHA fail closed', async () => {
  const fx = await fixture();
  try {
    await writeFile(join(fx.seed, 'authority.txt'), 'two\n');
    await git(fx.seed, 'add', 'authority.txt');
    await git(fx.seed, 'commit', '-m', 'fixture two');
    await git(fx.seed, 'push', 'origin', 'awh/api-independence');
    const second = (await git(fx.seed, 'rev-parse', 'HEAD')).trim().toLowerCase();
    await git(fx.work, 'fetch', 'origin', 'awh/api-independence');
    await git(fx.work, 'reset', '--hard', 'origin/awh/api-independence');
    await writeFile(join(fx.work, 'authority.txt'), 'dirty\n');
    const dirty = await preflight(fx.work, second);
    assert.equal(dirty.code, 2);
    assert.equal(dirty.report.reason, 'DIRTY_WORKTREE');
    await git(fx.work, 'reset', '--hard', 'HEAD');
    const staleApproval = await preflight(fx.work, fx.first);
    assert.equal(staleApproval.code, 2);
    assert.equal(staleApproval.report.reason, 'EXPECTED_SHA_MISMATCH');
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test('repository identity mismatch blocks before remote authority lookup', async () => {
  const fx = await fixture();
  try {
    await git(fx.work, 'remote', 'set-url', 'origin', 'https://github.com/example/not-awh.git');
    const result = await preflight(fx.work, fx.first);
    assert.equal(result.code, 2);
    assert.equal(result.report.state, 'BLOCKED');
    assert.equal(result.report.reason, 'REMOTE_IDENTITY_MISMATCH');
    assert.equal(result.report.liveSha, null);
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test('owner auth activation runs canonical source proof before credentials or deploy', async () => {
  const source = await readFile(join(repoRoot, 'scripts/ops/activate-owner-auth.mjs'), 'utf8');
  const preflight = source.indexOf('await runCanonicalSourcePreflight()');
  const credential = source.indexOf('await store.get(OWNER_AUTH_PASSWORD_CREDENTIAL_KEY)');
  const deploy = source.indexOf('await runDeploy(password)');
  assert.ok(preflight >= 0, 'canonical preflight call must exist');
  assert.ok(credential > preflight, 'credential access must happen after canonical source proof');
  assert.ok(deploy > credential, 'production deploy must happen after source proof and credential gate');
  assert.match(source, /--require-mutation-ready/);
  assert.match(source, /const CANONICAL_BRANCH = 'awh\/api-independence'/);
  assert.match(source, /const CANONICAL_REMOTE = 'origin'/);
  assert.match(source, /const CANONICAL_REPOSITORY = 'theartzkk\/lnwjud-readme'/);
  assert.doesNotMatch(source, /AWH_CANONICAL_(?:BRANCH|REMOTE|REPOSITORY)/);
});

test('guarded deployment wrapper proves canonical source before mutation', async () => {
  const source = await readFile(join(repoRoot, 'scripts/ops/guarded-control-plane-deploy.mjs'), 'utf8');
  const mutationGate = source.indexOf("if (mutation) {");
  const preflight = source.indexOf('const proof = await run(process.execPath, preflightArgs)');
  const deploy = source.indexOf("const result = await run('/bin/sh', [deployScript, ...args]");
  assert.ok(mutationGate >= 0);
  assert.ok(preflight > mutationGate);
  assert.ok(deploy > preflight);
  assert.match(source, /--require-mutation-ready/);
  assert.match(source, /const CANONICAL_BRANCH = 'awh\/api-independence'/);
  assert.match(source, /const CANONICAL_REMOTE = 'origin'/);
  assert.match(source, /const CANONICAL_REPOSITORY = 'theartzkk\/lnwjud-readme'/);
  assert.doesNotMatch(source, /AWH_CANONICAL_(?:BRANCH|REMOTE|REPOSITORY)/);
  assert.match(source, /CANONICAL_SOURCE_PREFLIGHT_BLOCKED/);
});

test('standard production package entrypoints use canonical guarded paths', async () => {
  const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['ops:final-self-service:activate'], /guarded-control-plane-deploy\.mjs --deploy --approve/);
  assert.match(pkg.scripts['ops:project-source:refresh'], /guarded-control-plane-deploy\.mjs --deploy --approve/);
  assert.match(pkg.scripts['ops:owner-auth:activate'], /activate-owner-auth\.mjs --deploy --approve/);
  assert.doesNotMatch(pkg.scripts['ops:final-self-service:activate'], /\bsh deploy\/awh-control-plane\/deploy-control-plane\.sh\b/);
  assert.doesNotMatch(pkg.scripts['ops:project-source:refresh'], /\bsh deploy\/awh-control-plane\/deploy-control-plane\.sh\b/);
});
