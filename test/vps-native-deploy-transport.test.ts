import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';

const execFile = promisify(execFileCallback);
const ROOT = process.cwd();

test('VPS-native control deployment adds a root-only local transport without removing SSH transport', async () => {
  const [deploy, preflight] = await Promise.all([
    readFile('deploy/awh-control-plane/deploy-control-plane.sh', 'utf8'),
    readFile('deploy/awh-enrollment/preflight-production.sh', 'utf8'),
  ]);
  assert.match(deploy, /AWH_DEPLOY_TRANSPORT:-ssh/);
  assert.match(preflight, /AWH_DEPLOY_TRANSPORT/);
  assert.match(deploy, /ssh\|local/);
  assert.match(preflight, /ssh\|local/);
  assert.match(deploy, /Local production deployment requires root authority/);
  assert.match(preflight, /Local production preflight requires root authority/);
  assert.match(deploy, /cp "\$BUNDLE" "\$REMOTE_STAGE"/);
  assert.match(deploy, /systemd-run --unit="\$REMOTE_UNIT"/);
  assert.match(deploy, /scp -o BatchMode=yes -o StrictHostKeyChecking=yes/);
  assert.match(deploy, /ssh -o BatchMode=yes/);
  assert.doesNotMatch(deploy, /AWH_DEPLOY_TRANSPORT:-local/);
});

test('non-root callers cannot select the local production transport', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const { stdout: head } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: ROOT });
  await assert.rejects(
    execFile('sh', ['deploy/awh-control-plane/deploy-control-plane.sh', '--dry-run', '--self-service'], {
      cwd: ROOT,
      env: { ...process.env, AWH_DEPLOY_TRANSPORT: 'local', AWH_DEPLOY_TARGET: 'local', AWH_RELEASE_COMMIT: head.trim(), AWH_HUB_HOSTNAME: 'awh.example' },
    }),
    (error: any) => {
      assert.match(String(error?.stderr ?? ''), /Local production deployment requires root authority/);
      return true;
    },
  );
});
