#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createProductionCredentialStore, DEVICE_TOKEN_CREDENTIAL_KEY } from '../../dist/credential-store.js';
import { EnrollmentClient } from '../../dist/enrollment-client.js';
import { loadConfig } from '../../dist/config.js';
import { readProjectManifest } from '../../dist/project-registry.js';
import { provisionBootstrapHash } from './provision-bootstrap-hash.mjs';

const TARGET_PATTERN = /^[A-Za-z0-9._-]+$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const DEFAULT_DEPLOY_SCRIPT = fileURLToPath(new URL('../../deploy/awh-enrollment/deploy-enrollment.sh', import.meta.url));
const PREFLIGHT_SCRIPT = fileURLToPath(new URL('../../deploy/awh-enrollment/preflight-production.sh', import.meta.url));
const REMOTE_DEPLOY_SCRIPT = fileURLToPath(new URL('../../deploy/awh-enrollment/remote-deploy.sh', import.meta.url));
const NGINX_INSERT_HELPER = fileURLToPath(new URL('../../deploy/awh-enrollment/insert-nginx-include.php', import.meta.url));
const BOOTSTRAP_PROVISION_HELPER = fileURLToPath(new URL('./provision-bootstrap-hash.mjs', import.meta.url));
const DIST_RUNTIME = [
  fileURLToPath(new URL('../../dist/credential-store.js', import.meta.url)),
  fileURLToPath(new URL('../../dist/enrollment-client.js', import.meta.url)),
  fileURLToPath(new URL('../../dist/config.js', import.meta.url)),
  fileURLToPath(new URL('../../dist/project-registry.js', import.meta.url)),
];
const HUB_READ_DB = '/var/lib/awh-hub/awh.sqlite';
const HUB_READ_FRONT_CONTROLLER = '/opt/awh-hub/public/index.php';
const FORBIDDEN_KEY = /(token|secret|nonce|password|credential|authorization|private|workspacepath|filepath|ssh)/i;
export const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
export const PRODUCTION_DEPLOY_TIMEOUT_MS = 180_000;
const DEPLOY_STAGES = new Set([
  'BOOTSTRAP_HASH_VALIDATED', 'SERVICE_USER_READY', 'BACKUP_VERIFIED', 'DB_WRITE_READY',
  'RELEASE_ACCESS_READY', 'RELEASE_STAGED', 'MIGRATION_FIRST_PASS', 'MIGRATION_IDEMPOTENT', 'FPM_CONFIGURED',
  'NGINX_CONFIGURED', 'SERVICE_RELOAD', 'M3D_REGRESSION', 'ENROLLMENT_ROUTE',
]);
const MAX_DEPLOY_OUTPUT_BYTES = 16 * 1024;

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
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(url.hostname) || !/[a-z]/i.test(url.hostname)) throw new Error('Hub API hostname is invalid');
  return url;
}

export function validatedHubHostname(apiBase) {
  return apiRoot(apiBase).hostname;
}

function runProcess(executable, args, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true, env });
    child.once('error', () => reject(new Error('Guarded deployment process is unavailable')));
    child.once('close', (code) => resolve(code ?? 1));
  });
}

export function runCapture(executable, args, { cwd, env = process.env, maxBytes = 16 * 1024, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let stdout = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ exitCode: 124, stdout, timedOut: true });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout, 'utf8') > maxBytes) {
        clearTimeout(timer);
        child.kill();
        finish({ exitCode: 75, stdout, timedOut: false });
      }
    });
    child.once('error', () => { clearTimeout(timer); reject(new Error('Fixed local process is unavailable')); });
    child.once('close', (code) => { clearTimeout(timer); finish({ exitCode: code ?? 1, stdout, timedOut: false }); });
  });
}

function runReadOnlySsh(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let stdout = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ exitCode: 124, stdout: '' });
    }, 15_000);
    child.stdout.on('data', (chunk) => {
      if (Buffer.byteLength(stdout, 'utf8') <= 16 * 1024) stdout += chunk.toString();
      if (Buffer.byteLength(stdout, 'utf8') > 16 * 1024) {
        clearTimeout(timer);
        child.kill();
        finish({ exitCode: 75, stdout: '' });
      }
    });
    child.once('error', () => { clearTimeout(timer); reject(new Error('Read-only SSH process is unavailable')); });
    child.once('close', (code) => { clearTimeout(timer); finish({ exitCode: code ?? 1, stdout }); });
  });
}

export async function runDeploymentDryRun({ runImpl = runCapture } = {}) {
  const result = await runImpl('/bin/sh', [DEFAULT_DEPLOY_SCRIPT, '--dry-run'], { maxBytes: 16 * 1024 });
  if (!result || result.exitCode !== 0 || typeof result.stdout !== 'string' || !result.stdout.includes('PRODUCTION_DEPLOY_APPROVAL_REQUIRED')) {
    throw new Error('Local enrollment deployment dry-run failed');
  }
}

function parseDeploymentOutput(stdout) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout, 'utf8') > MAX_DEPLOY_OUTPUT_BYTES) throw new Error('Deployment output is not sanitized');
  const lines = stdout.trim() === '' ? [] : stdout.trim().split(/\r?\n/);
  const stages = [];
  let failedAt = null;
  let rollback = null;
  let result = null;
  const rejectOutput = () => {
    const error = new Error('Deployment output is not sanitized');
    error.stages = [...stages];
    error.failedAt = failedAt;
    error.rollback = rollback;
    throw error;
  };
  for (const line of lines) {
    if (line.startsWith('DEPLOY_STAGE=')) {
      const stage = line.slice('DEPLOY_STAGE='.length);
      if (!DEPLOY_STAGES.has(stage)) rejectOutput();
      stages.push(stage);
      continue;
    }
    if (line.startsWith('DEPLOY_FAILED_AT=')) {
      const stage = line.slice('DEPLOY_FAILED_AT='.length);
      if (failedAt !== null || !DEPLOY_STAGES.has(stage)) rejectOutput();
      failedAt = stage;
      continue;
    }
    if (line.startsWith('DEPLOY_RESULT=')) {
      if (result !== null || line !== 'DEPLOY_RESULT=PASS') rejectOutput();
      result = 'PASS';
      continue;
    }
    if (line.startsWith('ROLLBACK=')) {
      if (rollback !== null || !['PASS', 'FAIL'].includes(line.slice('ROLLBACK='.length))) rejectOutput();
      rollback = line.slice('ROLLBACK='.length);
      continue;
    }
    rejectOutput();
  }
  return { stages, failedAt, rollback, result };
}

export async function runGuardedDeployment({ runImpl = runCapture, hubHostname } = {}) {
  const options = { maxBytes: MAX_DEPLOY_OUTPUT_BYTES, timeoutMs: PRODUCTION_DEPLOY_TIMEOUT_MS };
  if (hubHostname !== undefined) options.env = { ...process.env, AWH_HUB_HOSTNAME: validatedHubHostname(`https://${hubHostname}/api/v1`) };
  const processResult = await runImpl('/bin/sh', [DEFAULT_DEPLOY_SCRIPT, '--deploy'], options);
  let output;
  try {
    output = parseDeploymentOutput(processResult?.stdout);
  } catch (error) {
    if (!processResult?.timedOut) throw error;
    const timeoutError = new Error('Guarded enrollment deployment timed out');
    timeoutError.deployTimeout = true;
    timeoutError.stages = error?.stages ?? [];
    timeoutError.deployFailedAt = error?.failedAt ?? null;
    timeoutError.rollback = error?.rollback ?? null;
    throw timeoutError;
  }
  if (processResult?.timedOut) {
    const error = new Error('Guarded enrollment deployment timed out');
    error.deployTimeout = true;
    error.stages = output.stages;
    error.deployFailedAt = output.failedAt;
    error.rollback = output.rollback;
    throw error;
  }
  if (processResult?.exitCode !== 0) {
    if (!output.failedAt || !output.rollback) throw new Error('Guarded enrollment deployment failed');
    const error = new Error('Guarded enrollment deployment failed');
    error.stages = output.stages;
    error.deployFailedAt = output.failedAt;
    error.rollback = output.rollback;
    throw error;
  }
  if (output.result !== 'PASS' || output.failedAt !== null || output.rollback !== null) throw new Error('Deployment success output is invalid');
  return output;
}

async function requireRegularFile(filePath, lstatImpl = lstat) {
  let info;
  try { info = await lstatImpl(filePath); } catch { throw new Error('Reviewed local deployment asset is unavailable'); }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Reviewed local deployment asset is unsafe');
}

export async function validateLocalAssets({ expectedCommit = process.env.AWH_RELEASE_COMMIT, lstatImpl = lstat, gitImpl = runCapture } = {}) {
  if (typeof expectedCommit !== 'string' || !SHA_PATTERN.test(expectedCommit)) throw new Error('AWH release lock is unavailable');
  const assets = [DEFAULT_DEPLOY_SCRIPT, PREFLIGHT_SCRIPT, REMOTE_DEPLOY_SCRIPT, NGINX_INSERT_HELPER, BOOTSTRAP_PROVISION_HELPER, ...DIST_RUNTIME];
  for (const asset of assets) await requireRegularFile(asset, lstatImpl);
  const wrongDeployPath = fileURLToPath(new URL('./awh-enrollment/deploy-enrollment.sh', import.meta.url));
  try {
    const wrongInfo = await lstatImpl(wrongDeployPath);
    if (wrongInfo.isFile() || wrongInfo.isSymbolicLink()) throw new Error('Duplicate deployment engine path is present');
  } catch (error) {
    if (error instanceof Error && error.message === 'Duplicate deployment engine path is present') throw error;
  }
  const head = await gitImpl('git', ['-C', REPO_ROOT, 'rev-parse', '--verify', 'HEAD'], { cwd: REPO_ROOT, maxBytes: 1024 });
  const status = await gitImpl('git', ['-C', REPO_ROOT, 'status', '--porcelain', '--untracked-files=all'], { cwd: REPO_ROOT, maxBytes: 16 * 1024 });
  if (head.exitCode !== 0 || head.stdout.trim() !== expectedCommit) throw new Error('AWH release HEAD does not match the approved lock');
  if (status.exitCode !== 0 || status.stdout.trim() !== '') throw new Error('AWH release tree is dirty or uncommitted');
  return { repoRoot: REPO_ROOT, head: expectedCommit, assetCount: assets.length };
}

export async function runReadOnlyPreflight({ target, spawnImpl = runProcess } = {}) {
  const safe = safeTarget(target);
  const exitCode = await spawnImpl('/bin/sh', [PREFLIGHT_SCRIPT], { env: { ...process.env, AWH_DEPLOY_TARGET: safe } });
  if (exitCode !== 0) throw new Error('Read-only VPS preflight failed');
}

function assertSanitizedHealth(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Hub health response is invalid');
  const record = value;
  for (const key of Object.keys(record)) if (FORBIDDEN_KEY.test(key)) throw new Error('Hub health response is not sanitized');
  if (record.schemaVersion !== 1 || record.status !== 'ok' || record.service !== 'awh-hub-read-foundation') throw new Error('Hub health response is not ready');
  return { schemaVersion: 1, status: 'ok', service: 'awh-hub-read-foundation' };
}

export async function verifyProtectedPerimeter(apiBase, fetchImpl = fetch) {
  const root = apiRoot(apiBase);
  const statuses = {};
  for (const path of ['health', 'status', 'projects']) {
    const requestUrl = new URL(`${root.toString()}/${path}`);
    const response = await fetchImpl(requestUrl, {
      method: 'GET',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
    });
    if (new URL(response.url || requestUrl).origin !== root.origin || response.status !== 401) throw new Error('Hub HTTPS perimeter verification failed');
    statuses[path] = 401;
  }
  return statuses;
}

export async function verifyInternalHubHealth(target, { sshImpl = runReadOnlySsh, executable = 'ssh' } = {}) {
  const safe = safeTarget(target);
  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes',
    safe,
    'sudo', '-n', 'env',
    `AWH_HUB_DB_PATH=${HUB_READ_DB}`,
    'REQUEST_METHOD=GET',
    'REQUEST_URI=/api/v1/health',
    '/usr/bin/php',
    HUB_READ_FRONT_CONTROLLER,
  ];
  const result = await sshImpl(executable, args);
  if (!result || result.exitCode !== 0 || typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout, 'utf8') > 16 * 1024) throw new Error('Internal Hub health command failed');
  let body;
  try { body = JSON.parse(result.stdout); } catch { throw new Error('Internal Hub health JSON is invalid'); }
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
  validateAssets = validateLocalAssets,
  dryRun = runDeploymentDryRun,
  verifyExternal = verifyProtectedPerimeter,
  verifyInternal = verifyInternalHubHealth,
  verifyPreflight = runReadOnlyPreflight,
  apiBase,
}) {
  if (!client || !store) throw new Error('Bootstrap orchestration dependencies are unavailable');
  const hubHostname = validatedHubHostname(apiBase);
  await validateAssets({ expectedCommit: process.env.AWH_RELEASE_COMMIT });
  await dryRun();
  await verifyExternal(apiBase);
  await verifyInternal(target);
  await verifyPreflight({ target });
  await client.prepareBootstrapNonce();
  await provision({ store, target: safeTarget(target) });
  await deploy({ hubHostname });
  const state = await client.bootstrapAndEnroll(projectIds, displayName, userId);
  const stored = await store.get(DEVICE_TOKEN_CREDENTIAL_KEY);
  if (!stored) throw new Error('First device credential was not stored');
  const external = await verifyExternal(apiBase);
  const internal = await verifyInternal(target);
  return {
    enrolled: state.enrolled,
    deviceId: state.deviceId,
    platform: state.platform,
    credentialStored: state.credentialStored,
    hub: { external, internal },
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
    process.stdout.write(`AWH bootstrap orchestration completed: enrolled=${result.enrolled}; credentialStored=${result.credentialStored}; hub=protected-perimeter+internal-health\n`);
  } catch (error) {
    if (error && typeof error === 'object' && error.deployTimeout === true) {
      for (const stage of Array.isArray(error.stages) ? error.stages : []) process.stdout.write(`DEPLOY_STAGE=${stage}\n`);
      if (typeof error.deployFailedAt === 'string') process.stdout.write(`DEPLOY_FAILED_AT=${error.deployFailedAt}\n`);
      if (error.rollback === 'PASS' || error.rollback === 'FAIL') process.stdout.write(`ROLLBACK=${error.rollback}\n`);
      process.stderr.write('DEPLOY_TIMEOUT=1\n');
    } else if (error && typeof error === 'object' && typeof error.deployFailedAt === 'string' && ['PASS', 'FAIL'].includes(error.rollback)) {
      process.stderr.write(`DEPLOY_FAILED_AT=${error.deployFailedAt}\nROLLBACK=${error.rollback}\n`);
    } else {
      process.stderr.write('AWH bootstrap orchestration failed closed.\n');
    }
    process.exitCode = 1;
  }
}
