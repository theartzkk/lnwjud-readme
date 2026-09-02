import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const EXPECTED_PACKAGE = new Map([
  ['win32/x64', 'AWH-Windows-x64.zip'],
  ['darwin/x64', 'AWH-macOS-x64.zip'],
]);

function fail(message) {
  throw new Error(`DESKTOP_RELEASE_EVIDENCE_INVALID: ${message}`);
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

function productVersion(pkg) {
  const version = pkg?.version;
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    fail('package version must be bounded semver');
  }
  return version;
}

const args = parseArgs(process.argv.slice(2));
const pair = `${args.platform}/${args.architecture}`;
const expectedName = EXPECTED_PACKAGE.get(pair);
if (!expectedName) fail('platform/architecture is not a packaged AWH target');
if (!/^[0-9a-f]{40}$/.test(args['source-sha'])) fail('source SHA must be exact lowercase Git SHA-1');

const packagePath = resolve(args.package);
const outputPath = resolve(args.output);
if (basename(packagePath) !== expectedName) fail('package filename does not match the target');
if (packagePath === outputPath) fail('output cannot replace the package');

const packageStat = await lstat(packagePath);
if (!packageStat.isFile() || packageStat.isSymbolicLink() || packageStat.size <= 0) fail('package must be a non-empty regular file');
if ((await realpath(packagePath)) !== packagePath) fail('package path must not traverse a symlink');

const pkg = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
const bytes = await readFile(packagePath);
const evidence = {
  schemaVersion: 1,
  kind: 'AWH_DESKTOP_RELEASE_EVIDENCE',
  authority: 'CI_PACKAGE_EVIDENCE_ONLY',
  productId: 'awh',
  platform: args.platform,
  architecture: args.architecture,
  productVersion: productVersion(pkg),
  sourceSha: args['source-sha'],
  packageSha256: createHash('sha256').update(bytes).digest('hex'),
  sizeBytes: packageStat.size,
  downloadKey: expectedName,
  packageVerification: 'VERIFIED',
  publicationState: 'NOT_PUBLISHED',
  updaterStatus: 'FOUNDATION_LOCKED_NOT_ACTIVATED',
};

await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
console.log(`DESKTOP_RELEASE_EVIDENCE=PASS ${basename(outputPath)} ${evidence.packageSha256}`);
