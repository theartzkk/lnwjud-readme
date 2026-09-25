import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const EXPECTED = new Map([
  ['darwin/x64', 'AWH-Agent-Beta-macOS-x64.dmg'],
  ['darwin/arm64', 'AWH-Agent-Beta-macOS-arm64.dmg'],
]);

function fail(message) {
  throw new Error(`DESKTOP_INSTALLER_EVIDENCE_INVALID: ${message}`);
}

function parseArgs(argv) {
  const allowed = new Set(['platform', 'architecture', 'package', 'source-sha', 'output']);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) fail('arguments must be key/value pairs');
    const name = key.slice(2);
    if (!allowed.has(name) || values.has(name)) fail(`unsupported or duplicate argument ${key}`);
    values.set(name, value);
  }
  for (const name of allowed) if (!values.has(name)) fail(`missing --${name}`);
  return Object.fromEntries(values);
}

const args = parseArgs(process.argv.slice(2));
const pair = `${args.platform}/${args.architecture}`;
const expectedName = EXPECTED.get(pair);
if (!expectedName) fail('platform/architecture is not a supported AWH Beta installer target');
if (!/^[0-9a-f]{40}$/.test(args['source-sha'])) fail('source SHA must be exact lowercase Git SHA-1');

const packagePath = resolve(args.package);
const outputPath = resolve(args.output);
if (basename(packagePath) !== expectedName) fail('installer filename does not match target');
if (packagePath === outputPath) fail('output cannot replace installer');

const packageStat = await lstat(packagePath);
if (!packageStat.isFile() || packageStat.isSymbolicLink() || packageStat.size <= 0) fail('installer must be a non-empty regular file');

const pkg = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
if (typeof pkg.version !== 'string' || !pkg.version.trim()) fail('package version is missing');
const bytes = await readFile(packagePath);
const evidence = {
  schemaVersion: 1,
  kind: 'AWH_DESKTOP_INSTALLER_EVIDENCE',
  authority: 'CI_PACKAGE_EVIDENCE_ONLY',
  productId: 'awh',
  channel: 'beta',
  platform: args.platform,
  architecture: args.architecture,
  productVersion: pkg.version,
  sourceSha: args['source-sha'],
  packageSha256: createHash('sha256').update(bytes).digest('hex'),
  sizeBytes: packageStat.size,
  downloadKey: expectedName,
  packageVerification: 'VERIFIED',
  platformTrust: 'ADHOC_BETA',
  notarization: 'NOT_NOTARIZED',
};

await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
console.log(`DESKTOP_INSTALLER_EVIDENCE=PASS ${basename(outputPath)} ${evidence.packageSha256}`);
