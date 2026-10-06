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

const expanded = await mkdtemp(join(tmpdir(), 'awh-installer-verify-'));
try {
  run('/usr/sbin/pkgutil', ['--expand-full', installer, expanded]);
  const distributionPath = join(expanded, 'Distribution');
  if (!(await exists(distributionPath))) throw new Error('Distribution metadata missing');
  const distribution = await readFile(distributionPath, 'utf8');
  if (!distribution.includes('AWH Agent')) throw new Error('wizard title missing');
  if (!distribution.includes('welcome.html') || !distribution.includes('conclusion.html')) throw new Error('wizard resources missing');
  if (!distribution.includes(`hostArchitectures="${expectedHostArch}"`)) throw new Error('installer architecture gate mismatch');
  if (!distribution.includes('online.kruart.awh.agent')) throw new Error('installer package identifier mismatch');

  const packageInfo = await findNamed(expanded, 'PackageInfo');
  if (!packageInfo) throw new Error('component PackageInfo missing');
  const packageXml = await readFile(packageInfo, 'utf8');
  if (!packageXml.includes('identifier="online.kruart.awh.agent"')) throw new Error('component identifier mismatch');
  if (!packageXml.includes(`version="${expectedVersion}"`)) throw new Error('component version mismatch');
  if (!packageXml.includes('install-location="/Applications"')) throw new Error('installer must target /Applications');

  const app = await findNamed(expanded, 'AWH Agent.app');
  if (!app) throw new Error('AWH Agent.app missing from installer payload');
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);

  const buildScript = await readFile(join(ROOT, 'scripts', 'package-macos-installer.mjs'), 'utf8');
  if (/rm\s+-rf[^\n]*(?:Application Support\/AWH|\.awh)/i.test(buildScript)) throw new Error('installer must not delete AWH state');
  if (/tccutil\s+reset/i.test(buildScript)) throw new Error('installer must not reset macOS privacy grants');

  console.log(JSON.stringify({
    status: 'PASS',
    architecture,
    version: expectedVersion,
    identifier: 'online.kruart.awh.agent',
    installLocation: '/Applications',
    bytes: info.size,
    sha256: await sha256(installer),
    preservesAwhState: true,
    preservesTcc: true,
  }));
} finally {
  await rm(expanded, { recursive: true, force: true });
}
