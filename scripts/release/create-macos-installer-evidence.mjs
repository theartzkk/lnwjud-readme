#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, readdir, stat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function fail(message) {
  throw new Error(`AWH_MACOS_INSTALLER_EVIDENCE_INVALID: ${message}`);
}

const architecture = process.argv[2];
const sourceSha = process.argv[3];
if (!['x64', 'arm64'].includes(architecture)) fail('architecture must be x64 or arm64');
if (!/^[0-9a-f]{40}$/.test(sourceSha ?? '')) fail('exact lowercase source SHA is required');

const packagePath = resolve(`AWH-macOS-${architecture}-Installer.pkg`);
const outputPath = resolve(`AWH-macOS-${architecture}-Installer.release.json`);
const pkg = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
const info = await stat(packagePath);
if (!info.isFile() || info.size <= 0) fail('installer package must be a non-empty file');

function run(executable, args) {
  const result = spawnSync(executable, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

async function findApp(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && entry.name === 'AWH Agent.app') return path;
    if (entry.isDirectory()) {
      const nested = await findApp(path);
      if (nested) return nested;
    }
  }
  return null;
}

const bytes = await readFile(packagePath);
const signature = run('/usr/sbin/pkgutil', ['--check-signature', packagePath]);
const signatureOutput = `${signature.stdout}\n${signature.stderr}`;
const installerDeveloperId = signature.code === 0 && /Developer ID Installer:/i.test(signatureOutput);

const staple = run('/usr/bin/xcrun', ['stapler', 'validate', packagePath]);
const stapled = staple.code === 0;
const gatekeeper = run('/usr/sbin/spctl', ['--assess', '--type', 'install', '--verbose=4', packagePath]);
const gatekeeperAccepted = gatekeeper.code === 0;

let appDeveloperId = false;
const expanded = await mkdtemp(join(tmpdir(), `awh-installer-evidence-${architecture}-`));
try {
  const expand = run('/usr/sbin/pkgutil', ['--expand-full', packagePath, expanded]);
  if (expand.code !== 0) fail('installer payload expansion failed');
  const app = await findApp(expanded);
  if (!app) fail('AWH Agent.app missing from installer payload');
  const verify = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  if (verify.code !== 0) fail('embedded app signature verification failed');
  const detail = run('/usr/bin/codesign', ['-dv', '--verbose=4', app]);
  const detailText = `${detail.stdout}\n${detail.stderr}`;
  appDeveloperId = detail.code === 0 && /Authority=Developer ID Application:/i.test(detailText);
} finally {
  await rm(expanded, { recursive: true, force: true });
}

const freshInstallReady = appDeveloperId && installerDeveloperId && stapled && gatekeeperAccepted;
const evidence = {
  schemaVersion: 1,
  kind: 'AWH_MACOS_INSTALLER_RELEASE_EVIDENCE',
  authority: 'CI_PACKAGE_EVIDENCE_ONLY',
  productId: 'awh',
  platform: 'darwin',
  architecture,
  productVersion: pkg.version,
  sourceSha,
  packageFile: basename(packagePath),
  packageSha256: createHash('sha256').update(bytes).digest('hex'),
  sizeBytes: info.size,
  installLocation: '/Applications/AWH Agent.app',
  bundleId: 'com.artworkspacehub.awh',
  packageIdentifier: 'online.kruart.awh.agent',
  preservesUserState: true,
  preservesTccState: true,
  rollbackOnVerificationFailure: true,
  autoRelaunch: true,
  appSigningState: appDeveloperId ? 'DEVELOPER_ID_APPLICATION' : 'ADHOC_OR_UNSIGNED',
  signingState: installerDeveloperId ? 'DEVELOPER_ID_INSTALLER' : 'UNSIGNED_LOCAL_INSTALLER',
  notarizationState: stapled ? 'STAPLED' : 'MISSING',
  gatekeeperState: gatekeeperAccepted ? 'ACCEPTED' : 'BLOCKED',
  freshInstallReady,
  publicationState: freshInstallReady ? 'READY_FOR_FRESH_INSTALL' : 'FRESH_INSTALL_BLOCKED',
};

await import('node:fs/promises').then(({ writeFile }) =>
  writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
);
console.log(`AWH_MACOS_INSTALLER_EVIDENCE=PASS ${architecture} ${evidence.packageSha256} ready=${freshInstallReady ? 'yes' : 'no'} publication=${evidence.publicationState}`);
