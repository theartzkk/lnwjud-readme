import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_BRANCH = 'awh/api-independence';
const DEFAULT_REMOTE = 'origin';
const DEFAULT_REPOSITORY = 'theartzkk/lnwjud-readme';
const SHA = /^[0-9a-f]{40}$/;

function value(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const candidate = process.argv[index + 1];
  return candidate && !candidate.startsWith('--') ? candidate : undefined;
}

function flag(name) {
  return process.argv.includes(name);
}

function normalizeRepository(remoteUrl) {
  if (typeof remoteUrl !== 'string') return null;
  const normalized = remoteUrl.trim().replace(/\/+$/, '').replace(/\.git$/, '');
  const patterns = [
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i,
    /^git@github\.com:([^/]+)\/([^/]+)$/i,
    /^ssh:\/\/(?:git@)?github\.com\/([^/]+)\/([^/]+)$/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return `${match[1]}/${match[2]}`.toLowerCase();
  }
  return null;
}

async function git(root, args, { optional = false } = {}) {
  try {
    const result = await execFileAsync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 128 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return result.stdout.trim();
  } catch (error) {
    if (optional) return null;
    throw error;
  }
}

function liveShaFrom(output, branch) {
  if (typeof output !== 'string') return null;
  const ref = `refs/heads/${branch}`;
  const rows = output.split(/\r?\n/).filter(Boolean).map((line) => line.trim().split(/\s+/));
  const matches = rows.filter((row) => row.length >= 2 && row[1] === ref && SHA.test(row[0].toLowerCase()));
  return matches.length === 1 ? matches[0][0].toLowerCase() : null;
}

const requestedRoot = resolve(value('--root') ?? process.cwd());
const branch = value('--branch') ?? DEFAULT_BRANCH;
const remote = value('--remote') ?? DEFAULT_REMOTE;
const expectedRepository = (value('--repository') ?? DEFAULT_REPOSITORY).toLowerCase();
const expectedShaRaw = value('--expected-sha') ?? process.env.AWH_RELEASE_COMMIT;
const expectedSha = expectedShaRaw ? expectedShaRaw.toLowerCase() : null;
const requireMutationReady = flag('--require-mutation-ready');

if (!/^[A-Za-z0-9._/-]{1,200}$/.test(branch) || branch.startsWith('/') || branch.includes('..')) throw new Error('CANONICAL_BRANCH_INVALID');
if (!/^[A-Za-z0-9._-]{1,80}$/.test(remote)) throw new Error('CANONICAL_REMOTE_INVALID');
if (expectedSha !== null && !SHA.test(expectedSha)) throw new Error('EXPECTED_SHA_INVALID');
if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(expectedRepository)) throw new Error('CANONICAL_REPOSITORY_INVALID');

let report;
try {
  const root = await git(requestedRoot, ['rev-parse', '--show-toplevel']);
  const headSha = (await git(root, ['rev-parse', 'HEAD'])).toLowerCase();
  const currentBranch = await git(root, ['symbolic-ref', '--short', '-q', 'HEAD'], { optional: true }) ?? 'DETACHED';
  const dirty = (await git(root, ['status', '--porcelain=v1', '--untracked-files=all'])).length > 0;
  // Read the configured remote URL, not `git remote get-url`: get-url expands
  // url.*.insteadOf rewrites and can hide the repository identity we need to audit.
  const remoteUrl = await git(root, ['config', '--get', `remote.${remote}.url`]);
  const remoteRepository = normalizeRepository(remoteUrl);
  const repositoryMatches = remoteRepository === expectedRepository;
  let liveSha = null;
  let remoteReachable = false;
  if (repositoryMatches) {
    const liveOutput = await git(root, ['ls-remote', '--exit-code', remote, `refs/heads/${branch}`], { optional: true });
    liveSha = liveShaFrom(liveOutput, branch);
    remoteReachable = liveSha !== null;
  }
  const trackingShaRaw = await git(root, ['rev-parse', '--verify', `refs/remotes/${remote}/${branch}`], { optional: true });
  const trackingSha = trackingShaRaw && SHA.test(trackingShaRaw.toLowerCase()) ? trackingShaRaw.toLowerCase() : null;
  const trackingStale = liveSha && trackingSha ? trackingSha !== liveSha : null;
  const worktreeOutput = await git(root, ['worktree', 'list', '--porcelain']);
  const worktreeCount = worktreeOutput.split(/\r?\n/).filter((line) => line.startsWith('worktree ')).length;

  let reason = 'PASS';
  if (!repositoryMatches) reason = 'REMOTE_IDENTITY_MISMATCH';
  else if (!remoteReachable) reason = 'LIVE_CANONICAL_UNAVAILABLE';
  else if (expectedSha !== null && expectedSha !== liveSha) reason = 'EXPECTED_SHA_MISMATCH';
  else if (headSha !== liveSha) reason = 'HEAD_STALE';
  else if (dirty) reason = 'DIRTY_WORKTREE';

  const mutationReady = reason === 'PASS';
  report = {
    schemaVersion: 1,
    state: mutationReady ? 'PASS' : 'BLOCKED',
    reason,
    canonicalBranch: branch,
    remote,
    remoteRepository: remoteRepository ?? 'UNVERIFIED',
    repositoryMatches,
    liveSha,
    headSha,
    expectedSha,
    trackingSha,
    trackingStale,
    currentBranch,
    dirty,
    worktreeCount,
    mutationReady,
    authority: 'git-ls-remote',
  };
} catch (error) {
  report = {
    schemaVersion: 1,
    state: 'BLOCKED',
    reason: 'SOURCE_PREFLIGHT_UNAVAILABLE',
    canonicalBranch: branch,
    remote,
    remoteRepository: 'UNVERIFIED',
    repositoryMatches: false,
    liveSha: null,
    headSha: null,
    expectedSha,
    trackingSha: null,
    trackingStale: null,
    currentBranch: 'UNKNOWN',
    dirty: null,
    worktreeCount: null,
    mutationReady: false,
    authority: 'git-ls-remote',
    diagnostic: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
  };
}

process.stdout.write(`${JSON.stringify(report)}\n`);
process.stdout.write(`CANONICAL_SOURCE_STATE=${report.state}\n`);
process.stdout.write(`CANONICAL_SOURCE_REASON=${report.reason}\n`);
if (report.liveSha) process.stdout.write(`CANONICAL_LIVE_SHA=${report.liveSha}\n`);
if (report.headSha) process.stdout.write(`CANONICAL_HEAD_SHA=${report.headSha}\n`);
process.stdout.write(`CANONICAL_TRACKING_STALE=${report.trackingStale === null ? 'UNKNOWN' : report.trackingStale ? 'YES' : 'NO'}\n`);
if (Number.isInteger(report.worktreeCount)) process.stdout.write(`CANONICAL_WORKTREE_COUNT=${report.worktreeCount}\n`);

if (requireMutationReady && !report.mutationReady) process.exitCode = 2;
