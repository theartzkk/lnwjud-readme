#!/usr/bin/env node

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve(process.cwd());
const requestedOutput = process.env.AWH_WEB_OUTPUT_DIR;
const OUTPUT = requestedOutput === undefined ? join(ROOT, 'dist-web') : resolve(requestedOutput);
const PRODUCT = {
  productName: 'Art’s Workspace Hub',
  shortName: 'AWH',
  tagline: 'Your Projects. One Workspace. Anywhere.',
};

function isWithin(root, candidate) {
  const value = relative(root, candidate);
  return value !== '' && !value.startsWith(`..${sep}`) && value !== '..' && !value.startsWith('../');
}
if (requestedOutput !== undefined && !isWithin(ROOT, OUTPUT) && !isWithin(tmpdir(), OUTPUT)) {
  throw new Error('AWH web output path is outside the allowed build roots');
}

async function asset(name) {
  return readFile(join(ROOT, 'web', name), 'utf8');
}

function renderReleaseAsset(source, releaseId) {
  const rendered = source.replaceAll('__AWH_WEB_RELEASE_ID__', releaseId);
  if (rendered.includes('__AWH_WEB_RELEASE_ID__')) throw new Error('AWH web release identity was not rendered');
  return rendered;
}
function generatedAt() {
  const fixed = process.env.AWH_PREVIEW_GENERATED_AT;
  if (fixed !== undefined && Number.isFinite(Date.parse(fixed))) return fixed;
  return new Date().toISOString();
}

async function main() {
  const webMode = process.env.AWH_WEB_MODE === 'CONTROL' || process.argv.includes('--control') ? 'CONTROL' : 'UNAVAILABLE';
  const releaseId = process.env.AWH_WEB_RELEASE_ID ?? process.env.AWH_RELEASE_ID ?? 'local';
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(releaseId)) throw new Error('AWH web release identity is invalid');
  const data = {
    schemaVersion: 1,
    generatedAt: generatedAt(),
    surface: { mode: webMode, label: 'AWH', status: webMode === 'CONTROL' ? 'Sign in to continue' : 'AWH release is not active' },
    product: { name: PRODUCT.productName, shortName: PRODUCT.shortName, tagline: PRODUCT.tagline },
    message: webMode === 'CONTROL' ? 'Sign in to access your workspace.' : 'This AWH release is not configured for Control.',
  };
  const textAssets = ['index.html', 'styles.css', 'hub-shell.css', 'app.js', 'hub-shell.js', 'hub-read-adapter.js', 'control-plane-adapter.js', 'manifest.webmanifest', 'sw.js'];
  const contents = await Promise.all(textAssets.map(asset));
  await mkdir(OUTPUT, { recursive: true });
  await Promise.all(textAssets.map((name, index) => writeFile(join(OUTPUT, name), renderReleaseAsset(contents[index], releaseId), 'utf8')));
  await Promise.all([
    copyFile(join(ROOT, 'logo-256x256.png'), join(OUTPUT, 'logo-256x256.png')),
    copyFile(join(ROOT, 'web', 'tool-catalog.json'), join(OUTPUT, 'tool-catalog.json')),
    writeFile(join(OUTPUT, 'web-config.json'), `${JSON.stringify({ schemaVersion: 1, mode: webMode, apiBase: webMode === 'CONTROL' ? '/api/v1' : null }, null, 2)}\n`, 'utf8'),
    writeFile(join(OUTPUT, 'data.json'), `${JSON.stringify(data, null, 2)}\n`, 'utf8'),
  ]);
  process.stdout.write(`AWH web built at ${OUTPUT}\n`);
}

await main();
