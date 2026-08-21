import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { provisionBootstrapHash } from '../scripts/deploy/provision-bootstrap-hash.mjs';
import { BOOTSTRAP_NONCE_CREDENTIAL_KEY, InMemoryCredentialStore } from '../src/credential-store.js';

test('bootstrap hash provisioning reads the secure store and sends only a digest on stdin', async () => {
  const nonce = 'temporary-bootstrap-nonce-for-test-only-0123456789';
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
  assert.match(args.at(-1) ?? '', /^sh -c '/);
});

test('bootstrap hash provisioning rejects missing secure state and unsafe SSH aliases', async () => {
  await assert.rejects(() => provisionBootstrapHash({ store: new InMemoryCredentialStore(), target: 'awh-vps;touch' }), /invalid/i);
  const store = new InMemoryCredentialStore();
  await assert.rejects(() => provisionBootstrapHash({ store, target: 'awh-vps' }), /secure credential store/i);
});
