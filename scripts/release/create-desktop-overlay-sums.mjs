import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function fail(message) { throw new Error(`DESKTOP_OVERLAY_SUMS_INVALID: ${message}`); }
const [baseArg, armArg, outputArg] = process.argv.slice(2);
if (!baseArg || !armArg || !outputArg) fail('usage: <base-release.json> <AWH-macOS-arm64.zip> <output>');

const base = JSON.parse(await readFile(resolve(baseArg), 'utf8'));
if (base?.schemaVersion !== 1 || !Array.isArray(base.files) || !Array.isArray(base.desktopReleases)) fail('base manifest is invalid');

const required = ['downloads/AWH-macOS-x64.zip', 'downloads/AWH-Windows-x64.zip'];
const sums = new Map();
for (const path of required) {
  const fileRows = base.files.filter((row) => row?.path === path);
  const releaseRows = base.desktopReleases.filter((row) => row?.path === path);
  if (fileRows.length !== 1 || releaseRows.length !== 1) fail(`base package missing: ${path}`);
  const file = fileRows[0]; const release = releaseRows[0];
  if (!/^[0-9a-f]{64}$/.test(file.sha256 ?? '') || release.packageVerification !== 'VERIFIED' ||
      !/^[0-9a-f]{40}$/.test(release.sourceSha ?? '') || release.packageSha256 !== file.sha256 ||
      release.sizeBytes !== file.sizeBytes) fail(`base package provenance invalid: ${path}`);
  sums.set(path.split('/').at(-1), file.sha256);
}

const armPath = resolve(armArg);
const armStat = await lstat(armPath);
if (!armStat.isFile() || armStat.isSymbolicLink() || armStat.size < 1) fail('arm64 package is invalid');
const armHash = createHash('sha256').update(await readFile(armPath)).digest('hex');
sums.set('AWH-macOS-arm64.zip', armHash);

const order = ['AWH-macOS-arm64.zip', 'AWH-macOS-x64.zip', 'AWH-Windows-x64.zip'];
const text = order.map((name) => `${sums.get(name)}  ${name}`).join('\n') + '\n';
await writeFile(resolve(outputArg), text, { encoding: 'utf8', mode: 0o640 });
console.log(`DESKTOP_OVERLAY_SUMS=PASS ${armHash}`);
