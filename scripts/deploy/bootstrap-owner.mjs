#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProductionCredentialStore, DEVICE_TOKEN_CREDENTIAL_KEY } from '../../dist/credential-store.js';
import { EnrollmentClient } from '../../dist/enrollment-client.js';
import { loadConfig } from '../../dist/config.js';
import { readProjectManifest } from '../../dist/project-registry.js';
import { provisionBootstrapHash } from './provision-bootstrap-hash.mjs';

const TARGET_PATTERN = /^[A-Za-z0-9._-]+$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEPLOY_SCRIPT = fileURLToPath(new URL('./awh-enrollment/deploy-enrollment.sh', import.meta.url));
const FORBIDDEN_KEY = /(token|secret|nonce|password|credential|authorization|private|workspacepath|filepath|ssh)/i;

function safeTarget(value) {
  if (typeof value !== 'string' || !TARGET_PATTERN.test(value)) throw new Error('Deployment target is invalid');
  return value;
}

function parseProjectIds(value) {
  const projectIds = value.split(',').map((item) => item.trim()).filter(Boolean);
  if (projectIds.length < 1 || projectIds.length > 16 || projectIds.some((id) => !UUID_V4.test(id))) throw new Error('Bootstrap project configuration is invalid');
  return projectIds.map((id) => id.toLowerCase());
}

function apiRoot(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Hub API configuration is invalid'); }
  if (url.protocol !== 'https:' || url.search || url.hash || !url.pathname.endsWith('/api/v1')) throw new Error('Hub API configuration is invalid');
  return url;
}

function runProcess(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
    child.once('error', () => reject(new Error('Guarded deployment process is unavailable')));
    child.once('close', (code) => resolve(code ?? 1));
  });
}

export async function runGuardedDeployment({ spawnImpl = runProcess, scriptPath = DEPLOY_SCRIPT } = {}) {
  if (typeof scriptPath !== 'string' || !scriptPath.endsWith('/deploy-enrollment.sh')) throw new Error('Deployment script is not the reviewed enrollment engine');
  const exitCode = await spawnImpl('/bin/sh', [scriptPath, '--deploy']);
  if (exitCode !== 0) throw new Error('Guarded enrollment deployment failed');
}

function assertSanitizedHealth(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Hub health response is invalid');
  const record = value;
  for (const key of Object.keys(record)) if (FORBIDDEN_KEY.test(key)) throw new Error('Hub health response is not sanitized');
  if (record.status !== 'ok' || record.service !== 'awh-hub-read-foundation') throw new Error('Hub health response is not ready');
  return { status: 'ok', service: 'awh-hub-read-foundation' };
}

export async function verifyHubHealth(apiBase, fetchImpl = fetch) {
  const root = apiRoot(apiBase);
  const response = await fetchImpl(new URL(`${root.toString()}/health`), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Hub health verification failed');
  let body;
  try { body = JSON.parse(await response.text()); } catch { throw new Error('Hub health response is invalid'); }
  return assertSanitizedHealth(body);
}

export async function runBootstrapOrchestration({
  client,
  store,
  target,
  projectIds,
  displayName,
  userId,
  provision = provisionBootstrapHash,
  deploy = runGuardedDeployment,
  verify = verifyHubHealth,
  apiBase,
}) {
  if (!client || !store) throw new Error('Bootstrap orchestration dependencies are unavailable');
  await client.prepareBootstrapNonce();
  await provision({ store, target: safeTarget(target) });
  await deploy();
  const state = await client.bootstrapAndEnroll(projectIds, displayName, userId);
  const stored = await store.get(DEVICE_TOKEN_CREDENTIAL_KEY);
  if (!stored) throw new Error('First device credential was not stored');
  const hub = await verify(apiBase);
  return {
    enrolled: state.enrolled,
    deviceId: state.deviceId,
    platform: state.platform,
    credentialStored: state.credentialStored,
    hub,
  };
}

async function currentProjectIds(config) {
  const configured = process.env.AWH_BOOTSTRAP_PROJECT_IDS?.trim();
  if (configured) return parseProjectIds(configured);
  const manifest = await readProjectManifest(config.workspace);
  return [manifest.projectId];
}

function usage() {
  process.stdout.write('AWH bootstrap orchestration is approval-gated; use --approve-bootstrap-orchestration after reviewed production approval.\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] !== '--approve-bootstrap-orchestration') {
    usage();
    process.exit(2);
  }
  if (process.platform !== 'darwin') {
    process.stderr.write('Bootstrap orchestration is available only for the Mac first-device flow.\n');
    process.exit(1);
  }
  try {
    const config = loadConfig();
    const apiBase = apiRoot(config.hubApiBase).toString().replace(/\/$/, '');
    const store = createProductionCredentialStore();
    const client = new EnrollmentClient(apiBase, config.dataDir, store);
    const result = await runBootstrapOrchestration({
      client,
      store,
      target: safeTarget(process.env.AWH_DEPLOY_TARGET || 'awh-vps'),
      projectIds: await currentProjectIds(config),
      apiBase,
    });
    process.stdout.write(`AWH bootstrap orchestration completed: enrolled=${result.enrolled}; credentialStored=${result.credentialStored}; hub=${result.hub.status}\n`);
  } catch {
    process.stderr.write('AWH bootstrap orchestration failed closed.\n');
    process.exitCode = 1;
  }
}
