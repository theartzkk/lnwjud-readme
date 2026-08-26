import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PRODUCT, normalizeUpdateChannel } from '../src/product.js';
import { compareReleaseVersions, DesktopUpdatePolicyError, updateManifestPath, validateDesktopUpdateManifest } from '../src/desktop-update-policy.js';
import { compatibilityEnv, DEFAULT_AWH_HUB_API_BASE, loadConfig } from '../src/config.js';
import { saveStoredSettings } from '../src/settings.js';

test('AWH product identity is centralized and evergreen desktop identifiers are stable', () => {
  assert.deepEqual(PRODUCT, {
    productName: 'Art’s Workspace Hub',
    shortName: 'AWH',
    desktopName: 'AWH Desktop',
    tagline: 'Your Projects. One Workspace. Anywhere.',
    productId: 'awh',
    desktopBundleId: 'com.artworkspacehub.awh',
    windowsPackageId: 'AWH',
    evergreenDesktop: true,
    defaultUpdateChannel: 'stable',
    updateChannels: ['stable', 'preview'],
    legacyCodename: 'Art Agent',
    legacyPackageId: 'art-agent',
  });
  assert.equal(normalizeUpdateChannel('stable'), 'stable');
  assert.equal(normalizeUpdateChannel('preview'), 'preview');
  assert.equal(normalizeUpdateChannel('development'), 'stable');
});

test('desktop packager keeps one OS identity for future in-place updates', () => {
  const forge = readFileSync(join(process.cwd(), 'forge.config.cjs'), 'utf8');
  assert.match(forge, /DESKTOP_BUNDLE_ID = 'com\.artworkspacehub\.awh'/);
  assert.match(forge, /appBundleId: DESKTOP_BUNDLE_ID/);
  assert.match(forge, /name:\s*'AWH'/);
  assert.doesNotMatch(forge, /AWHPreview|AWHStable|com\.artworkspacehub\.preview/);
});

test('desktop update manifest is identity-bound, hash-bound and upgrade-only', () => {
  const manifest = {
    schemaVersion: 1,
    productId: 'awh',
    desktopBundleId: 'com.artworkspacehub.awh',
    windowsPackageId: 'AWH',
    channel: 'stable',
    version: '1.1.0',
    sha256: 'a'.repeat(64),
    bytes: 42_000_000,
    publishedAt: '2026-08-26T12:00:00Z',
    downloadPath: '/desktop-updates/v1/stable/win32/x64/AWHSetup.exe',
    minHubApiMajor: 1,
  };
  assert.equal(validateDesktopUpdateManifest(manifest, '1.0.0', 'stable').version, '1.1.0');
  assert.equal(compareReleaseVersions('1.0.0', '1.0.0-rc.1'), 1);
  assert.equal(updateManifestPath('preview', 'darwin', 'arm64'), '/desktop-updates/v1/preview/darwin/arm64/manifest.json');

  assert.throws(() => validateDesktopUpdateManifest({ ...manifest, desktopBundleId: 'com.attacker.app' }, '1.0.0', 'stable'), (error) => error instanceof DesktopUpdatePolicyError && error.code === 'UPDATE_IDENTITY_MISMATCH');
  assert.throws(() => validateDesktopUpdateManifest({ ...manifest, sha256: 'bad' }, '1.0.0', 'stable'), (error) => error instanceof DesktopUpdatePolicyError && error.code === 'UPDATE_CHECKSUM_INVALID');
  assert.throws(() => validateDesktopUpdateManifest({ ...manifest, version: '0.9.0' }, '1.0.0', 'stable'), (error) => error instanceof DesktopUpdatePolicyError && error.code === 'UPDATE_NOT_NEWER');
  assert.throws(() => validateDesktopUpdateManifest({ ...manifest, downloadPath: '/desktop-updates/v1/stable/../../evil.exe' }, '1.0.0', 'stable'), (error) => error instanceof DesktopUpdatePolicyError && error.code === 'UPDATE_PATH_INVALID');
  assert.throws(() => validateDesktopUpdateManifest({ ...manifest, channel: 'preview' }, '1.0.0', 'stable'), (error) => error instanceof DesktopUpdatePolicyError && error.code === 'UPDATE_CHANNEL_MISMATCH');
});

test('AWH environment aliases take precedence over ART_AGENT compatibility values', () => {
  const originalAwh = process.env.AWH_WORKSPACE;
  const originalLegacy = process.env.ART_AGENT_WORKSPACE;
  try {
    process.env.AWH_WORKSPACE = '/tmp/awh-workspace';
    process.env.ART_AGENT_WORKSPACE = '/tmp/legacy-workspace';
    assert.equal(compatibilityEnv('workspace'), '/tmp/awh-workspace');
    delete process.env.AWH_WORKSPACE;
    assert.equal(compatibilityEnv('workspace'), '/tmp/legacy-workspace');
  } finally {
    if (originalAwh === undefined) delete process.env.AWH_WORKSPACE;
    else process.env.AWH_WORKSPACE = originalAwh;
    if (originalLegacy === undefined) delete process.env.ART_AGENT_WORKSPACE;
    else process.env.ART_AGENT_WORKSPACE = originalLegacy;
  }
});

test('Hub API base uses the central AWH-first compatibility resolver', () => {
  const originalAwh = process.env.AWH_HUB_API_BASE;
  const originalLegacy = process.env.ART_AGENT_HUB_API_BASE;
  try {
    process.env.AWH_HUB_API_BASE = 'https://hub.example/api/v1';
    process.env.ART_AGENT_HUB_API_BASE = 'https://legacy.example/api/v1';
    assert.equal(compatibilityEnv('hubApiBase'), 'https://hub.example/api/v1');
    delete process.env.AWH_HUB_API_BASE;
    assert.equal(compatibilityEnv('hubApiBase'), 'https://legacy.example/api/v1');
  } finally {
    if (originalAwh === undefined) delete process.env.AWH_HUB_API_BASE;
    else process.env.AWH_HUB_API_BASE = originalAwh;
    if (originalLegacy === undefined) delete process.env.ART_AGENT_HUB_API_BASE;
    else process.env.ART_AGENT_HUB_API_BASE = originalLegacy;
  }
});

test('normal packaged runtime defaults to the ReadyIDC authority without a legacy Google setting', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'awh-ready-config-'));
  const keys = ['AWH_DATA_DIR', 'ART_AGENT_DATA_DIR', 'AWH_WORKSPACE', 'ART_AGENT_WORKSPACE', 'AWH_HUB_API_BASE', 'ART_AGENT_HUB_API_BASE'];
  const original = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.AWH_DATA_DIR = dataDir;
    process.env.AWH_WORKSPACE = dataDir;
    delete process.env.ART_AGENT_DATA_DIR;
    delete process.env.ART_AGENT_WORKSPACE;
    delete process.env.AWH_HUB_API_BASE;
    delete process.env.ART_AGENT_HUB_API_BASE;
    assert.equal(DEFAULT_AWH_HUB_API_BASE, 'https://157-85-108-142.sslip.io/api/v1');
    assert.equal(loadConfig().hubApiBase, DEFAULT_AWH_HUB_API_BASE);
    assert.doesNotMatch(loadConfig().hubApiBase, /136-66-217-63|127\.0\.0\.1|localhost/);
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('loadConfig applies AWH aliases before legacy values and stored defaults', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'awh-config-'));
  const keys = ['AWH_DATA_DIR', 'ART_AGENT_DATA_DIR', 'AWH_WORKSPACE', 'ART_AGENT_WORKSPACE', 'AWH_ALLOW_WRITE', 'ART_AGENT_ALLOW_WRITE'];
  const original = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.AWH_DATA_DIR = dataDir;
    process.env.ART_AGENT_DATA_DIR = join(dataDir, 'legacy');
    process.env.AWH_WORKSPACE = join(dataDir, 'awh-workspace');
    process.env.ART_AGENT_WORKSPACE = join(dataDir, 'legacy-workspace');
    process.env.AWH_ALLOW_WRITE = '1';
    process.env.ART_AGENT_ALLOW_WRITE = '0';
    const config = loadConfig();
    assert.equal(config.dataDir, dataDir);
    assert.equal(config.workspace, join(dataDir, 'awh-workspace'));
    assert.equal(config.allowWrite, true);
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('legacy approved execution resumes the enrolled control-plane worker after restart until explicitly paused', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'awh-worker-activation-'));
  const keys = ['AWH_DATA_DIR', 'ART_AGENT_DATA_DIR', 'AWH_ALLOW_EXEC', 'ART_AGENT_ALLOW_EXEC', 'AWH_CONTROL_PLANE_WORKER', 'ART_AGENT_CONTROL_PLANE_WORKER'];
  const original = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.AWH_DATA_DIR = dataDir;
    for (const key of keys.slice(1)) delete process.env[key];
    await saveStoredSettings(dataDir, { allowExec: true, allowWrite: true, allowCodex: true });
    assert.equal(loadConfig().controlPlaneWorker, true, 'legacy approved execution activates the worker after restart');

    await saveStoredSettings(dataDir, { allowExec: true, allowWrite: true, allowCodex: true, controlPlaneWorker: false });
    assert.equal(loadConfig().controlPlaneWorker, false, 'an explicit local pause overrides legacy migration intent');

    process.env.AWH_CONTROL_PLANE_WORKER = '1';
    assert.equal(loadConfig().controlPlaneWorker, true, 'the explicit AWH environment override remains authoritative');
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});
