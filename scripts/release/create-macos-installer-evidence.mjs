#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
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

const bytes = await readFile(packagePath);
const signature = spawnSync('/usr/sbin/pkgutil', ['--check-signature', packagePath], { encoding: 'utf8' });
const signatureOutput = `${signature.stdout ?? ''}\n${signature.stderr ?? ''}`;
const signed = signature.status === 0 && /Status:\s+signed by/i.test(signatureOutput);

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
  signingState: signed ? 'SIGNED' : 'UNSIGNED_LOCAL_INSTALLER',
  publicationState: 'NOT_PUBLISHED',
};

await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
console.log(`AWH_MACOS_INSTALLER_EVIDENCE=PASS ${architecture} ${evidence.packageSha256} signed=${signed ? 'yes' : 'no'}`);
