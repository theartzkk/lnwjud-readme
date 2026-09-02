#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { BOOTSTRAP_NONCE_CREDENTIAL_KEY, createProductionCredentialStore } from '../../dist/credential-store.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET_PATTERN = /^[A-Za-z0-9._-]+$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const REMOTE_HASH_PATH = '/etc/awh-hub/enrollment-bootstrap.sha256';
const PROVISION_FAILURE_CODES = new Map([
  [31, 'BOOTSTRAP_CONFIG_DIR_PROVISION_FAILED'],
  [32, 'BOOTSTRAP_HASH_WRITE_FAILED'],
  [33, 'BOOTSTRAP_HASH_METADATA_FAILED'],
]);
const REMOTE_PROVISION = String.raw`set -eu
umask 077
CONFIG_DIR=/etc/awh-hub
HASH_PATH=/etc/awh-hub/enrollment-bootstrap.sha256
if test -d "$CONFIG_DIR"; then
  METADATA=$(/usr/bin/stat -c '%U|%G|%a' "$CONFIG_DIR" 2>/dev/null || true)
  test "$METADATA" = 'root|root|750' || exit 31
else
  sudo -n /usr/bin/install -d -o root -g root -m 0750 "$CONFIG_DIR" || exit 31
fi
hash=$(/usr/bin/cat)
if test "$(printf '%s' "$hash" | /usr/bin/wc -c | /usr/bin/tr -d ' ')" -ne 64; then exit 20; fi
case "$hash" in *[!0-9a-fA-F]*|'') exit 20 ;; esac
if ! printf '%s\n' "$hash" | sudo -n /usr/bin/tee "$HASH_PATH" >/dev/null; then exit 32; fi
if ! sudo -n /usr/bin/chown root:root "$HASH_PATH" || ! sudo -n /usr/bin/chmod 0600 "$HASH_PATH"; then exit 33; fi
unset hash
`;
export const REMOTE_PROVISION_SCRIPT = REMOTE_PROVISION;

function targetName(value) {
  if (typeof value !== 'string' || !TARGET_PATTERN.test(value)) throw new Error('AWH deployment target is invalid');
  return value;
}

function hashNonce(nonce) {
  if (typeof nonce !== 'string' || !NONCE_PATTERN.test(nonce)) throw new Error('Bootstrap nonce is unavailable');
  return createHash('sha256').update(nonce, 'utf8').digest('hex');
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export function runSsh(executable, args, stdin) {
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
  if (exitCode !== 0) throw new Error(PROVISION_FAILURE_CODES.get(exitCode) ?? 'BOOTSTRAP_HASH_PROVISION_FAILED');
  return { target: safeTarget, path: REMOTE_HASH_PATH };
}

function usage() {
  process.stdout.write('Bootstrap hash provisioning is approval-gated; use --approve-bootstrap-provision after reviewed deployment approval.\n');
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  if (process.argv[2] !== '--approve-bootstrap-provision') {
    usage();
    process.exit(2);
  }
  const target = targetName(process.env.AWH_DEPLOY_TARGET || 'awh-ready');
  const store = createProductionCredentialStore();
  provisionBootstrapHash({ store, target }).then((result) => {
    process.stdout.write(`Bootstrap hash provisioned to ${result.target}:${result.path}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Bootstrap hash provisioning failed'}\n`);
    process.exitCode = 1;
  });
}
