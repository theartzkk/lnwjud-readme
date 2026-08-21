#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { BOOTSTRAP_NONCE_CREDENTIAL_KEY, createProductionCredentialStore } from '../../src/credential-store.js';

const TARGET_PATTERN = /^[A-Za-z0-9._-]+$/;
const REMOTE_HASH_PATH = '/etc/awh-hub/enrollment-bootstrap.sha256';
const REMOTE_PROVISION = String.raw`set -eu
umask 077
hash=$(cat)
if test "$(printf '%s' "$hash" | wc -c | tr -d ' ')" -ne 64; then exit 20; fi
case "$hash" in *[!0-9a-fA-F]*|'') exit 20 ;; esac
printf '%s\n' "$hash" | sudo tee /etc/awh-hub/enrollment-bootstrap.sha256 >/dev/null
sudo chown root:root /etc/awh-hub/enrollment-bootstrap.sha256
sudo chmod 0600 /etc/awh-hub/enrollment-bootstrap.sha256
unset hash
`;

function targetName(value) {
  if (typeof value !== 'string' || !TARGET_PATTERN.test(value)) throw new Error('AWH deployment target is invalid');
  return value;
}

function hashNonce(nonce) {
  if (typeof nonce !== 'string' || nonce.length < 32 || /[\u0000-\u001f\u007f]/.test(nonce)) throw new Error('Bootstrap nonce is unavailable');
  return createHash('sha256').update(nonce, 'utf8').digest('hex');
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function runSsh(executable, args, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    child.once('error', () => reject(new Error('SSH provisioning process is unavailable')));
    child.once('close', (code) => resolve(code ?? 1));
    child.stdin.end(stdin, 'utf8');
  });
}

export async function provisionBootstrapHash({ store, target, spawnImpl = runSsh, executable = 'ssh' }) {
  const safeTarget = targetName(target);
  const nonce = await store.get(BOOTSTRAP_NONCE_CREDENTIAL_KEY);
  if (!nonce) throw new Error('Bootstrap nonce is not present in the secure credential store');
  const digest = hashNonce(nonce);
  // OpenSSH joins remote argv into one command string. Quote the fixed script
  // as one remote argument; the digest itself remains on stdin and never enters
  // argv or the command string.
  const args = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', safeTarget, `sh -c ${shellQuote(REMOTE_PROVISION)}`];
  const exitCode = await spawnImpl(executable, args, `${digest}\n`);
  if (exitCode !== 0) throw new Error('Bootstrap hash provisioning failed');
  return { target: safeTarget, path: REMOTE_HASH_PATH };
}

function usage() {
  process.stdout.write('Bootstrap hash provisioning is approval-gated; use --approve-bootstrap-provision after reviewed deployment approval.\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] !== '--approve-bootstrap-provision') {
    usage();
    process.exit(2);
  }
  const target = targetName(process.env.AWH_DEPLOY_TARGET || 'awh-vps');
  const store = createProductionCredentialStore();
  provisionBootstrapHash({ store, target }).then((result) => {
    process.stdout.write(`Bootstrap hash provisioned to ${result.target}:${result.path}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Bootstrap hash provisioning failed'}\n`);
    process.exitCode = 1;
  });
}
