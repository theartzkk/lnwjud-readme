#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const input = resolve(root, process.argv[2] ?? 'dist-web');
const output = resolve(root, process.argv[3] ?? join(input, 'release.json'));
// Required runtime assets are owned by one shared release contract.
const releaseContract = JSON.parse(await readFile(join(root, 'scripts', 'web-release-files.json'), 'utf8'));
const files = releaseContract.required;
if (!Array.isArray(files) || files.some((name) => typeof name !== 'string' || !name || name.includes('..') || name.startsWith('/'))) throw new Error('AWH web release file contract is invalid');
const optionalFiles = ['downloads/AWH-macOS-x64.zip', 'downloads/AWH-Windows-x64.zip', 'downloads/SHA256SUMS.txt'];
const config = JSON.parse(await readFile(join(input, 'web-config.json'), 'utf8'));
const releaseId = config.releaseId;
if (!/^[A-Za-z0-9._-]{1,80}$/.test(releaseId ?? '') || (process.env.AWH_RELEASE_ID && process.env.AWH_RELEASE_ID !== releaseId)) throw new Error('Web release identity differs from built assets');
if (!/^[0-9a-f]{40}$/.test(config.sourceSha ?? '') || !['COMMITTED','DIRTY'].includes(config.sourceState)) throw new Error('Web source provenance is missing');

const reuseRemoteDesktop = process.env.AWH_DESKTOP_RELEASE_REUSE === '1';
const baseManifestPath = process.env.AWH_DESKTOP_RELEASE_BASE_MANIFEST;
let baseManifest = null;
if (reuseRemoteDesktop) {
  if (!baseManifestPath) throw new Error('Verified desktop release base manifest is required for remote reuse');
  try { baseManifest = JSON.parse(await readFile(resolve(baseManifestPath), 'utf8')); }
  catch { throw new Error('Verified desktop release base manifest is unreadable'); }
  if (!baseManifest || baseManifest.schemaVersion !== 1 || baseManifest.product !== 'AWH Control Panel' || baseManifest.sourceState !== 'COMMITTED' || !/^[0-9a-f]{40}$/.test(baseManifest.sourceSha ?? '') || !Array.isArray(baseManifest.files) || !Array.isArray(baseManifest.desktopReleases)) throw new Error('Verified desktop release base manifest is invalid');
}

function baseFile(name) {
  if (!baseManifest) return null;
  const matches = baseManifest.files.filter((item) => item && item.path === name);
  if (matches.length !== 1) throw new Error(`Verified desktop release base file is missing or ambiguous: ${name}`);
  const item = matches[0];
  if (!/^[0-9a-f]{64}$/.test(item.sha256 ?? '') || !Number.isInteger(item.sizeBytes) || item.sizeBytes < 1) throw new Error(`Verified desktop release base file is invalid: ${name}`);
  return { path: name, sha256: item.sha256, sizeBytes: item.sizeBytes };
}

function baseDesktopRelease(entry) {
  if (!baseManifest) return null;
  const matches = baseManifest.desktopReleases.filter((item) => item && item.path === entry.path);
  if (matches.length !== 1) throw new Error(`Verified desktop package provenance is missing or ambiguous: ${entry.path}`);
  const evidence = matches[0];
  if (evidence.packageVerification !== 'VERIFIED' || !/^[0-9a-f]{40}$/.test(evidence.sourceSha ?? '') || evidence.packageSha256 !== entry.sha256 || evidence.sizeBytes !== entry.sizeBytes || typeof evidence.productVersion !== 'string' || evidence.productVersion.trim() === '') throw new Error(`Verified desktop package provenance is invalid: ${entry.path}`);
  return { path: entry.path, sourceSha: evidence.sourceSha, productVersion: evidence.productVersion, packageSha256: entry.sha256, sizeBytes: entry.sizeBytes, packageVerification: 'VERIFIED' };
}

const desktopReleases = [];
const entries = [];
for (const name of files) {
  const path = join(input, name);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Release file is not a regular file: ${name}`);
  const content = await readFile(path);
  entries.push({ path: name, sha256: createHash('sha256').update(content).digest('hex'), sizeBytes: content.byteLength });
}
for (const name of optionalFiles) {
  if (reuseRemoteDesktop) {
    entries.push(baseFile(name));
    continue;
  }
  const path = join(input, name);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Release file is not a regular file: ${name}`);
    const content = await readFile(path);
    entries.push({ path: name, sha256: createHash('sha256').update(content).digest('hex'), sizeBytes: content.byteLength });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
// Existing CI evidence owns package lineage. Remote-reuse mode may carry that
// already-verified lineage forward from the currently active production
// manifest, but a ZIP checksum alone can never supply provenance.
for (const entry of entries.filter(item => item.path.endsWith('.zip'))) {
  if (reuseRemoteDesktop) {
    desktopReleases.push(baseDesktopRelease(entry));
    continue;
  }
  const evidencePath = entry.path.replace(/\.zip$/, '.release.json');
  let evidence;
  try { evidence = JSON.parse(await readFile(join(input, evidencePath), 'utf8')); }
  catch { throw new Error(`Desktop package provenance is missing: ${entry.path}`); }
  if (evidence.kind !== 'AWH_DESKTOP_RELEASE_EVIDENCE' || evidence.authority !== 'CI_PACKAGE_EVIDENCE_ONLY' || evidence.packageVerification !== 'VERIFIED' || !/^[0-9a-f]{40}$/.test(evidence.sourceSha ?? '') || evidence.packageSha256 !== entry.sha256 || evidence.sizeBytes !== entry.sizeBytes || evidence.downloadKey !== entry.path.split('/').at(-1)) throw new Error(`Desktop package provenance is invalid: ${entry.path}`);
  desktopReleases.push({ path: entry.path, sourceSha: evidence.sourceSha, productVersion: evidence.productVersion, packageSha256: entry.sha256, sizeBytes: entry.sizeBytes, packageVerification: 'VERIFIED' });
}
const mode = config.mode;
if (!['STATIC_PREVIEW', 'HUB_READ', 'CONTROL'].includes(mode)) throw new Error('Web release mode is invalid');
const product = mode === 'CONTROL' ? 'AWH Control Panel' : 'AWH Web Read-Only Preview';
const manifest = { schemaVersion: 1, releaseId, sourceSha: config.sourceSha, sourceState: config.sourceState, desktopReleases, product, generatedAt: process.env.AWH_PREVIEW_GENERATED_AT ?? new Date().toISOString(), files: entries };
await mkdir(resolve(output, '..'), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(`${output}\n`);
