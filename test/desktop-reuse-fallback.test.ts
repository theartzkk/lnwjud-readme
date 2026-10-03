import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { consumeDesktopReuseFallbacks, prepareDesktopReuseFallbacks } from '../scripts/release/desktop-reuse-fallback.mjs';

const releaseSha = 'a'.repeat(40);
const path = 'downloads/AWH-Windows-x64.zip';

async function fixture(directoryId = 'awh-fixture-release') {
  const root = await mkdtemp(join(tmpdir(), 'awh-desktop-fallback-'));
  const webRoot = join(root, 'web');
  const releaseId = 'awh-fixture-release';
  const releaseRoot = join(webRoot, 'releases', directoryId);
  const store = join(webRoot, 'desktop-artifacts');
  const input = join(root, 'output');
  const markerRoot = join(root, 'markers');
  await mkdir(join(releaseRoot, 'downloads'), { recursive: true });
  await mkdir(store, { recursive: true });
  await mkdir(input, { recursive: true });
  const bytes = Buffer.from('verified desktop fixture\n');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const baseManifest = {
    schemaVersion: 1,
    releaseId,
    sourceSha: 'b'.repeat(40),
    sourceState: 'COMMITTED',
    webBundleSha256: 'c'.repeat(64),
    product: 'AWH Control Panel',
    files: [{ path, sha256, sizeBytes: bytes.length }],
    desktopReleases: [],
  };
  await writeFile(join(releaseRoot, path), bytes);
  await writeFile(join(releaseRoot, 'release.json'), JSON.stringify(baseManifest));
  await symlink(releaseRoot, join(webRoot, 'current'), 'dir');
  return { root, webRoot, releaseRoot, store, input, markerRoot, bytes, sha256, baseManifest };
}

test('missing desktop artifact store object is materialized from the exact current verified release', async () => {
  const f = await fixture();
  try {
    const fallback = await prepareDesktopReuseFallbacks({ input: f.input, baseManifest: f.baseManifest, releaseSha, paths: [path], webRoot: f.webRoot, markerRoot: f.markerRoot });
    assert.deepEqual(fallback, [path]);
    assert.deepEqual(await readFile(join(f.input, path)), f.bytes);
    await assert.rejects(readFile(join(f.store, `${f.sha256}-${basename(path)}`)), (error: any) => error?.code === 'ENOENT');
    assert.deepEqual(await consumeDesktopReuseFallbacks({ releaseSha, markerRoot: f.markerRoot }), [path]);
    assert.deepEqual(await consumeDesktopReuseFallbacks({ releaseSha, markerRoot: f.markerRoot }), []);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('current release directory may differ from manifest releaseId when verified identity still matches', async () => {
  const f = await fixture('awh-fixture-release-r2');
  try {
    const fallback = await prepareDesktopReuseFallbacks({ input: f.input, baseManifest: f.baseManifest, releaseSha, paths: [path], webRoot: f.webRoot, markerRoot: f.markerRoot });
    assert.deepEqual(fallback, [path]);
    assert.deepEqual(await readFile(join(f.input, path)), f.bytes);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('desktop fallback fails closed when current manifest identity changes', async () => {
  const f = await fixture();
  try {
    const otherRoot = join(f.webRoot, 'releases', 'awh-other-release');
    await mkdir(join(otherRoot, 'downloads'), { recursive: true });
    await writeFile(join(otherRoot, path), f.bytes);
    await writeFile(join(otherRoot, 'release.json'), JSON.stringify({ ...f.baseManifest, releaseId: 'awh-other-release', sourceSha: 'd'.repeat(40) }));
    await rm(join(f.webRoot, 'current'));
    await symlink(otherRoot, join(f.webRoot, 'current'), 'dir');
    await assert.rejects(
      prepareDesktopReuseFallbacks({ input: f.input, baseManifest: f.baseManifest, releaseSha, paths: [path], webRoot: f.webRoot, markerRoot: f.markerRoot }),
      /Verified desktop recovery release is no longer current/,
    );
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('desktop fallback fails closed when current web bundle identity changes', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.releaseRoot, 'release.json'), JSON.stringify({ ...f.baseManifest, webBundleSha256: 'e'.repeat(64) }));
    await assert.rejects(
      prepareDesktopReuseFallbacks({ input: f.input, baseManifest: f.baseManifest, releaseSha, paths: [path], webRoot: f.webRoot, markerRoot: f.markerRoot }),
      /Verified desktop recovery release is no longer current/,
    );
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('verified desktop artifact store object keeps remote reuse zero-copy', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.store, `${f.sha256}-${basename(path)}`), f.bytes);
    const fallback = await prepareDesktopReuseFallbacks({ input: f.input, baseManifest: f.baseManifest, releaseSha, paths: [path], webRoot: f.webRoot, markerRoot: f.markerRoot });
    assert.deepEqual(fallback, []);
    await assert.rejects(readFile(join(f.input, path)), (error: any) => error?.code === 'ENOENT');
    assert.deepEqual(await consumeDesktopReuseFallbacks({ releaseSha, markerRoot: f.markerRoot }), []);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('corrupt desktop artifact store object fails closed before Production deployment', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.store, `${f.sha256}-${basename(path)}`), Buffer.from('corrupt\n'));
    await assert.rejects(
      prepareDesktopReuseFallbacks({ input: f.input, baseManifest: f.baseManifest, releaseSha, paths: [path], webRoot: f.webRoot, markerRoot: f.markerRoot }),
      /Desktop artifact store object is inconsistent/,
    );
    assert.deepEqual(await consumeDesktopReuseFallbacks({ releaseSha, markerRoot: f.markerRoot }), []);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
