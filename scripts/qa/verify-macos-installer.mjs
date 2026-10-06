#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const architecture = process.argv[2] ?? 'x64';
if (process.platform !== 'darwin') throw new Error('macOS installer verification must run on darwin');
if (!['x64', 'arm64'].includes(architecture)) throw new Error('unsupported macOS architecture');

const pkgMeta = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const expectedVersion = String(pkgMeta.version);
const installer = join(ROOT, `AWH-macOS-${architecture}-Installer.pkg`);
const expectedHostArch = architecture === 'x64' ? 'x86_64' : 'arm64';

function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${executable} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

async function exists(path) {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

async function findNamed(root, name) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.name === name) return path;
    if (entry.isDirectory()) {
      const found = await findNamed(path, name);
      if (found) return found;
    }
  }
  return undefined;
}

async function sha256(path) {
  return await new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(path);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolveHash(hash.digest('hex')));
  });
}

if (!(await exists(installer))) throw new Error(`installer missing: ${installer}`);
const info = await stat(installer);
if (info.size < 10 * 1024 * 1024) throw new Error(`installer unexpectedly small: ${info.size}`);

const verifyRoot = await mkdtemp(join(tmpdir(), 'awh-installer-verify-'));
const expanded = join(verifyRoot, 'expanded');

try {
  run('/usr/sbin/pkgutil', ['--expand-full', installer, expanded]);
  const distributionPath = join(expanded, 'Distribution');
  if (!(await exists(distributionPath))) throw new Error('Distribution metadata missing');
  const distribution = await readFile(distributionPath, 'utf8');

  for (const marker of ['AWH Agent', 'welcome.html', 'readme.html', 'conclusion.html', 'online.kruart.awh.agent']) {
    if (!distribution.includes(marker)) throw new Error(`wizard contract missing: ${marker}`);
  }
  if (!distribution.includes(`hostArchitectures="${expectedHostArch}"`)) throw new Error('installer architecture gate mismatch');

  const packageInfo = await findNamed(expanded, 'PackageInfo');
  if (!packageInfo) throw new Error('component PackageInfo missing');
  const packageXml = await readFile(packageInfo, 'utf8');
  if (!packageXml.includes('identifier="online.kruart.awh.agent"')) throw new Error('component identifier mismatch');
  if (!packageXml.includes(`version="${expectedVersion}"`)) throw new Error('component version mismatch');
  if (!packageXml.includes('install-location="/"')) throw new Error('installer root location contract changed');

  const app = await findNamed(expanded, 'AWH Agent.app');
  if (!app) throw new Error('AWH Agent.app missing from installer payload');
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);

  const preinstall = await findNamed(expanded, 'preinstall');
  const postinstall = await findNamed(expanded, 'postinstall');
  if (!preinstall || !postinstall) throw new Error('installer lifecycle scripts missing');
  run('/bin/sh', ['-n', preinstall]);
  run('/bin/sh', ['-n', postinstall]);

  const pre = await readFile(preinstall, 'utf8');
  const post = await readFile(postinstall, 'utf8');
  const combined = `${pre}\n${post}`;
  if (/tccutil\s+reset/i.test(combined)) throw new Error('installer must not reset macOS privacy grants');
  if (/Keychain|security\s+delete|delete-generic-password/i.test(combined)) throw new Error('installer must not mutate Keychain credentials');
  if (/Application Support\/AWH\/Engines|\.awh\//i.test(combined)) throw new Error('installer must not mutate runtime or pairing state');
  if (!/AWH Agent\.previous\.app/.test(pre)) throw new Error('installer backup contract missing');
  if (!/codesign --verify --deep --strict/.test(post)) throw new Error('postinstall signature verification missing');
  if (!/rollback/.test(post)) throw new Error('postinstall rollback contract missing');
  if (!/open -a/.test(post)) throw new Error('postinstall automatic relaunch missing');

  console.log(JSON.stringify({
    status: 'PASS',
    architecture,
    version: expectedVersion,
    identifier: 'online.kruart.awh.agent',
    installLocation: '/Applications/AWH Agent.app',
    bytes: info.size,
    sha256: await sha256(installer),
    preservesAwhState: true,
    preservesTcc: true,
    rollback: true,
    relaunch: true,
  }));
} finally {
  await rm(verifyRoot, { recursive: true, force: true });
}
