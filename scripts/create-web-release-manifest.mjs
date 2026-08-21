#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const input = resolve(root, process.argv[2] ?? 'dist-web');
const output = resolve(root, process.argv[3] ?? join(input, 'release.json'));
const files = ['index.html', 'styles.css', 'app.js', 'hub-read-adapter.js', 'control-plane-adapter.js', 'manifest.webmanifest', 'sw.js', 'logo-256x256.png', 'web-config.json', 'data.json'];
const releaseId = process.env.AWH_RELEASE_ID ?? new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

const entries = [];
for (const name of files) {
  const path = join(input, name);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Release file is not a regular file: ${name}`);
  const content = await readFile(path);
  entries.push({ path: name, sha256: createHash('sha256').update(content).digest('hex'), sizeBytes: content.byteLength });
}
const manifest = { schemaVersion: 1, releaseId, product: 'AWH Web Read-Only Preview', generatedAt: process.env.AWH_PREVIEW_GENERATED_AT ?? new Date().toISOString(), files: entries };
await mkdir(resolve(output, '..'), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(`${output}\n`);
