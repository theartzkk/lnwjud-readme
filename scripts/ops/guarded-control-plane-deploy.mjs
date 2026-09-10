import { spawn } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.env.AWH_SOURCE_ROOT || process.cwd();
const CANONICAL_BRANCH = 'awh/api-independence';
const CANONICAL_REMOTE = 'origin';
const CANONICAL_REPOSITORY = 'theartzkk/lnwjud-readme';
const SHA = /^[0-9a-f]{40}$/;
const deployScript = join(ROOT, 'deploy/awh-control-plane/deploy-control-plane.sh');
const sourcePreflight = join(ROOT, 'scripts/ops/canonical-source-preflight.mjs');
const args = process.argv.slice(2);
const mutation = args.includes('--deploy');
const approved = args.includes('--approve');
let provenCanonicalSha = null;

if (approved && !mutation) {
  process.stderr.write('--approve requires --deploy\n');
  process.exit(2);
}

function run(command, commandArgs, { inherit = false, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      shell: false,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    if (inherit) {
      child.once('close', (code) => resolve({ code: code ?? 1, stdout: '' }));
      child.once('error', () => resolve({ code: 1, stdout: '' }));
      return;
    }
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout, 'utf8') > 32 * 1024) child.kill();
    });
    child.stderr.on('data', () => { /* source diagnostics stay bounded in the source tool */ });
    child.once('close', (code) => resolve({ code: code ?? 1, stdout }));
    child.once('error', () => resolve({ code: 1, stdout }));
  });
}

function safeSourceLines(output) {
  return output.split(/\r?\n/).filter((line) => /^(CANONICAL_SOURCE_STATE|CANONICAL_SOURCE_REASON|CANONICAL_LIVE_SHA|CANONICAL_HEAD_SHA|CANONICAL_TRACKING_STALE|CANONICAL_WORKTREE_COUNT)=[A-Za-z0-9_.:-]+$/.test(line));
}

function canonicalShaFrom(output) {
  const line = output.split(/\r?\n/).find((candidate) => candidate.startsWith('CANONICAL_LIVE_SHA='));
  const sha = line?.slice('CANONICAL_LIVE_SHA='.length).trim().toLowerCase() ?? '';
  return SHA.test(sha) ? sha : null;
}

if (mutation) {
  const preflightArgs = [
    sourcePreflight,
    '--root', ROOT,
    '--branch', CANONICAL_BRANCH,
    '--remote', CANONICAL_REMOTE,
    '--repository', CANONICAL_REPOSITORY,
    '--require-mutation-ready',
  ];
  if (process.env.AWH_RELEASE_COMMIT) preflightArgs.push('--expected-sha', process.env.AWH_RELEASE_COMMIT);
  const proof = await run(process.execPath, preflightArgs);
  for (const line of safeSourceLines(proof.stdout)) process.stdout.write(`${line}\n`);
  provenCanonicalSha = canonicalShaFrom(proof.stdout);
  if (proof.code !== 0 || provenCanonicalSha === null) {
    process.stderr.write('CANONICAL_SOURCE_PREFLIGHT_BLOCKED\n');
    process.exit(proof.code === 2 ? 2 : 1);
  }
}

const result = await run('/bin/sh', [deployScript, ...args], {
  inherit: true,
  env: provenCanonicalSha ? { AWH_RELEASE_COMMIT: provenCanonicalSha } : {},
});
process.exit(result.code);
