import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const manifestScript = resolve('scripts/create-web-release-manifest.mjs');

function baseManifest() {
  const macHash = '1'.repeat(64);
  const winHash = '2'.repeat(64);
  const sumHash = '3'.repeat(64);
  const armHash = '4'.repeat(64);
  return {
    schemaVersion: 1,
    releaseId: 'm21-base',
    sourceSha: 'a'.repeat(40),
    sourceState: 'COMMITTED',
    product: 'AWH Control Panel',
    desktopReleases: [
      { path: 'downloads/AWH-macOS-arm64.zip', sourceSha: 'e'.repeat(40), productVersion: '1.0.0-rc.1', packageSha256: armHash, sizeBytes: 333, packageVerification: 'VERIFIED' },
      { path: 'downloads/AWH-macOS-x64.zip', sourceSha: 'b'.repeat(40), productVersion: '1.0.0-rc.1', packageSha256: macHash, sizeBytes: 111, packageVerification: 'VERIFIED' },
      { path: 'downloads/AWH-Windows-x64.zip', sourceSha: 'c'.repeat(40), productVersion: '1.0.0-rc.1', packageSha256: winHash, sizeBytes: 222, packageVerification: 'VERIFIED' },
    ],
    files: [
      { path: 'downloads/AWH-macOS-arm64.zip', sha256: armHash, sizeBytes: 333 },
      { path: 'downloads/AWH-macOS-x64.zip', sha256: macHash, sizeBytes: 111 },
      { path: 'downloads/AWH-Windows-x64.zip', sha256: winHash, sizeBytes: 222 },
      { path: 'downloads/SHA256SUMS.txt', sha256: sumHash, sizeBytes: 170 },
    ],
  };
}

async function fixtureRoot(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(root, 'scripts'), { recursive: true });
  await mkdir(join(root, 'dist-web'), { recursive: true });
  await writeFile(join(root, 'scripts', 'web-release-files.json'), JSON.stringify({ required: ['index.html', 'web-config.json'] }));
  await writeFile(join(root, 'dist-web', 'index.html'), '<!doctype html>');
  await writeFile(join(root, 'dist-web', 'web-config.json'), JSON.stringify({ releaseId: 'm21-next', sourceSha: 'd'.repeat(40), sourceState: 'COMMITTED', mode: 'CONTROL' }));
  return root;
}

test('web release can carry verified production desktop lineage without local ZIPs', async () => {
  const root = await fixtureRoot('awh-desktop-reuse-');
  try {
    const base = join(root, 'base-release.json');
    await writeFile(base, JSON.stringify(baseManifest()));
    await execFileAsync(process.execPath, [manifestScript, 'dist-web'], {
      cwd: root,
      env: { ...process.env, AWH_RELEASE_ID: 'm21-next', AWH_DESKTOP_RELEASE_REUSE: '1', AWH_DESKTOP_RELEASE_BASE_MANIFEST: base },
    });
    const manifest = JSON.parse(await readFile(join(root, 'dist-web', 'release.json'), 'utf8'));
    assert.equal(manifest.desktopReleases.length, 3);
    const intel = manifest.desktopReleases.find((x: any) => x.path === 'downloads/AWH-macOS-x64.zip');
    assert.equal(intel.packageVerification, 'VERIFIED');
    assert.equal(intel.sourceSha, 'b'.repeat(40));
    assert.equal(manifest.files.find((x: any) => x.path === 'downloads/AWH-Windows-x64.zip').sha256, '2'.repeat(64));
    await assert.rejects(readFile(join(root, 'dist-web', 'downloads', 'AWH-Windows-x64.zip')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('verified macOS arm64 overlay can join reused Intel and Windows lineage on first publication', async () => {
  const root = await fixtureRoot('awh-desktop-arm64-overlay-');
  try {
    const baseData = baseManifest();
    baseData.desktopReleases = baseData.desktopReleases.filter((x: any) => x.path !== 'downloads/AWH-macOS-arm64.zip');
    baseData.files = baseData.files.filter((x: any) => x.path !== 'downloads/AWH-macOS-arm64.zip');
    const base = join(root, 'base-release.json');
    await writeFile(base, JSON.stringify(baseData));
    await mkdir(join(root, 'dist-web', 'downloads'), { recursive: true });
    const bytes = Buffer.from('verified arm64 overlay fixture\n');
    const armPath = join(root, 'dist-web', 'downloads', 'AWH-macOS-arm64.zip');
    const armHash = createHash('sha256').update(bytes).digest('hex');
    await writeFile(armPath, bytes);
    await writeFile(join(root, 'dist-web', 'downloads', 'AWH-macOS-arm64.release.json'), JSON.stringify({
      kind: 'AWH_DESKTOP_RELEASE_EVIDENCE', authority: 'CI_PACKAGE_EVIDENCE_ONLY', packageVerification: 'VERIFIED',
      sourceSha: 'f'.repeat(40), packageSha256: armHash, sizeBytes: bytes.length,
      downloadKey: 'AWH-macOS-arm64.zip', productVersion: '1.0.0-rc.1',
    }));
    await execFileAsync(process.execPath, [resolve('scripts/release/create-desktop-overlay-sums.mjs'), base, armPath, join(root, 'dist-web', 'downloads', 'SHA256SUMS.txt')], { cwd: process.cwd() });
    await execFileAsync(process.execPath, [manifestScript, 'dist-web'], {
      cwd: root, env: { ...process.env, AWH_RELEASE_ID: 'm21-next', AWH_DESKTOP_RELEASE_REUSE: '1', AWH_DESKTOP_RELEASE_BASE_MANIFEST: base },
    });
    const manifest = JSON.parse(await readFile(join(root, 'dist-web', 'release.json'), 'utf8'));
    const arm = manifest.desktopReleases.find((x: any) => x.path === 'downloads/AWH-macOS-arm64.zip');
    assert.equal(manifest.desktopReleases.length, 3);
    assert.equal(arm.sourceSha, 'f'.repeat(40));
    assert.equal(arm.packageSha256, armHash);
    const sums = await readFile(join(root, 'dist-web', 'downloads', 'SHA256SUMS.txt'), 'utf8');
    assert.match(sums, new RegExp(armHash + '  AWH-macOS-arm64\.zip'));
    assert.match(sums, /1{64}  AWH-macOS-x64\.zip/);
    assert.match(sums, /2{64}  AWH-Windows-x64\.zip/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('local macOS Beta DMG can overlay reused internal desktop lineage', async () => {
  const root = await fixtureRoot('awh-desktop-beta-installer-');
  try {
    const base = join(root, 'base-release.json');
    await writeFile(base, JSON.stringify(baseManifest()));
    await mkdir(join(root, 'dist-web', 'downloads'), { recursive: true });
    const bytes = Buffer.from('beta dmg fixture\n');
    const path = join(root, 'dist-web', 'downloads', 'AWH-Agent-Beta-macOS-arm64.dmg');
    const hash = createHash('sha256').update(bytes).digest('hex');
    await writeFile(path, bytes);
    await writeFile(join(root, 'dist-web', 'downloads', 'AWH-Agent-Beta-macOS-arm64.installer.json'), JSON.stringify({
      schemaVersion: 1,
      kind: 'AWH_DESKTOP_INSTALLER_EVIDENCE',
      authority: 'CI_PACKAGE_EVIDENCE_ONLY',
      channel: 'beta',
      platform: 'darwin',
      architecture: 'arm64',
      productVersion: '1.0.0-rc.1',
      sourceSha: 'f'.repeat(40),
      packageSha256: hash,
      sizeBytes: bytes.length,
      downloadKey: 'AWH-Agent-Beta-macOS-arm64.dmg',
      packageVerification: 'VERIFIED',
      platformTrust: 'ADHOC_BETA',
      notarization: 'NOT_NOTARIZED',
    }));
    await execFileAsync(process.execPath, [manifestScript, 'dist-web'], {
      cwd: root,
      env: { ...process.env, AWH_RELEASE_ID: 'm21-next', AWH_DESKTOP_RELEASE_REUSE: '1', AWH_DESKTOP_RELEASE_BASE_MANIFEST: base },
    });
    const manifest = JSON.parse(await readFile(join(root, 'dist-web', 'release.json'), 'utf8'));
    assert.equal(manifest.desktopReleases.length, 3);
    assert.equal(manifest.desktopInstallers.length, 1);
    assert.equal(manifest.desktopInstallers[0].path, 'downloads/AWH-Agent-Beta-macOS-arm64.dmg');
    assert.equal(manifest.desktopInstallers[0].channel, 'beta');
    assert.equal(manifest.desktopInstallers[0].platformTrust, 'ADHOC_BETA');
    assert.equal(manifest.files.find((x: any) => x.path.endsWith('.dmg')).sha256, hash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('remote desktop reuse rejects inconsistent production lineage', async () => {
  const root = await fixtureRoot('awh-desktop-reuse-invalid-');
  try {
    const broken = baseManifest();
    broken.desktopReleases[0].packageSha256 = 'f'.repeat(64);
    const base = join(root, 'base-release.json');
    await writeFile(base, JSON.stringify(broken));
    await assert.rejects(
      execFileAsync(process.execPath, [manifestScript, 'dist-web'], {
        cwd: root,
        env: { ...process.env, AWH_RELEASE_ID: 'm21-next', AWH_DESKTOP_RELEASE_REUSE: '1', AWH_DESKTOP_RELEASE_BASE_MANIFEST: base },
      }),
      /Verified desktop package provenance is invalid/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('guarded deploy exposes explicit remote artifact reuse without bypassing rehydration', async () => {
  const deploy = await readFile('deploy/awh-control-plane/deploy-control-plane.sh', 'utf8');
  const remote = await readFile('deploy/awh-control-plane/remote-deploy-control-plane.sh', 'utf8');
  assert.match(deploy, /AWH_REUSE_REMOTE_DESKTOP_ARTIFACTS/);
  assert.match(deploy, /sudo -n cat \/var\/www\/awh-web\/current\/release\.json/);
  assert.match(deploy, /AWH_DESKTOP_RELEASE_REUSE=1/);
  assert.match(deploy, /DESKTOP_ARTIFACT_REUSE=verified-remote-manifest/);
  assert.match(deploy, /AWH_DESKTOP_ARM64_OVERLAY/);
  assert.match(deploy, /DESKTOP_ARTIFACT_OVERLAY=AWH-macOS-arm64\.zip/);
  assert.match(remote, /rehydrate_desktop_artifacts/);
  assert.match(remote, /AWH-macOS-arm64\.zip/);
  assert.match(remote, /sudo test -f "\$object"/);
  assert.match(remote, /actual=\$\(sudo sha256sum "\$object"/);
});
