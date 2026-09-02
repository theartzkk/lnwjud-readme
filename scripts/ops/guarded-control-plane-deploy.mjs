import { spawn } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.env.AWH_SOURCE_ROOT || process.cwd();
const deployScript = join(ROOT, 'deploy/awh-control-plane/deploy-control-plane.sh');
const sourcePreflight = join(ROOT, 'scripts/ops/canonical-source-preflight.mjs');
const args = process.argv.slice(2);
const mutation = args.includes('--deploy');
const approved = args.includes('--approve');

if (approved && !mutation) {
  process.stderr.write('--approve requires --deploy\n');
  process.exit(2);
}

function run(command, commandArgs, { inherit = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      env: { ...process.env },
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

if (mutation) {
  const preflightArgs = [
    sourcePreflight,
    '--root', ROOT,
    '--branch', process.env.AWH_CANONICAL_BRANCH || 'awh/api-independence',
    '--remote', process.env.AWH_CANONICAL_REMOTE || 'origin',
    '--repository', process.env.AWH_CANONICAL_REPOSITORY || 'theartzkk/lnwjud-readme',
    '--require-mutation-ready',
  ];
  if (process.env.AWH_RELEASE_COMMIT) preflightArgs.push('--expected-sha', process.env.AWH_RELEASE_COMMIT);
  const proof = await run(process.execPath, preflightArgs);
  for (const line of safeSourceLines(proof.stdout)) process.stdout.write(`${line}\n`);
  if (proof.code !== 0) {
    process.stderr.write('CANONICAL_SOURCE_PREFLIGHT_BLOCKED\n');
    process.exit(proof.code === 2 ? 2 : 1);
  }
}

const result = await run('/bin/sh', [deployScript, ...args], { inherit: true });
process.exit(result.code);
