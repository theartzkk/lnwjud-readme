import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createProductionCredentialStore, OWNER_AUTH_PASSWORD_CREDENTIAL_KEY } from '../../dist/credential-store.js';

const ROOT = process.env.AWH_SOURCE_ROOT || process.cwd();
const deployScript = join(ROOT, 'deploy/awh-control-plane/deploy-control-plane.sh');
const canonicalSourceScript = join(ROOT, 'scripts/ops/canonical-source-preflight.mjs');
const operatorCommand = "security find-generic-password -a 'awh-device-token-v1:awh/owner-password' -s 'Art’s Workspace Hub' -w";
const args = process.argv.slice(2);
if (!args.includes('--deploy') || !args.includes('--approve')) {
  process.stderr.write('Owner-auth activation requires --deploy --approve\n');
  process.exit(2);
}
const deployArgs = ['--deploy', '--approve', '--owner-auth'];
if (args.includes('--cleanup-topology')) deployArgs.push('--cleanup-topology');
const compatibilityRefresh = args.includes('--compat-refresh');
if (compatibilityRefresh) deployArgs.push('--compat-refresh');
const ownerUsername = process.env.AWH_OWNER_AUTH_USERNAME || 'art';

function boundedSpawn(command, commandArgs, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      env: { ...process.env, ...options.env },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let overflow = false;
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout, 'utf8') > 32 * 1024) { overflow = true; child.kill(); }
    });
    child.stderr.on('data', () => { /* diagnostics remain sanitized and are never retained */ });
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, overflow }));
    child.once('error', () => resolve({ code: 1, stdout, overflow: false }));
    if (typeof options.stdin === 'string') child.stdin.end(options.stdin);
    else child.stdin.end();
  });
}

async function runCanonicalSourcePreflight() {
  const preflightArgs = [
    canonicalSourceScript,
    '--root', ROOT,
    '--branch', process.env.AWH_CANONICAL_BRANCH || 'awh/api-independence',
    '--remote', process.env.AWH_CANONICAL_REMOTE || 'origin',
    '--repository', process.env.AWH_CANONICAL_REPOSITORY || 'theartzkk/lnwjud-readme',
    '--require-mutation-ready',
  ];
  if (process.env.AWH_RELEASE_COMMIT) preflightArgs.push('--expected-sha', process.env.AWH_RELEASE_COMMIT);
  return boundedSpawn(process.execPath, preflightArgs);
}

function runDeploy(password) {
  return boundedSpawn('/bin/sh', [deployScript, ...deployArgs], {
    env: { AWH_OWNER_AUTH_USERNAME: ownerUsername },
    stdin: `${password}\n`,
  });
}

function safeLines(output) {
  return output.split(/\r?\n/).filter((line) => /^(DEPLOY_STAGE|DEPLOY_FAILED_AT|DEPLOY_RESULT|ROLLBACK|M4_|OWNER_AUTH_)=[A-Za-z0-9_.:-]+$/.test(line)
    || /^DEPLOY_DIAGNOSTIC=OWNER_AUTH_(?:SURFACE|LOGIN)_(?:HTTP_[0-9]{3}|BASIC_CHALLENGE)$/.test(line)
    || /^DEPLOY_DIAGNOSTIC=OWNER_AUTH_SURFACE_ATTEMPTS_(?:[1-9]|10)$/.test(line));
}

function safeCanonicalLines(output) {
  return output.split(/\r?\n/).filter((line) => /^(CANONICAL_SOURCE_STATE|CANONICAL_SOURCE_REASON|CANONICAL_LIVE_SHA|CANONICAL_HEAD_SHA|CANONICAL_TRACKING_STALE|CANONICAL_WORKTREE_COUNT)=[A-Za-z0-9_.:-]+$/.test(line));
}

const store = createProductionCredentialStore();
let password = '';
let keychainOwned = false;
try {
  const sourcePreflight = await runCanonicalSourcePreflight();
  for (const line of safeCanonicalLines(sourcePreflight.stdout)) process.stdout.write(`${line}\n`);
  if (sourcePreflight.overflow) throw new Error('CANONICAL_SOURCE_PREFLIGHT_OUTPUT_BOUND_EXCEEDED');
  if (sourcePreflight.code !== 0) throw new Error('CANONICAL_SOURCE_PREFLIGHT_BLOCKED');

  const existing = await store.get(OWNER_AUTH_PASSWORD_CREDENTIAL_KEY);
  if (compatibilityRefresh) {
    if (!existing) throw new Error('OWNER_AUTH_KEYCHAIN_MISSING_FOR_COMPAT_REFRESH');
    password = existing;
  } else {
    if (existing) throw new Error('OWNER_AUTH_KEYCHAIN_ALREADY_PRESENT');
    password = randomBytes(32).toString('base64url');
  }
  const result = await runDeploy(password);
  for (const line of safeLines(result.stdout)) process.stdout.write(`${line}\n`);
  if (result.overflow) throw new Error('OWNER_AUTH_OUTPUT_BOUND_EXCEEDED');
  if (result.code !== 0) {
    if (/^ROLLBACK=FAIL$/m.test(result.stdout)) {
      process.stdout.write('OWNER_AUTH_STATE_UNCERTAIN=YES\n');
      throw new Error('OWNER_AUTH_REMOTE_STATE_UNCERTAIN');
    }
    throw new Error('OWNER_AUTH_ACTIVATION_FAILED');
  }
  if (!compatibilityRefresh) {
    await store.set(OWNER_AUTH_PASSWORD_CREDENTIAL_KEY, password);
    keychainOwned = true;
  }
  process.stdout.write(`${compatibilityRefresh ? 'OWNER_AUTH_COMPAT_REFRESH' : 'OWNER_AUTH_ACTIVATION'}=PASS\nOWNER_AUTH_KEYCHAIN=PASS\nRECOVERY_CODES=REGENERATE_IN_CONTROL_PANEL\n`);
  process.stdout.write(`KEYCHAIN_OPERATOR_COMMAND=${operatorCommand}\n`);
} catch (error) {
  if (keychainOwned && error?.message !== 'OWNER_AUTH_REMOTE_STATE_UNCERTAIN') {
    try { await store.delete(OWNER_AUTH_PASSWORD_CREDENTIAL_KEY); keychainOwned = false; } catch { /* preserve truthful uncertainty below */ }
  }
  process.stderr.write(`${error instanceof Error ? error.message : 'OWNER_AUTH_ACTIVATION_FAILED'}\n`);
  process.exit(1);
} finally {
  password = '';
}
