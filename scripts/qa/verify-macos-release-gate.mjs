#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const architecture = process.argv[2];
const requireReady = process.argv.includes('--require-ready');
if (!['x64', 'arm64'].includes(architecture)) throw new Error('usage: verify-macos-release-gate.mjs <x64|arm64> [--require-ready]');

const path = resolve(`AWH-macOS-${architecture}-Installer.release.json`);
const evidence = JSON.parse(await readFile(path, 'utf8'));

const valid =
  evidence?.schemaVersion === 1 &&
  evidence?.kind === 'AWH_MACOS_INSTALLER_RELEASE_EVIDENCE' &&
  evidence?.platform === 'darwin' &&
  evidence?.architecture === architecture &&
  typeof evidence?.packageSha256 === 'string' &&
  /^[0-9a-f]{64}$/.test(evidence.packageSha256) &&
  typeof evidence?.freshInstallReady === 'boolean';

if (!valid) throw new Error('AWH_MACOS_RELEASE_GATE_EVIDENCE_INVALID');

if (evidence.freshInstallReady) {
  if (evidence.signingState !== 'DEVELOPER_ID_INSTALLER') throw new Error('AWH_MACOS_RELEASE_GATE_SIGNING_INVALID');
  if (evidence.notarizationState !== 'STAPLED') throw new Error('AWH_MACOS_RELEASE_GATE_NOTARIZATION_INVALID');
  if (evidence.gatekeeperState !== 'ACCEPTED') throw new Error('AWH_MACOS_RELEASE_GATE_GATEKEEPER_INVALID');
  if (evidence.publicationState !== 'READY_FOR_FRESH_INSTALL') throw new Error('AWH_MACOS_RELEASE_GATE_PUBLICATION_INVALID');
} else if (evidence.publicationState !== 'FRESH_INSTALL_BLOCKED') {
  throw new Error('AWH_MACOS_RELEASE_GATE_FAIL_OPEN');
}

if (requireReady && !evidence.freshInstallReady) {
  throw new Error(`AWH_MACOS_FRESH_INSTALL_BLOCKED signing=${evidence.signingState} notarization=${evidence.notarizationState} gatekeeper=${evidence.gatekeeperState}`);
}

console.log(`AWH_MACOS_RELEASE_GATE=PASS ${architecture} ready=${evidence.freshInstallReady ? 'yes' : 'no'} publication=${evidence.publicationState}`);
