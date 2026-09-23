#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXPECTED_VERSION = '1.0.0-rc.1';
const EXPECTED_PRODUCT = 'Art’s Workspace Hub';
const OWNER_PROTOCOL_FILENAME = 'ART_AI_WORKING_PROTOCOL.md';
const MAX_BUNDLE_BYTES = 500 * 1024 * 1024;
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }

async function exists(path) {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

async function hashTree(root) {
  const hash = createHash('sha256');
  let size = 0;
  async function visit(path) {
    const info = await lstat(path);
    const rel = relative(root, path).split('\\').join('/');
    hash.update(`${rel}\0${info.mode}\0`);
    if (info.isSymbolicLink()) { hash.update(`link:${await import('node:fs/promises').then(({ readlink }) => readlink(path))}\0`); return; }
    if (info.isDirectory()) {
      for (const entry of (await readdir(path)).sort()) await visit(join(path, entry));
      return;
    }
    if (info.isFile()) {
      size += info.size;
      assert(size < MAX_BUNDLE_BYTES, `packaged bundle exceeds the ${MAX_BUNDLE_BYTES}-byte safety boundary before hashing`);
      const data = await readFile(path);
      hash.update(data);
    }
  }
  await visit(root);
  return { hash: hash.digest('hex'), size };
}

function run(executable, args, options = {}) {
  return new Promise((resolveResult, reject) => {
    const { input = '', ...spawnOptions } = options;
    const child = spawn(executable, args, { ...spawnOptions, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { if (stdout.length < 128 * 1024) stdout += chunk.slice(0, 128 * 1024 - stdout.length); });
    child.stderr.on('data', (chunk) => { if (stderr.length < 8 * 1024) stderr += chunk.slice(0, 8 * 1024 - stderr.length); });
    if (input) { child.stdin.write(input); child.stdin.end(); }
    const timer = setTimeout(() => { child.kill(); reject(new Error('packaged runtime verification timed out')); }, 30_000);
    child.once('error', reject);
    child.once('close', (code) => { clearTimeout(timer); resolveResult({ code: code ?? -1, stdout, stderr }); });
  });
}

async function verifyNodeMode(executable, asarPath) {
  const root = await mkdtemp(join(tmpdir(), 'awh-packaged-runtime-'));
  const workspace = join(root, 'workspace');
  const dataDir = join(root, 'data');
  const env = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    ELECTRON_RUN_AS_NODE: '1',
    AWH_DATA_DIR: dataDir,
    AWH_ALLOW_WRITE: '0',
    AWH_ALLOW_EXEC: '0',
    AWH_ALLOW_CODEX: '0',
  };
  try {
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const entrypoint = join(asarPath, 'dist', 'index.js');
    const input = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'awh-packaged-verifier', version: '1.0.0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'health', arguments: {} } },
    ].map((value) => JSON.stringify(value)).join('\n') + '\n';
    const result = await run(executable, [entrypoint, '--workspace', workspace, '--remote-tunnel'], { cwd: ROOT, env, input });
    assert(result.code === 0, 'packaged Node-mode runtime exited unsuccessfully');
    const lines = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    const initialize = lines.find((line) => line.id === 1);
    const healthResponse = lines.find((line) => line.id === 2);
    assert(initialize?.result?.serverInfo?.name === 'art-agent', 'MCP protocol identity changed unexpectedly');
    assert(initialize?.result?.serverInfo?.version === EXPECTED_VERSION, 'packaged MCP version mismatch');
    const healthText = healthResponse?.result?.content?.find((item) => item.type === 'text')?.text;
    const health = JSON.parse(healthText);
    assert(health.name === EXPECTED_PRODUCT && health.version === EXPECTED_VERSION, 'packaged AWH health identity/version mismatch');
    assert(health.profile === 'remote-readonly' && health.allowWrite === false && health.allowExec === false && health.allowCodex === false, 'packaged remote permissions widened');
    return { status: 'PASS', protocol: initialize.result.serverInfo.name, profile: health.profile };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const platform = process.argv[2];
const architecture = process.argv[3] ?? process.arch;
if (!['darwin', 'win32'].includes(platform)) fail('Usage: verify-packaged-bundle.mjs <darwin|win32> [x64|arm64]');
if (platform === 'win32' && architecture !== 'x64') fail('Windows packaged verification currently supports x64 only');
if (platform === 'darwin' && !['x64', 'arm64'].includes(architecture)) fail('macOS packaged verification supports x64 or arm64');
const outputRoot = join(ROOT, 'out', 'AWH Agent-' + platform + '-' + architecture);
const bundle = platform === 'darwin' ? join(outputRoot, 'AWH Agent.app') : outputRoot;
const executable = platform === 'darwin' ? join(bundle, 'Contents', 'MacOS', 'AWH') : join(bundle, 'AWH.exe');
const asarPath = platform === 'darwin' ? join(bundle, 'Contents', 'Resources', 'app.asar') : join(bundle, 'resources', 'app.asar');
assert(await exists(bundle), `packaged bundle not found: ${platform}`);
assert(await exists(executable), `expected ${platform === 'darwin' ? 'AWH Agent.app/AWH' : 'AWH.exe'} is missing`);
assert(await exists(asarPath), 'packaged app.asar is missing');
const listing = asar.listPackage(asarPath, { isPack: false });
const normalizedListing = listing.map((entry) => entry.replaceAll('\\', '/'));
const hasEntry = (entry) => normalizedListing.includes(entry) || normalizedListing.includes(`/${entry}`);
assert(hasEntry('dist/index.js'), 'packaged dist/index.js is missing');
assert(hasEntry('dist/product.js'), 'packaged product runtime is missing');
assert(hasEntry('dist/owner-protocol.js'), 'packaged owner protocol runtime is missing');
assert(hasEntry('dist/project-registry.js'), 'packaged project context runtime is missing');
assert(hasEntry(OWNER_PROTOCOL_FILENAME), 'packaged AWH working context is missing');
assert(hasEntry('desktop/index.html'), 'packaged owner Control Panel renderer is missing');
assert(hasEntry('desktop/connect.html'), 'packaged AWH Agent bridge renderer is missing');
assert(hasEntry('desktop/connect.js'), 'packaged AWH Agent bridge script is missing');
assert(hasEntry('desktop/connect.css'), 'packaged AWH Agent bridge styles are missing');
assert(hasEntry('desktop/connect-preload.cjs'), 'packaged AWH Agent bridge preload is missing');
assert(hasEntry('dist/desktop/main.js'), 'packaged Desktop main process is missing');
assert(!normalizedListing.some((entry) => /^\/?(?:dist-web|out)(?:\/|$)/.test(entry)), 'packaged bundle contains generated release/output directories');
assert(!normalizedListing.some((entry) => /^\/?\.awh(?:-local)?(?:\/|$)/.test(entry)), 'packaged bundle contains workspace-local AWH state');
const sourceProtocol = await readFile(join(ROOT, OWNER_PROTOCOL_FILENAME), 'utf8');
const expectedProtocolVersion = /^Version:\s*([0-9]+\.[0-9]+)\s*$/m.exec(sourceProtocol)?.[1];
assert(expectedProtocolVersion, 'source owner working protocol version is invalid');
const packagedProtocol = asar.extractFile(asarPath, OWNER_PROTOCOL_FILENAME).toString('utf8');
assert(/# AWH Working Context/.test(packagedProtocol) && /Mode: context-only/.test(packagedProtocol) && packagedProtocol.includes(`Version: ${expectedProtocolVersion}`), 'packaged owner working context identity is invalid');
assert(/professional judgment/i.test(packagedProtocol) && /capabilit/i.test(packagedProtocol), 'packaged AWH working context is incomplete');
const packagedDesktopHtml = asar.extractFile(asarPath, 'desktop/index.html').toString('utf8');
assert(/id="desktop-work-thread"/.test(packagedDesktopHtml) && /id="desktop-work-input"/.test(packagedDesktopHtml), 'packaged renderer does not contain the final project Work surface');
const packagedConnectHtml = asar.extractFile(asarPath, 'desktop/connect.html').toString('utf8');
assert(/id="open-awh"/.test(packagedConnectHtml) && /AWH Agent/.test(packagedConnectHtml), 'packaged AWH Agent bridge surface is incomplete');
assert(!/Projects|Project Memory|Git|Doctor|Secure MCP|AI Work|Autopilot/i.test(packagedConnectHtml), 'packaged AWH Agent bridge leaks advanced desktop controls');
const packagedPackage = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
assert(packagedPackage.version === EXPECTED_VERSION, 'packaged package version is not 1.0.0-rc.1');
assert(packagedPackage.productName === EXPECTED_PRODUCT, 'packaged productName is not AWH');
let runtime;
if (platform !== process.platform) runtime = { status: 'SKIP_PLATFORM', reason: `Packaged ${platform}/${architecture} executable cannot run on ${process.platform}/${process.arch}` };
else if (process.arch !== architecture) runtime = { status: 'SKIP_ARCH', reason: `Packaged ${platform}/${architecture} executable cannot run natively on ${process.platform}/${process.arch}` };
else runtime = await verifyNodeMode(executable, asarPath);
const artifact = await hashTree(bundle);
assert(artifact.size < MAX_BUNDLE_BYTES, `packaged ${platform} bundle is unexpectedly large: ${artifact.size} bytes`);
console.log(JSON.stringify({ platform, architecture, artifactPath: bundle, artifactName: platform === 'darwin' ? ('AWH Agent-macOS-' + architecture) : 'AWH Agent-win32-x64', artifactHash: artifact.hash, artifactSize: artifact.size, asarPath, asarHash: createHash('sha256').update(await readFile(asarPath)).digest('hex'), version: packagedPackage.version, productName: packagedPackage.productName, runtime }));
