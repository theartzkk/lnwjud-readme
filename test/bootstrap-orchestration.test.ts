import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import test from 'node:test';
import { DEFAULT_DEPLOY_SCRIPT, DEFAULT_COMMAND_TIMEOUT_MS, PRODUCTION_DEPLOY_TIMEOUT_MS, runBootstrapOrchestration, runCapture, runDeploymentDryRun, runGuardedDeployment, validatedHubHostname, validateLocalAssets, verifyInternalHubHealth, verifyProtectedPerimeter } from '../scripts/deploy/bootstrap-owner.mjs';
import { BOOTSTRAP_NONCE_CREDENTIAL_KEY, DEVICE_TOKEN_CREDENTIAL_KEY, InMemoryCredentialStore } from '../src/credential-store.js';
import { EnrollmentClient } from '../src/enrollment-client.js';

const PROJECT_ID = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
const OWNER_ID = '223b45c0-23e1-408d-ae0f-ac5eca7f6900';
const execFile = promisify(execFileCallback);

test('default deployment path is the canonical repo asset and dry-run performs no SSH or provisioning', async () => {
  const repoRoot = process.cwd();
  assert.equal(DEFAULT_DEPLOY_SCRIPT, join(repoRoot, 'deploy/awh-enrollment/deploy-enrollment.sh'));
  assert.equal(existsSync(DEFAULT_DEPLOY_SCRIPT), true);
  assert.equal(existsSync(join(repoRoot, 'scripts/deploy/awh-enrollment/deploy-enrollment.sh')), false);
  let invoked = false;
  await runDeploymentDryRun({ runImpl: async (executable, args) => {
    invoked = true;
    assert.equal(executable, '/bin/sh');
    assert.deepEqual(args, [DEFAULT_DEPLOY_SCRIPT, '--dry-run']);
    return { exitCode: 0, stdout: 'PRODUCTION_DEPLOY_APPROVAL_REQUIRED: pass\n' };
  } });
  assert.equal(invoked, true);

  const root = await mkdtemp(join(tmpdir(), 'awh-deploy-dry-run-'));
  const fakeBin = join(root, 'bin');
  const marker = join(root, 'ssh-called');
  try {
    await mkdir(fakeBin, { recursive: true });
    const fakeSsh = join(fakeBin, 'ssh');
    await writeFile(fakeSsh, `#!/bin/sh\nprintf called > '${marker}'\nexit 99\n`, 'utf8');
    await chmod(fakeSsh, 0o755);
    const result = await execFile('/bin/sh', [DEFAULT_DEPLOY_SCRIPT, '--dry-run'], {
      cwd: repoRoot,
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}`, TMPDIR: root, AWH_DEPLOY_TARGET: 'awh-vps' },
    });
    assert.match(result.stdout, /PRODUCTION_DEPLOY_APPROVAL_REQUIRED/);
    assert.equal(existsSync(marker), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('local asset gate verifies the canonical assets, compiled runtime, HEAD and clean release lock', async () => {
  const head = '207edbbc38ad9c9a98bbd56ca3ad41ff9ba8a87e';
  const gitCalls = [];
  const result = await validateLocalAssets({
    expectedCommit: head,
    gitImpl: async (executable, args) => {
      gitCalls.push({ executable, args });
      return { exitCode: 0, stdout: args.includes('status') ? '' : `${head}\n` };
    },
  });
  assert.equal(result.head, head);
  assert.equal(result.assetCount >= 9, true);
  assert.deepEqual(gitCalls.map(({ executable, args }) => [executable, ...args.slice(2)]), [
    ['git', 'rev-parse', '--verify', 'HEAD'],
    ['git', 'status', '--porcelain', '--untracked-files=all'],
  ]);
  await assert.rejects(() => validateLocalAssets({
    expectedCommit: head,
    lstatImpl: async (filePath) => {
      if (filePath === DEFAULT_DEPLOY_SCRIPT) throw new Error('missing');
      return lstat(filePath);
    },
    gitImpl: async () => ({ exitCode: 0, stdout: `${head}\n` }),
  }), /unavailable/);
});

test('pre-mutation failures stop before bootstrap provisioning', async () => {
  const store = new InMemoryCredentialStore();
  const base = { client: {}, store, target: 'awh-vps', projectIds: [PROJECT_ID], apiBase: 'https://hub.example/api/v1', provision: async () => { throw new Error('provision must not run'); } };
  const noOpAssets = async () => {};
  const noOpDryRun = async () => {};
  const noOpPreflight = async () => {};
  const healthyInternal = async () => ({ schemaVersion: 1, status: 'ok', service: 'awh-hub-read-foundation' });
  const healthyExternal = async () => ({ health: 401, status: 401, projects: 401 });

  await assert.rejects(() => runBootstrapOrchestration({ ...base, validateAssets: async () => { throw new Error('missing deployment asset'); } }), /missing deployment asset/);
  await assert.rejects(() => runBootstrapOrchestration({ ...base, validateAssets: noOpAssets, dryRun: async () => { throw new Error('dry-run failed'); } }), /dry-run failed/);
  await assert.rejects(() => runBootstrapOrchestration({ ...base, validateAssets: noOpAssets, dryRun: noOpDryRun, verifyExternal: async () => { throw new Error('external perimeter failed'); }, verifyInternal: healthyInternal, verifyPreflight: noOpPreflight }), /external perimeter failed/);
  await assert.rejects(() => runBootstrapOrchestration({ ...base, validateAssets: noOpAssets, dryRun: noOpDryRun, verifyExternal: healthyExternal, verifyInternal: async () => { throw new Error('internal health failed'); }, verifyPreflight: noOpPreflight }), /internal health failed/);
  await assert.rejects(() => runBootstrapOrchestration({ ...base, validateAssets: noOpAssets, dryRun: noOpDryRun, verifyExternal: healthyExternal, verifyInternal: healthyInternal, verifyPreflight: async () => { throw new Error('preflight failed'); } }), /preflight failed/);
});

test('guarded deployment captures only allowlisted sanitized success stages', async () => {
  const result = await runGuardedDeployment({
    runImpl: async () => ({
      exitCode: 0,
      stdout: 'DEPLOY_STAGE=BOOTSTRAP_HASH_VALIDATED\nDEPLOY_STAGE=RELEASE_ACCESS_READY\nDEPLOY_STAGE=BACKUP_VERIFIED\nDEPLOY_STAGE=MIGRATION_IDEMPOTENT\nDEPLOY_RESULT=PASS\n',
    }),
  });
  assert.deepEqual(result.stages, ['BOOTSTRAP_HASH_VALIDATED', 'RELEASE_ACCESS_READY', 'BACKUP_VERIFIED', 'MIGRATION_IDEMPOTENT']);
  assert.equal(result.result, 'PASS');
  await assert.rejects(() => runGuardedDeployment({ runImpl: async () => ({ exitCode: 0, stdout: 'DEPLOY_STAGE=UNKNOWN\nDEPLOY_RESULT=PASS\n' }) }), /sanitized/);
  await assert.rejects(() => runGuardedDeployment({ runImpl: async () => ({ exitCode: 0, stdout: `DEPLOY_STAGE=BACKUP_VERIFIED\nsecret=${'x'.repeat(64)}\nDEPLOY_RESULT=PASS\n` }) }), (error: unknown) => error instanceof Error && !error.message.includes('x'.repeat(64)));
});

test('guarded deployment preserves sanitized failure stage and rollback result', async () => {
  for (const rollback of ['PASS', 'FAIL']) {
    await assert.rejects(
      () => runGuardedDeployment({ runImpl: async () => ({ exitCode: 1, stdout: `DEPLOY_STAGE=BACKUP_VERIFIED\nDEPLOY_FAILED_AT=MIGRATION_FIRST_PASS\nROLLBACK=${rollback}\n` }) }),
      (error: unknown) => error instanceof Error && error.deployFailedAt === 'MIGRATION_FIRST_PASS' && error.rollback === rollback,
    );
  }
});

test('production deployment keeps the longer bounded timeout and preserves stage output', async () => {
  const startedAt = Date.now();
  const result = await runCapture('/bin/sh', ['-c', "sleep 11; printf 'DEPLOY_STAGE=RELEASE_STAGED\\nDEPLOY_RESULT=PASS\\n'"], { timeoutMs: PRODUCTION_DEPLOY_TIMEOUT_MS });
  assert.ok(Date.now() - startedAt >= 10_000);
  assert.equal(result.timedOut, false);
  assert.match(result.stdout, /DEPLOY_STAGE=RELEASE_STAGED/);

  let receivedOptions;
  const guarded = await runGuardedDeployment({
    runImpl: async (_executable, _args, options) => {
      receivedOptions = options;
      return { exitCode: 0, stdout: 'DEPLOY_STAGE=RELEASE_STAGED\nDEPLOY_RESULT=PASS\n' };
    },
  });
  assert.equal(receivedOptions.timeoutMs, PRODUCTION_DEPLOY_TIMEOUT_MS);
  assert.equal(guarded.result, 'PASS');
  assert.equal(DEFAULT_COMMAND_TIMEOUT_MS, 10_000);
});

test('production deployment receives only a validated public Hub hostname', async () => {
  assert.equal(validatedHubHostname('https://157-85-108-142.sslip.io/api/v1'), '157-85-108-142.sslip.io');
  assert.throws(() => validatedHubHostname('https://127.0.0.1/api/v1'), /hostname/i);
  assert.throws(() => validatedHubHostname('https://*.example/api/v1'), /hostname/i);
  let receivedOptions;
  await runGuardedDeployment({
    hubHostname: '157-85-108-142.sslip.io',
    runImpl: async (_executable, _args, options) => {
      receivedOptions = options;
      return { exitCode: 0, stdout: 'DEPLOY_STAGE=RELEASE_STAGED\nDEPLOY_RESULT=PASS\n' };
    },
  });
  assert.equal(receivedOptions.env.AWH_HUB_HOSTNAME, '157-85-108-142.sslip.io');
});

test('real deployment timeout is sanitized and retains safe stages received before timeout', async () => {
  const result = await runCapture('/bin/sh', ['-c', "printf 'DEPLOY_STAGE=RELEASE_STAGED\\n'; sleep 1"], { timeoutMs: 250 });
  assert.equal(result.timedOut, true);
  assert.match(result.stdout, /DEPLOY_STAGE=RELEASE_STAGED/);

  await assert.rejects(
    () => runGuardedDeployment({ runImpl: async () => ({ exitCode: 124, timedOut: true, stdout: 'DEPLOY_STAGE=RELEASE_STAGED\n' }) }),
    (error: unknown) => error instanceof Error
      && error.deployTimeout === true
      && error.stages?.[0] === 'RELEASE_STAGED'
      && !error.message.includes('RELEASE_STAGED'),
  );
});

test('one-shot orchestration provisions and bootstraps with the exact same secure nonce', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-bootstrap-orchestration-'));
  const store = new InMemoryCredentialStore();
  const requests: Request[] = [];
  let provisionedDigest = '';
  let provisioned = false;
  let deployed = false;
  let deployedHost = '';
  let bootstrapNonce = '';
  try {
    const client = new EnrollmentClient('https://hub.example/api/v1', root, store, async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.endsWith('/enrollment/bootstrap')) {
        bootstrapNonce = request.headers.get('X-AWH-Bootstrap-Nonce') ?? '';
        return new Response(JSON.stringify({ bootstrapClosed: true, initialPairingCode: 'P'.repeat(43), initialPairingExpiresAt: '2026-09-01T00:10:00.000Z' }), { status: 200 });
      }
      assert.equal(request.url, 'https://hub.example/api/v1/enrollment/devices');
      return new Response(JSON.stringify({ accessToken: 'device-token-only-in-store', expiresAt: '2026-09-01T00:00:00.000Z', projectCount: 1 }), { status: 200 });
    });
    const result = await runBootstrapOrchestration({
      client,
      store,
      target: 'awh-vps',
      projectIds: [PROJECT_ID],
      userId: OWNER_ID,
      validateAssets: async () => {},
      dryRun: async () => {},
      verifyPreflight: async ({ target }) => { assert.equal(target, 'awh-vps'); },
      provision: async ({ store: receivedStore }) => {
        const nonce = await receivedStore.get(BOOTSTRAP_NONCE_CREDENTIAL_KEY);
        assert.ok(nonce);
        provisionedDigest = createHash('sha256').update(nonce).digest('hex');
        provisioned = true;
      },
      deploy: async ({ hubHostname }) => { deployed = true; deployedHost = hubHostname; },
      verifyExternal: async (apiBase) => {
        assert.equal(apiBase, 'https://hub.example/api/v1');
        return { health: 401, status: 401, projects: 401 };
      },
      verifyInternal: async (target) => {
        assert.equal(target, 'awh-vps');
        return { schemaVersion: 1, status: 'ok', service: 'awh-hub-read-foundation' };
      },
      apiBase: 'https://hub.example/api/v1',
    });
    assert.equal(provisioned, true);
    assert.equal(deployed, true);
    assert.equal(deployedHost, 'hub.example');
    assert.equal(createHash('sha256').update(bootstrapNonce).digest('hex'), provisionedDigest);
    assert.equal(requests.length, 2);
    assert.equal(result.enrolled, true);
    assert.equal(result.credentialStored, true);
    assert.deepEqual(result.hub.external, { health: 401, status: 401, projects: 401 });
    assert.deepEqual(result.hub.internal, { schemaVersion: 1, status: 'ok', service: 'awh-hub-read-foundation' });
    assert.equal(await store.get(BOOTSTRAP_NONCE_CREDENTIAL_KEY), null);
    assert.equal(await store.get(DEVICE_TOKEN_CREDENTIAL_KEY), 'device-token-only-in-store');
    const resultText = JSON.stringify(result);
    assert.equal(resultText.includes(bootstrapNonce), false);
    assert.equal(resultText.includes(provisionedDigest), false);
    assert.equal(resultText.includes('device-token-only-in-store'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('failed provisioning stops before bootstrap and keeps the prepared nonce for a controlled retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-bootstrap-orchestration-'));
  const store = new InMemoryCredentialStore();
  let requestCount = 0;
  try {
    const client = new EnrollmentClient('https://hub.example/api/v1', root, store, async () => {
      requestCount += 1;
      throw new Error('bootstrap must not run');
    });
    await assert.rejects(() => runBootstrapOrchestration({
      client,
      store,
      target: 'awh-vps',
      projectIds: [PROJECT_ID],
      validateAssets: async () => {},
      dryRun: async () => {},
      verifyPreflight: async () => {},
      provision: async () => { throw new Error('fixture provisioning failure'); },
      deploy: async () => { throw new Error('deployment must not run'); },
      verifyExternal: async () => ({ health: 401, status: 401, projects: 401 }),
      verifyInternal: async () => ({ schemaVersion: 1, status: 'ok', service: 'awh-hub-read-foundation' }),
      apiBase: 'https://hub.example/api/v1',
    }));
    assert.equal(requestCount, 0);
    assert.match(await store.get(BOOTSTRAP_NONCE_CREDENTIAL_KEY) ?? '', /^[A-Za-z0-9_-]{43}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('failed bootstrap reuses the same nonce and never silently generates a replacement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'awh-bootstrap-orchestration-'));
  const store = new InMemoryCredentialStore();
  const nonces: string[] = [];
  try {
    const client = new EnrollmentClient('https://hub.example/api/v1', root, store, async (input, init) => {
      const request = new Request(input, init);
      if (request.url.endsWith('/enrollment/bootstrap')) nonces.push(request.headers.get('X-AWH-Bootstrap-Nonce') ?? '');
      return new Response(JSON.stringify({ code: 'BOOTSTRAP_REJECTED', message: 'rejected' }), { status: 400 });
    });
    await client.prepareBootstrapNonce();
    await assert.rejects(() => client.bootstrapAndEnroll([PROJECT_ID], undefined, OWNER_ID));
    await assert.rejects(() => client.bootstrapAndEnroll([PROJECT_ID], undefined, OWNER_ID));
    assert.equal(nonces.length, 2);
    assert.equal(nonces[0], nonces[1]);
    assert.match(nonces[0] ?? '', /^[A-Za-z0-9_-]{43}$/);
    assert.match(await store.get(BOOTSTRAP_NONCE_CREDENTIAL_KEY) ?? '', /^[A-Za-z0-9_-]{43}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('protected external perimeter accepts 401 without forwarding Basic Auth or bearer credentials', async () => {
  const requests = [];
  const result = await verifyProtectedPerimeter('https://hub.example/api/v1', async (input, init) => {
    requests.push({ input: String(input), init });
    return new Response('', { status: 401 });
  });
  assert.deepEqual(result, { health: 401, status: 401, projects: 401 });
  assert.deepEqual(requests.map((request) => request.input), [
    'https://hub.example/api/v1/health',
    'https://hub.example/api/v1/status',
    'https://hub.example/api/v1/projects',
  ]);
  for (const request of requests) {
    assert.equal(request.init.credentials, 'omit');
    assert.equal(Object.hasOwn(request.init.headers, 'Authorization'), false);
    assert.equal(Object.hasOwn(request.init.headers, 'Cookie'), false);
  }
});

test('unexpected public 200, redirect/fetch failure, and non-401 responses fail closed', async () => {
  await assert.rejects(() => verifyProtectedPerimeter('https://hub.example/api/v1', async () => new Response('{}', { status: 200 })));
  await assert.rejects(() => verifyProtectedPerimeter('https://hub.example/api/v1', async () => { throw new Error('TLS failure'); }));
  await assert.rejects(() => verifyProtectedPerimeter('https://hub.example/api/v1', async () => new Response('', { status: 404 })));
});

test('trusted internal Hub health reuses the deployed PHP front controller with fixed read-only argv', async () => {
  let receivedExecutable = '';
  let receivedArgs = [];
  const result = await verifyInternalHubHealth('awh-vps', {
    sshImpl: async (executable, args) => {
      receivedExecutable = executable;
      receivedArgs = [...args];
      return { exitCode: 0, stdout: JSON.stringify({ schemaVersion: 1, status: 'ok', service: 'awh-hub-read-foundation', requestId: 'safe-request-id' }) };
    },
  });
  assert.deepEqual(result, { schemaVersion: 1, status: 'ok', service: 'awh-hub-read-foundation' });
  assert.equal(receivedExecutable, 'ssh');
  assert.deepEqual(receivedArgs, [
    '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'awh-vps', 'sudo', '-n', 'env',
    'AWH_HUB_DB_PATH=/var/lib/awh-hub/awh.sqlite', 'REQUEST_METHOD=GET', 'REQUEST_URI=/api/v1/health',
    '/usr/bin/php', '/opt/awh-hub/public/index.php',
  ]);
});

test('trusted internal Hub health rejects malformed, wrong, oversized, or failed responses without logging them', async () => {
  await assert.rejects(() => verifyInternalHubHealth('awh-vps', { sshImpl: async () => ({ exitCode: 0, stdout: '<html>401</html>' }) }));
  await assert.rejects(() => verifyInternalHubHealth('awh-vps', { sshImpl: async () => ({ exitCode: 0, stdout: JSON.stringify({ schemaVersion: 1, status: 'down', service: 'awh-hub-read-foundation' }) }) }));
  await assert.rejects(() => verifyInternalHubHealth('awh-vps', { sshImpl: async () => ({ exitCode: 0, stdout: JSON.stringify({ schemaVersion: 1, status: 'ok', service: 'other' }) }) }));
  await assert.rejects(() => verifyInternalHubHealth('awh-vps', { sshImpl: async () => ({ exitCode: 1, stdout: '' }) }));
  const secret = 'device-token-must-not-appear';
  await assert.rejects(() => verifyInternalHubHealth('awh-vps', { sshImpl: async () => ({ exitCode: 0, stdout: JSON.stringify({ schemaVersion: 1, status: 'ok', service: 'awh-hub-read-foundation', token: secret }) }) }));
});
