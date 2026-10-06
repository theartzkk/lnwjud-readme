#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { access, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

const architecture = process.argv[2];
if (process.platform !== 'darwin') throw new Error('macOS notarization must run on darwin');
if (!['x64', 'arm64'].includes(architecture)) throw new Error('usage: notarize-macos-installer.mjs <x64|arm64>');
if (process.env.AWH_MAC_RELEASE_MODE?.trim() !== 'production') throw new Error('AWH_MAC_RELEASE_MODE=production is required');

const pkg = resolve(`AWH-macOS-${architecture}-Installer.pkg`);
await access(pkg, constants.R_OK);

function run(executable, args, { allowFailure = false } = {}) {
  const result = spawnSync(executable, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (!allowFailure && result.status !== 0) throw new Error(`${executable} failed: ${result.stderr || result.stdout}`);
  return { code: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const signature = run('/usr/sbin/pkgutil', ['--check-signature', pkg]);
const signatureText = `${signature.stdout}\n${signature.stderr}`;
if (!/Developer ID Installer:/i.test(signatureText)) throw new Error('AWH_MACOS_DEVELOPER_ID_INSTALLER_SIGNATURE_MISSING');

const profile = process.env.AWH_MAC_NOTARY_KEYCHAIN_PROFILE?.trim() || '';
let args = ['notarytool', 'submit', pkg, '--wait', '--output-format', 'json'];
if (profile) {
  args.push('--keychain-profile', profile);
} else {
  const appleId = process.env.AWH_APPLE_ID?.trim() || '';
  const teamId = process.env.AWH_APPLE_TEAM_ID?.trim() || '';
  const password = process.env.AWH_APPLE_APP_SPECIFIC_PASSWORD?.trim() || '';
  if (!appleId || !teamId || !password) throw new Error('AWH_MACOS_NOTARY_CREDENTIALS_REQUIRED');
  args.push('--apple-id', appleId, '--team-id', teamId, '--password', password);
}

const submission = run('/usr/bin/xcrun', args);
let result;
try { result = JSON.parse(submission.stdout); } catch { throw new Error('AWH_MACOS_NOTARY_RESPONSE_INVALID'); }
if (result.status !== 'Accepted') throw new Error(`AWH_MACOS_NOTARY_REJECTED:${String(result.status ?? 'UNKNOWN')}`);

run('/usr/bin/xcrun', ['stapler', 'staple', pkg]);
run('/usr/bin/xcrun', ['stapler', 'validate', pkg]);
const assess = run('/usr/sbin/spctl', ['--assess', '--type', 'install', '--verbose=4', pkg], { allowFailure: true });
if (assess.code !== 0) throw new Error(`AWH_MACOS_GATEKEEPER_REJECTED:${(assess.stderr || assess.stdout).trim().slice(0, 240)}`);

const evidence = {
  schemaVersion: 1,
  kind: 'AWH_MACOS_NOTARIZATION_EVIDENCE',
  architecture,
  packageFile: `AWH-macOS-${architecture}-Installer.pkg`,
  submissionId: typeof result.id === 'string' ? result.id : null,
  status: result.status,
  stapled: true,
  gatekeeperAccepted: true,
};
await writeFile(resolve(`AWH-macOS-${architecture}-Installer.notary.json`), JSON.stringify(evidence, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
console.log(`AWH_MACOS_NOTARIZATION=PASS ${architecture} ${evidence.submissionId ?? 'no-id'}`);
