#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const input = resolve(root, process.argv[2] ?? 'dist-web');
const output = resolve(root, process.argv[3] ?? join(input, 'release.json'));
// Required runtime assets must include every file referenced by the canonical web shell.
const files = ['index.html', 'styles.css', 'awh-design-system.css', 'awh-light-system.css', 'responsive-layout.css', 'app.js', 'navigation.js', 'dashboard.css', 'dashboard.js', 'execution-ux.js', 'tool-registry.js', 'school-tools.js', 'vendor/pdf-lib.min.js', 'vendor/qrcode.js', 'hub-read-adapter.js', 'control-plane-adapter.js', 'database.html', 'database.css', 'database.js', 'infrastructure.html', 'infrastructure.css', 'infrastructure.js', 'hosting.html', 'hosting.css', 'hosting.js', 'trust.html', 'trust.css', 'trust.js', 'review.html', 'review.css', 'review.js', 'panel.html', 'panel.css', 'panel.js', 'manifest.webmanifest', 'sw.js', 'logo-256x256.png', 'bay-golden-mark.svg', 'bay-golden-mascot.svg', 'bay-icon-home.svg', 'bay-icon-ecosystem.svg', 'bay-icon-learnlab.svg', 'bay-icon-apps.svg', 'bay-icon-download.svg', 'bay-icon-status.svg', 'bay-icon-web.svg', 'bay-icon-work.svg', 'bay-icon-school.svg', 'kruart-student-hero.svg', 'kruart-teacher-hero.svg', 'kruart-card-student.svg', 'kruart-card-teacher.svg', 'kruart-card-parent.svg', 'kruart-card-staff.svg', 'kruart-classroom.svg', 'kruart-learnlab-mascot.svg', 'kruart-human-student-hero.webp', 'kruart-human-student-hero-hq.webp', 'kruart-human-teacher-hero.webp', 'kruart-human-teacher-hero-hq.webp', 'kruart-human-student-thai.webp', 'kruart-human-student-thai-hq.webp', 'kruart-human-student-english.webp', 'kruart-human-student-english-hq.webp', 'kruart-human-student-math.webp', 'kruart-human-student-math-hq.webp', 'kruart-human-student-computer.webp', 'kruart-human-student-computer-hq.webp', 'kruart-reference-role-parent.webp', 'kruart-reference-role-parent-hq.webp', 'kruart-reference-role-staff.webp', 'kruart-reference-role-staff-hq.webp', 'kruart-campus-bg.svg', 'web-config.json', 'data.json'];
const optionalFiles = ['downloads/AWH-macOS-x64.zip', 'downloads/AWH-Windows-x64.zip', 'downloads/SHA256SUMS.txt'];
const releaseId = process.env.AWH_RELEASE_ID ?? new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

const entries = [];
for (const name of files) {
  const path = join(input, name);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Release file is not a regular file: ${name}`);
  const content = await readFile(path);
  entries.push({ path: name, sha256: createHash('sha256').update(content).digest('hex'), sizeBytes: content.byteLength });
}
for (const name of optionalFiles) {
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
const mode = JSON.parse(await readFile(join(input, 'web-config.json'), 'utf8')).mode;
if (!['STATIC_PREVIEW', 'HUB_READ', 'CONTROL'].includes(mode)) throw new Error('Web release mode is invalid');
const product = mode === 'CONTROL' ? 'AWH Control Panel' : 'AWH Web Read-Only Preview';
const manifest = { schemaVersion: 1, releaseId, product, generatedAt: process.env.AWH_PREVIEW_GENERATED_AT ?? new Date().toISOString(), files: entries };
await mkdir(resolve(output, '..'), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(`${output}\n`);
