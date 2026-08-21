import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { provisionBootstrapHash, REMOTE_PROVISION_SCRIPT, runSsh } from '../scripts/deploy/provision-bootstrap-hash.mjs';
import { BOOTSTRAP_NONCE_CREDENTIAL_KEY, InMemoryCredentialStore } from '../src/credential-store.js';

test('bootstrap hash provisioning reads the secure store and sends only a digest on stdin', async () => {
  const nonce = 'A'.repeat(43);
  const store = new InMemoryCredentialStore();
  await store.set(BOOTSTRAP_NONCE_CREDENTIAL_KEY, nonce);
  let executable = '';
  let args: readonly string[] = [];
  let stdin = '';
  const result = await provisionBootstrapHash({
    store,
    target: 'awh-vps',
    spawnImpl: async (receivedExecutable, receivedArgs, receivedStdin) => {
      executable = receivedExecutable;
      args = receivedArgs;
      stdin = receivedStdin;
      return 0;
    },
  });
  const digest = createHash('sha256').update(nonce).digest('hex');
  assert.equal(result.path, '/etc/awh-hub/enrollment-bootstrap.sha256');
  assert.equal(executable, 'ssh');
  assert.equal(stdin, `${digest}\n`);
  assert.equal(args.includes(nonce), false);
  assert.equal(args.includes(digest), false);
  assert.match(args.join('\u0000'), /StrictHostKeyChecking=yes/);
  assert.match(args.join('\u0000'), /0600/);
  assert.match(args.at(-1) ?? '', /install -d -o root -g root -m 0750 "\$CONFIG_DIR"/);
  assert.match(args.at(-1) ?? '', /\/usr\/bin\/tee "\$HASH_PATH"/);
  assert.match(args.at(-1) ?? '', /^sh -c '/);
});

test('bootstrap directory provisioning is idempotent and failures are stage-classified without secrets', async () => {
  assert.match(REMOTE_PROVISION_SCRIPT, /if test -d "\$CONFIG_DIR"/);
  assert.match(REMOTE_PROVISION_SCRIPT, /sudo -n \/usr\/bin\/install -d -o root -g root -m 0750/);
  assert.match(REMOTE_PROVISION_SCRIPT, /test "\$METADATA" = 'root\|root\|750'/);
  const nonce = 'C'.repeat(43);
  const digest = createHash('sha256').update(nonce).digest('hex');
  const store = new InMemoryCredentialStore();
  await store.set(BOOTSTRAP_NONCE_CREDENTIAL_KEY, nonce);
  for (const [exitCode, classification] of [[31, 'BOOTSTRAP_CONFIG_DIR_PROVISION_FAILED'], [32, 'BOOTSTRAP_HASH_WRITE_FAILED'], [33, 'BOOTSTRAP_HASH_METADATA_FAILED'], [99, 'BOOTSTRAP_HASH_PROVISION_FAILED']] as const) {
    await assert.rejects(
      () => provisionBootstrapHash({ store, target: 'awh-vps', spawnImpl: async (_executable, _args, stdin) => {
        assert.equal(stdin, `${digest}\n`);
        return exitCode;
      } }),
      (error: unknown) => error instanceof Error && error.message === classification && !error.message.includes(nonce) && !error.message.includes(digest),
    );
  }
  const reused = await store.get(BOOTSTRAP_NONCE_CREDENTIAL_KEY);
  assert.equal(reused, nonce);
});

test('bootstrap hash provisioning rejects missing secure state and unsafe SSH aliases', async () => {
  await assert.rejects(() => provisionBootstrapHash({ store: new InMemoryCredentialStore(), target: 'awh-vps;touch' }), /invalid/i);
  const store = new InMemoryCredentialStore();
  await assert.rejects(() => provisionBootstrapHash({ store, target: 'awh-vps' }), /secure credential store/i);
});

test('production helper resolves through compiled dist under plain Node and uses a local no-network spawn fixture', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-bootstrap-helper-'));
  const fixture = join(root, 'fake-ssh.mjs');
  const helper = join(process.cwd(), 'scripts/deploy/provision-bootstrap-hash.mjs');
  try {
    await writeFile(fixture, "let body=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (chunk) => body += chunk); process.stdin.on('end', () => process.exit(/^[0-9a-f]{64}\\n$/.test(body) ? 0 : 21));\n", 'utf8');
    const nonce = 'B'.repeat(43);
    const store = new InMemoryCredentialStore();
    await store.set(BOOTSTRAP_NONCE_CREDENTIAL_KEY, nonce);
    let receivedArgs = [];
    let receivedStdin = '';
    const result = await provisionBootstrapHash({
      store,
      target: 'awh-vps',
      spawnImpl: async (executable, args, stdin) => {
        receivedArgs = [...args];
        receivedStdin = stdin;
        return runSsh(process.execPath, [fixture, ...args], stdin);
      },
    });
    assert.equal(result.path, '/etc/awh-hub/enrollment-bootstrap.sha256');
    assert.equal(receivedStdin, `${createHash('sha256').update(nonce).digest('hex')}\n`);
    assert.equal(receivedArgs.some((arg) => arg.includes(nonce) || arg.includes(receivedStdin.trim())), false);

    const child = spawn(process.execPath, [helper], { cwd: process.cwd(), shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    const exitCode = await new Promise((resolve) => child.once('close', resolve));
    assert.equal(exitCode, 2);
    assert.match(stdout, /approval-gated/i);
    assert.equal(stderr, '');
    assert.equal(stdout.includes(nonce), false);
    assert.equal(stdout.includes(receivedStdin.trim()), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
