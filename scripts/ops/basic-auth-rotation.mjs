import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProductionCredentialStore } from '../../dist/credential-store.js';

export const BASIC_AUTH_KEY = 'awh/preview-basic-auth-password';
export const BASIC_AUTH_HOST = '157-85-108-142.sslip.io';
export const BASIC_AUTH_USER = 'awh-preview';
export const ALLOWED_STAGES = new Set(['PRECHECK','HASH_RECEIVED','BACKUP_CREATED','TEMP_CREATED','ATOMIC_REPLACE','NGINX_TEST','RELOAD','PERIMETER_VERIFY','COMPLETE']);
const REMOTE = join(dirname(fileURLToPath(import.meta.url)), '../../deploy/nginx/rotate-basic-auth-remote.sh');

export function parseRotationOutput(output) {
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  const result = {};
  for (const line of lines) {
    const match = /^(ROTATE_STAGE|ROTATE_FAILED_AT|ROTATE_FAILURE_CODE|ROTATE_RESULT|ROLLBACK)=([A-Z0-9_:-]+)$/.exec(line);
    if (!match) throw new Error('ROTATION_OUTPUT_INVALID');
    const [, key, value] = match;
    if (key === 'ROTATE_STAGE' && !ALLOWED_STAGES.has(value)) throw new Error('ROTATION_STAGE_INVALID');
    if (key === 'ROTATE_FAILED_AT' && !ALLOWED_STAGES.has(value)) throw new Error('ROTATION_FAILURE_STAGE_INVALID');
    if (key === 'ROTATE_RESULT' && value !== 'PASS') throw new Error('ROTATION_RESULT_INVALID');
    if (key === 'ROLLBACK' && !['PASS','FAIL'].includes(value)) throw new Error('ROTATION_ROLLBACK_INVALID');
    result[key] = value;
  }
  return result;
}

function run(executable, args, stdin = '', timeout = 45000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let settled = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error('ROTATION_TIMEOUT')); }, timeout);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); if (Buffer.byteLength(stdout) > 16384) { child.kill(); reject(new Error('ROTATION_OUTPUT_BOUND')); } });
    child.stderr.on('data', () => {});
    child.once('error', () => { if (!settled) reject(new Error('ROTATION_PROCESS_FAILED')); });
    child.once('close', (code) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ code, stdout }); });
    child.stdin.end(stdin, 'utf8');
  });
}

export function validateAssets() {
  if (!existsSync(REMOTE)) throw new Error('ROTATION_ASSET_MISSING');
  const text = readFileSync(REMOTE, 'utf8');
  if (!text.includes('ROTATE_STAGE=') || !text.includes('nginx -t') || !text.includes('systemctl reload nginx')) throw new Error('ROTATION_ASSET_INVALID');
  return REMOTE;
}

export async function rotateBasicAuth({ dryRun = false, store = createProductionCredentialStore('darwin'), sshExecutable = '/usr/bin/ssh', curlExecutable = '/usr/bin/curl' } = {}) {
  validateAssets();
  if (dryRun) return { result: 'DRY_RUN', host: BASIC_AUTH_HOST, username: BASIC_AUTH_USER, remoteAsset: REMOTE };
  const old = await store.get(BASIC_AUTH_KEY);
  const password = randomBytes(32).toString('base64url');
  const openssl = existsSync('/usr/bin/openssl') ? '/usr/bin/openssl' : '/opt/local/bin/openssl';
  const hashResult = await run(openssl, ['passwd', '-apr1', '-stdin'], `${password}\n`);
  const hash = hashResult.stdout.trim();
  if (hashResult.code !== 0 || !/^\$apr1\$[^$]{1,16}\$[A-Za-z0-9./]{20,}$/.test(hash)) throw new Error('HASH_DERIVATION_FAILED');
  await store.set(BASIC_AUTH_KEY, password);
  const id = `r${Date.now().toString(36)}${randomBytes(5).toString('hex')}`;
  const remote = readFileSync(REMOTE, 'utf8');
  const command = (action) => `sh -c ${JSON.stringify(remote)} -- ${id} ${BASIC_AUTH_HOST} ${BASIC_AUTH_USER} ${action}`;
  const response = await run(sshExecutable, ['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','awh-ready',command('rotate')], `${hash}\n`, 60000);
  let parsed;
  try { parsed = parseRotationOutput(response.stdout); } catch { parsed = { ROTATE_FAILED_AT: 'PRECHECK', ROTATE_FAILURE_CODE: 'OUTPUT_INVALID' }; }
  if (response.code !== 0 || parsed.ROTATE_RESULT !== 'PASS') {
    if (old === null) await store.delete(BASIC_AUTH_KEY); else await store.set(BASIC_AUTH_KEY, old);
    const error = new Error(parsed.ROTATE_FAILURE_CODE ? `ROTATION_FAILED:${parsed.ROTATE_FAILED_AT}:${parsed.ROTATE_FAILURE_CODE}` : 'ROTATION_FAILED');
    error.cause = parsed;
    throw error;
  }
  const auth = await run(curlExecutable, ['--config','-'], `url = https://${BASIC_AUTH_HOST}/\nuser = ${BASIC_AUTH_USER}:${password}\nsilent\noutput = /dev/null\nwrite-out = %{http_code}\nmax-time = 15\n`, 30000);
  if (auth.code !== 0 || auth.stdout.trim() !== '200') {
    const rollback = await run(sshExecutable, ['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','awh-ready',command('rollback')], '', 60000);
    if (rollback.code !== 0 || !rollback.stdout.includes('ROLLBACK=PASS')) throw new Error('ROLLBACK_FAILED');
    if (old === null) await store.delete(BASIC_AUTH_KEY); else await store.set(BASIC_AUTH_KEY, old);
    throw new Error('AUTH_VERIFY_FAILED');
  }
  const cleanup = await run(sshExecutable, ['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','awh-ready',command('cleanup')], '', 30000);
  const cleanupState = cleanup.code === 0 && cleanup.stdout.includes('ROTATE_RESULT=CLEANUP') ? 'PASS' : 'PENDING_RETRY_SAFE';
  return { result: 'PASS', stage: parsed, publicCredentialVerify: 'PASS', cleanup: cleanupState, operatorDelivery: `security find-generic-password -a 'awh-device-token-v1:${BASIC_AUTH_KEY}' -s 'Art’s Workspace Hub' -w`, password, host: BASIC_AUTH_HOST, username: BASIC_AUTH_USER };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await rotateBasicAuth({ dryRun: process.argv.includes('--dry-run') });
  process.stdout.write(`${JSON.stringify({ ...result, ...(result.password ? { password: '[KEYCHAIN_ONLY]' } : {}) })}\n`);
}
