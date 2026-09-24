#!/usr/bin/env node

import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const architecture = process.argv[2] ?? process.arch;
if (process.platform !== 'darwin') throw new Error('macOS DMG creation requires macOS');
if (!['x64', 'arm64'].includes(architecture)) throw new Error('unsupported macOS architecture');

const packageJson = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const version = String(packageJson.version);
const appName = 'AWH Agent.app';
const appPath = join(ROOT, 'out', `AWH Agent-darwin-${architecture}`, appName);
const outputDir = join(ROOT, 'out', 'make', 'dmg', architecture);
const outputPath = join(outputDir, `AWH-Agent-Beta-macOS-${architecture}.dmg`);
const workDir = await mkdtemp(join(tmpdir(), 'awh-dmg-'));
const stageDir = join(workDir, 'AWH Agent Beta');

function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${executable} failed (${result.status}): ${(result.stderr || result.stdout || '').trim().slice(0, 1000)}`);
  }
  return result.stdout ?? '';
}

try {
  await mkdir(stageDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  run('/usr/bin/ditto', [appPath, join(stageDir, appName)]);
  await symlink('/Applications', join(stageDir, 'Applications'));

  await rm(outputPath, { force: true });
  run('/usr/bin/hdiutil', [
    'create',
    '-volname', 'AWH Agent Beta',
    '-srcfolder', stageDir,
    '-ov',
    '-format', 'UDZO',
    '-imagekey', 'zlib-level=9',
    outputPath,
  ]);
  run('/usr/bin/hdiutil', ['verify', outputPath]);

  const digest = createHash('sha256').update(await readFile(outputPath)).digest('hex');
  console.log(`AWH_MACOS_DMG=PASS ${architecture} ${outputPath}`);
  console.log(`AWH_MACOS_DMG_SHA256=${digest}`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
