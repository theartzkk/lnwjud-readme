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
const canonicalRepository = 'vps/awh';
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

test('canonical source preflight accepts the owned local VPS bare Git authority without SSH indirection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-local-vps-source-'));
  const remote = join(root, 'awh.git');
  const seed = join(root, 'seed');
  const work = join(root, 'work');
  try {
    await run('git', ['init', '--bare', remote]);
    await mkdir(seed);
    await git(seed, 'init');
    await git(seed, 'config', 'user.email', 'qa@example.invalid');
    await git(seed, 'config', 'user.name', 'AWH QA');
    await writeFile(join(seed, 'authority.txt'), 'local-vps\n');
    await git(seed, 'add', 'authority.txt');
    await git(seed, 'commit', '-m', 'local authority');
    await git(seed, 'branch', '-M', 'main');
    await git(seed, 'remote', 'add', 'vps', remote);
    await git(seed, 'push', '-u', 'vps', 'main');
    const sha = (await git(seed, 'rev-parse', 'HEAD')).trim().toLowerCase();
    await run('git', ['clone', '--branch', 'main', remote, work]);
    await git(work, 'remote', 'rename', 'origin', 'vps');
    await git(work, 'remote', 'set-url', 'vps', '/srv/awh-git/awh.git');
    await git(work, 'config', `url.file://${remote}.insteadOf`, '/srv/awh-git/awh.git');
    const stdout = await run(process.execPath, [script, '--root', work, '--branch', 'main', '--remote', 'vps', '--repository', 'vps/awh', '--expected-sha', sha, '--require-mutation-ready']);
    const report = JSON.parse(stdout.split(/\r?\n/, 1)[0]);
    assert.equal(report.state, 'PASS');
    assert.equal(report.remoteRepository, 'vps/awh');
    assert.equal(report.liveSha, sha);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('generated CI evidence directory does not make canonical source dirty', async () => {
  const fx = await fixture();
  try {
    await git(fx.work, 'config', 'user.email', 'qa@example.invalid');
    await git(fx.work, 'config', 'user.name', 'AWH QA');
    await writeFile(join(fx.work, '.gitignore'), '.ci-artifacts/\n');
    await git(fx.work, 'add', '.gitignore');
    await git(fx.work, 'commit', '-m', 'ignore generated ci evidence');
    await git(fx.work, 'push', 'origin', 'awh/api-independence');
    const expected = (await git(fx.work, 'rev-parse', 'HEAD')).trim().toLowerCase();
    await mkdir(join(fx.work, '.ci-artifacts'), { recursive: true });
    await writeFile(join(fx.work, '.ci-artifacts', 'run.json'), '{\"status\":\"success\"}\n');
    const result = await preflight(fx.work, expected);
    assert.equal(result.code, 0);
    assert.equal(result.report.state, 'PASS');
    assert.equal(result.report.reason, 'PASS');
    assert.equal(result.report.dirty, false);
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

test('approved awh-vps SSH alias maps to the canonical VPS repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-vps-alias-source-'));
  const remote = join(root, 'awh.git');
  const seed = join(root, 'seed');
  const work = join(root, 'work');
  const canonicalSsh = 'ssh://awh-vps/srv/awh-git/awh.git';
  try {
    await run('git', ['init', '--bare', remote]);
    await mkdir(seed);
    await git(seed, 'init');
    await git(seed, 'config', 'user.email', 'qa@example.invalid');
    await git(seed, 'config', 'user.name', 'AWH QA');
    await writeFile(join(seed, 'authority.txt'), 'awh-vps-alias\n');
    await git(seed, 'add', 'authority.txt');
    await git(seed, 'commit', '-m', 'awh-vps alias fixture');
    await git(seed, 'branch', '-M', 'main');
    await git(seed, 'remote', 'add', 'origin', remote);
    await git(seed, 'push', '-u', 'origin', 'main');
    const sha = (await git(seed, 'rev-parse', 'HEAD')).trim().toLowerCase();
    await run('git', ['clone', '--branch', 'main', remote, work]);
    await git(work, 'remote', 'set-url', 'origin', canonicalSsh);
    await git(work, 'config', `url.file://${remote}.insteadOf`, canonicalSsh);
    const stdout = await run(process.execPath, [script, '--root', work, '--branch', 'main', '--remote', 'origin', '--repository', 'vps/awh', '--expected-sha', sha, '--require-mutation-ready']);
    const report = JSON.parse(stdout.split(/\r?\n/, 1)[0]);
    assert.equal(report.state, 'PASS');
    assert.equal(report.remoteRepository, 'vps/awh');
    assert.equal(report.liveSha, sha);
  } finally {
    await rm(root, { recursive: true, force: true });
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

test('owner auth activation proves source before credentials and binds the proven SHA into deploy', async () => {
  const source = await readFile(join(repoRoot, 'scripts/ops/activate-owner-auth.mjs'), 'utf8');
  const preflight = source.indexOf('await runCanonicalSourcePreflight()');
  const credential = source.indexOf('await store.get(OWNER_AUTH_PASSWORD_CREDENTIAL_KEY)');
  const deploy = source.indexOf('await runDeploy(password, canonicalSha)');
  assert.ok(preflight >= 0, 'canonical preflight call must exist');
  assert.ok(credential > preflight, 'credential access must happen after canonical source proof');
  assert.ok(deploy > credential, 'production deploy must happen after source proof and credential gate');
  assert.match(source, /--require-mutation-ready/);
  assert.match(source, /const CANONICAL_BRANCH = 'main'/);
  assert.match(source, /const CANONICAL_REMOTE = 'origin'/);
  assert.match(source, /const CANONICAL_REPOSITORY = 'vps\/awh'/);
  assert.match(source, /AWH_RELEASE_COMMIT: canonicalSha/);
  assert.doesNotMatch(source, /AWH_CANONICAL_(?:BRANCH|REMOTE|REPOSITORY)/);
});

test('guarded deployment wrapper proves canonical source and binds the proven SHA before mutation', async () => {
  const source = await readFile(join(repoRoot, 'scripts/ops/guarded-control-plane-deploy.mjs'), 'utf8');
  const mutationGate = source.indexOf("if (mutation) {");
  const preflight = source.indexOf('const proof = await run(process.execPath, preflightArgs)');
  const deploy = source.indexOf("const result = await run('/bin/sh', [deployScript, ...args]");
  assert.ok(mutationGate >= 0);
  assert.ok(preflight > mutationGate);
  assert.ok(deploy > preflight);
  assert.match(source, /--require-mutation-ready/);
  assert.match(source, /const CANONICAL_BRANCH = 'main'/);
  assert.match(source, /resolveCanonicalRemote/);
  assert.match(source, /'vps', 'origin'/);
  assert.doesNotMatch(source, /const CANONICAL_REMOTE = 'vps'/);
  assert.match(source, /const CANONICAL_REPOSITORY = 'vps\/awh'/);
  assert.match(source, /AWH_RELEASE_COMMIT: provenCanonicalSha/);
  assert.doesNotMatch(source, /AWH_CANONICAL_(?:BRANCH|REMOTE|REPOSITORY)/);
  assert.match(source, /CANONICAL_SOURCE_PREFLIGHT_BLOCKED/);
});

test('guarded remote deploy holds canonical execution authority through mutation and rollback', async () => {
  const remote = await readFile(join(repoRoot, 'deploy/awh-control-plane/remote-deploy-control-plane.sh'), 'utf8');
  const validator = await readFile(join(repoRoot, 'deploy/awh-control-plane/validate-remote-output.sh'), 'utf8');
  const staged = remote.indexOf('stage RELEASE_STAGED');
  const acquire = remote.indexOf('stage EXECUTION_AUTHORITY_ACQUIRE');
  const cutover = remote.indexOf('stage CONTROL_ORIGIN_RENDER');
  const release = remote.lastIndexOf('stage EXECUTION_AUTHORITY_RELEASE;');
  const success = remote.lastIndexOf('SUCCESS=1;');
  assert.ok(staged >= 0 && acquire > staged && cutover > acquire, 'deploy authority must be acquired before control mutation');
  assert.ok(release > cutover && success > release, 'deploy authority must be released before success');
  assert.match(remote, /release_deploy_authority failure/);
  assert.match(remote, /deploy-execution-authority\.php" acquire/);
  assert.match(remote, /deploy-execution-authority\.php" verify/);
  assert.match(remote, /DEPLOY_AUTHORITY_BORROWED/);
  assert.doesNotMatch(remote, /SELECT count\(\*\) FROM control_task_executions WHERE state IN \('LEASED','RUNNING'\).*required_capability <> 'system\.core\.release'/);
  assert.match(remote, /deploy-execution-authority\.php" release/);
  assert.match(validator, /EXECUTION_AUTHORITY_ACQUIRE/);
  assert.match(validator, /EXECUTION_AUTHORITY_RELEASED/);
});

test('standard production package entrypoints use canonical guarded paths', async () => {
  const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['ops:final-self-service:activate'], /guarded-control-plane-deploy\.mjs --deploy --approve/);
  assert.match(pkg.scripts['ops:project-source:refresh'], /guarded-control-plane-deploy\.mjs --deploy --approve/);
  assert.match(pkg.scripts['ops:owner-auth:activate'], /activate-owner-auth\.mjs --deploy --approve/);
  assert.doesNotMatch(pkg.scripts['ops:final-self-service:activate'], /\bsh deploy\/awh-control-plane\/deploy-control-plane\.sh\b/);
  assert.doesNotMatch(pkg.scripts['ops:project-source:refresh'], /\bsh deploy\/awh-control-plane\/deploy-control-plane\.sh\b/);
});

test('device lease recovery is scoped to tasks actually assigned to devices', async () => {
  const service = await readFile(join(repoRoot, 'hub/src/HubControlPlaneService.php'), 'utf8');
  assert.match(service, /SELECT task_id FROM control_tasks WHERE state IN \('PREPARING', 'RUNNING', 'QA'\) AND assigned_device_id IS NOT NULL/);
  assert.match(service, /WHERE task_id = :task AND state IN \('PREPARING', 'RUNNING', 'QA'\) AND assigned_device_id IS NOT NULL/);
  assert.doesNotMatch(service, /SELECT task_id FROM control_tasks WHERE state IN \('PREPARING', 'RUNNING', 'QA'\) AND \(lease_expires_at IS NULL/);
});
