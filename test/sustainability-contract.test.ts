import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { DEFAULT_AWH_HUB_API_BASE } from '../src/config.js';
import { PRODUCT } from '../src/product.js';
import { DESKTOP_UPDATE_FOUNDATION, updateIsApplicable, validateDesktopUpdateManifest } from '../src/desktop-update-policy.js';

const ROOT = process.cwd();

test('AWH sustainability contract locks durable product and authority identity', async () => {
  const contract = JSON.parse(await readFile(join(ROOT, 'config/awh-product-contract.json'), 'utf8'));
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.product.id, 'awh');
  assert.equal(contract.product.name, PRODUCT.productName);
  assert.equal(contract.product.desktopName, PRODUCT.desktopName);
  assert.equal(contract.product.desktopBundleId, 'com.artworkspacehub.awh');
  assert.equal(contract.product.windowsPackageId, 'AWH');
  assert.equal(contract.authority.defaultApiBase, DEFAULT_AWH_HUB_API_BASE);
  assert.equal(contract.authority.defaultApiBaseStatus, 'PROVISIONAL_IP_BOUND');
  assert.equal(contract.authority.databaseEngine, 'SQLite');
  assert.equal(contract.authority.apiMajor, 'v1');
  assert.equal(contract.data.principle, 'Everything replaceable except identity and data');
});

test('desktop release contract is install-once ready without pretending updater activation', async () => {
  const contract = JSON.parse(await readFile(join(ROOT, 'config/awh-product-contract.json'), 'utf8'));
  assert.deepEqual(contract.release.channels, ['stable', 'preview']);
  assert.equal(contract.release.defaultChannel, 'stable');
  assert.equal(contract.release.evergreenDesktopRequired, true);
  assert.equal(contract.release.updaterStatus, 'FOUNDATION_LOCKED_NOT_ACTIVATED');
  assert.equal(contract.release.desktopCompatibility, 'current-and-previous-minor');
  assert.equal(DESKTOP_UPDATE_FOUNDATION.status, contract.release.updaterStatus);
  for (const gate of ['ci', 'hub-test', 'package-runtime', 'backup-verified', 'migration-plan', 'rollback-plan']) {
    assert.ok(contract.release.stableRequires.includes(gate), `missing stable release gate ${gate}`);
  }
});

test('desktop packaging preserves one stable app identity for future in-place updates', async () => {
  const forge = await readFile(join(ROOT, 'forge.config.cjs'), 'utf8');
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.productName, 'Art’s Workspace Hub');
  assert.match(forge, /appBundleId:\s*'com\.artworkspacehub\.awh'/);
  assert.match(forge, /name:\s*'AWH'/);
  assert.match(forge, /setupExe:\s*'AWHSetup\.exe'/);
  assert.doesNotMatch(forge, /com\.[\w.-]*art-agent/i);
});

test('update manifest contract accepts only bounded HTTPS releases and compatible versions', () => {
  const manifest = validateDesktopUpdateManifest({
    schemaVersion: 1,
    channel: 'stable',
    version: '1.1.0',
    gitSha: 'a'.repeat(40),
    publishedAt: '2026-08-26T12:00:00Z',
    url: 'https://updates.example.invalid/AWH-1.1.0.nupkg',
    sha256: 'b'.repeat(64),
    bytes: 1024,
    minimumDesktopVersion: '1.0.0',
  });
  assert.equal(updateIsApplicable('1.0.0', manifest, 'stable'), true);
  assert.equal(updateIsApplicable('1.0.0', manifest, 'preview'), false);
  assert.equal(updateIsApplicable('1.1.0', manifest, 'stable'), false);
  assert.throws(() => validateDesktopUpdateManifest({ ...manifest, url: 'http://updates.example.invalid/AWH.nupkg' }), /UPDATE_MANIFEST_INVALID/);
  assert.throws(() => validateDesktopUpdateManifest({ ...manifest, sha256: 'short' }), /UPDATE_MANIFEST_INVALID/);
});

test('sustainability contract never embeds credential material', async () => {
  const text = await readFile(join(ROOT, 'config/awh-product-contract.json'), 'utf8');
  assert.doesNotMatch(text, /api[_-]?key|password|bearer|private[_-]?key|refresh[_-]?token/i);
});


test('automatic backup scheduler reuses the canonical verified backup authority', async () => {
  const service = await readFile(join(ROOT, 'deploy/systemd/awh-backup.service'), 'utf8');
  const timer = await readFile(join(ROOT, 'deploy/systemd/awh-backup.timer'), 'utf8');
  const backupSource = await readFile(join(ROOT, 'hub/src/HubBackupService.php'), 'utf8');
  assert.match(backupSource, /PDO::SQLITE_ATTR_OPEN_FLAGS\s*=>\s*PDO::SQLITE_OPEN_READONLY/);
  const wrapper = await readFile(join(ROOT, 'hub/bin/scheduled-backup.php'), 'utf8');
  const deploy = await readFile(join(ROOT, 'deploy/awh-control-plane/deploy-control-plane.sh'), 'utf8');
  assert.match(service, /ExecStart=\/usr\/bin\/php -d pcre\.jit=0 \/opt\/awh-hub\/control-plane-current\/hub\/bin\/scheduled-backup\.php/);
  assert.match(service, /AWH_HUB_BACKUP_READ_GROUP=awh-hub/);
  assert.match(service, /PrivateNetwork=true/);
  assert.match(service, /ProtectSystem=strict/);
  assert.match(service, /ReadOnlyPaths=\/opt\/awh-hub \/var\/lib\/awh-hub\/awh\.sqlite/);
  assert.match(service, /ReadWritePaths=\/var\/backups\/awh-hub \/var\/lib\/awh-hub/);
  assert.match(service, /ReadWritePaths=\/var\/backups\/awh-hub/);
  assert.match(wrapper, /HubBackupService::create/);
  assert.match(wrapper, /chgrp\(\$path, \$readGroup\)/);
  assert.match(wrapper, /chmod\(\$path, 0640\)/);
  assert.match(wrapper, /HubBackupService::verify/);
  assert.doesNotMatch(`${service}\n${wrapper}`, /DELETE|rm\s|find\s.*-delete/i);
  assert.match(deploy, /hub\/bin\/scheduled-backup\.php/);
  assert.match(deploy, /deploy\/systemd\/awh-backup\.service/);
  assert.match(deploy, /deploy\/systemd\/awh-backup\.timer/);
  assert.match(timer, /OnCalendar=\*-\*-\* 03:30:00/);
  assert.match(timer, /Persistent=true/);
  assert.match(timer, /RandomizedDelaySec=10m/);
});


test('backup activation is exact-revision, approval-gated, and rollback-capable', async () => {
  const local = await readFile(join(ROOT, 'deploy/awh-backup/activate-backup.sh'), 'utf8');
  const remote = await readFile(join(ROOT, 'deploy/awh-backup/remote-activate-backup.sh'), 'utf8');
  assert.match(local, /AWH_RELEASE_COMMIT/);
  assert.match(local, /DIRTY_TREE/);
  assert.match(local, /--approve/);
  assert.match(local, /StrictHostKeyChecking=yes/);
  assert.match(remote, /systemd-analyze verify/);
  assert.match(remote, /backup-activate-\$SHORT/);
  assert.match(remote, /systemctl enable --now awh-backup\.timer/);
  assert.match(remote, /systemctl start awh-backup\.service/);
  assert.match(remote, /sudo -u awh-hub .*backup\.php.* verify/);
  assert.match(remote, /AWH_BACKUP_ROLLBACK=PASS/);
  assert.doesNotMatch(`${local}\n${remote}`, /StrictHostKeyChecking=no|password=|token=|secret=/i);
});
