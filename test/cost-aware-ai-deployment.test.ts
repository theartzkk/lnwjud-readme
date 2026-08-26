import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const deploy = join(root, 'deploy/awh-control-plane/deploy-control-plane.sh');
const remote = join(root, 'deploy/awh-control-plane/remote-deploy-control-plane.sh');

test('M14 Cost-Aware AI is additive and rollback-safe', async () => {
  const release = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const result = await execFileAsync('/bin/sh', [deploy, '--dry-run', '--owner-auth', '--cost-aware-ai'], {
    cwd: root,
    env: { ...process.env, AWH_SOURCE_ROOT: root, AWH_RELEASE_COMMIT: release, AWH_HUB_HOSTNAME: 'awh.example' },
  });
  assert.match(result.stdout, /^M14_DRY_RUN=PASS$/m);
  assert.match(result.stdout, new RegExp(`^M14_RELEASE=${release}$`, 'm'));
  assert.match(result.stdout, /verify-v13-or-v14-authority/);
  assert.match(result.stdout, /migrate-013-only-from-v13/);
  assert.match(result.stdout, /restore-exact-db-baseline/);
  assert.match(result.stdout, /M14_PRODUCTION_ACTIVATION_REQUIRES_APPROVAL/);
  const [local, remoteSource, pricing, migration, nativeAgent, webHtml, webApp] = await Promise.all([
    readFile(deploy, 'utf8'),
    readFile(remote, 'utf8'),
    readFile(join(root, 'hub/src/HubProviderPricingService.php'), 'utf8'),
    readFile(join(root, 'hub/src/HubCostAwareAiMigration.php'), 'utf8'),
    readFile(join(root, 'hub/src/HubNativeAgentService.php'), 'utf8'),
    readFile(join(root, 'web/index.html'), 'utf8'),
    readFile(join(root, 'web/app.js'), 'utf8'),
  ]);
  assert.match(local, /--cost-aware-ai/);
  assert.match(local, /COST_AWARE_AI_ROUTE/);
  assert.match(remoteSource, /COST_AWARE_AI=\$\{24\}/);
  assert.match(remoteSource, /case "\$M14_START_VERSION" in 13\|14/);
  assert.match(remoteSource, /COST_AWARE_MIGRATION_FIRST/);
  assert.match(remoteSource, /COST_AWARE_MIGRATION_IDEMPOTENT/);
  assert.match(remoteSource, /COST_AWARE_MIGRATION_VERIFIED/);
  assert.match(remoteSource, /COST_AWARE_AI_ROUTE/);
  assert.match(remoteSource, /NATIVE_EXECUTOR_QUIESCED/);
  assert.match(remoteSource, /m14-cost-aware-ai/);
  assert.match(pricing, /cacheWrite/);
  assert.match(pricing, /longContext/);
  assert.match(migration, /gpt-5\.6-luna/);
  assert.match(migration, /gpt-5\.6-terra/);
  assert.match(migration, /gpt-5\.6-sol/);
  assert.match(nativeAgent, /routingStrategy/);
  assert.match(nativeAgent, /pricingMode/);
  assert.match(webHtml, /ประหยัดที่สุด/);
  assert.match(webHtml, /สมดุล/);
  assert.match(webHtml, /เน้นคุณภาพ/);
  assert.doesNotMatch(webHtml, /ต้นทุน input ต่อ 1 ล้าน token/);
  assert.match(webApp, /pricingMode: 'CATALOG'/);
  assert.match(webApp, /serviceTier: 'DEFAULT'/);
  assert.doesNotMatch(`${local}\n${remoteSource}\n${migration}\n${pricing}`, /(?:BEGIN [A-Z ]+PRIVATE KEY|Authorization: Bearer sk-[A-Za-z0-9_-]{20,})/i);
});

test('M14 deployment scripts remain valid POSIX shell', async () => {
  await execFileAsync('/bin/sh', ['-n', deploy]);
  await execFileAsync('/bin/sh', ['-n', remote]);
});
test('release build lease serializes concurrent M13 and M14 web artifacts', async () => {
  const m13Release = 'abababababababababababababababababababab';
  const m14Release = 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd';
  const common = { ...process.env, AWH_SOURCE_ROOT: root, AWH_HUB_HOSTNAME: 'awh.example' };
  const [m13, m14] = await Promise.all([
    execFileAsync('/bin/sh', [deploy, '--dry-run', '--owner-auth', '--anywhere-execution'], {
      cwd: root,
      env: { ...common, AWH_RELEASE_COMMIT: m13Release },
    }),
    execFileAsync('/bin/sh', [deploy, '--dry-run', '--owner-auth', '--cost-aware-ai'], {
      cwd: root,
      env: { ...common, AWH_RELEASE_COMMIT: m14Release },
    }),
  ]);
  assert.match(m13.stdout, /^M13_DRY_RUN=PASS$/m);
  assert.match(m13.stdout, new RegExp(`^M13_RELEASE=${m13Release}$`, 'm'));
  assert.match(m14.stdout, /^M14_DRY_RUN=PASS$/m);
  assert.match(m14.stdout, new RegExp(`^M14_RELEASE=${m14Release}$`, 'm'));

  const local = await readFile(deploy, 'utf8');
  assert.match(local, /RELEASE_BUILD_LOCK=/);
  assert.match(local, /Another AWH release build still holds the build lease/);
});
