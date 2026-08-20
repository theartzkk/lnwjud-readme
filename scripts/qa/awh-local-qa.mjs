#!/usr/bin/env node

import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { platform, arch } from 'node:os';
import { fileURLToPath } from 'node:url';
import { npmLaunchSpec } from './lib/npm-runtime.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT_DIR = join(ROOT, '.awh-local', 'qa');
const mode = process.argv[2] ?? 'local';
const VALID_MODES = new Set(['fast', 'local', 'full']);
const startedAt = new Date();
const checks = [];
const toolState = {};

if (!VALID_MODES.has(mode)) {
  console.error('Usage: node scripts/qa/awh-local-qa.mjs <fast|local|full>');
  process.exitCode = 2;
}

function durationSince(start) { return Math.max(0, Date.now() - start); }

function check(id, status, summary, started) {
  checks.push({ id, status, durationMs: durationSince(started), summary });
}

async function exists(path) {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

function safeEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  // The QA child process must never inherit enabled local capabilities.
  env.ART_AGENT_ALLOW_WRITE = '0';
  env.ART_AGENT_ALLOW_EXEC = '0';
  env.ART_AGENT_ALLOW_CODEX = '0';
  delete env.ART_AGENT_SMOKE_TEST;
  delete env.ELECTRON_ENABLE_LOGGING;
  return env;
}

function pathCandidates(command) {
  const names = process.platform === 'win32' ? [command, `${command}.cmd`, `${command}.exe`] : [command];
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  return dirs.flatMap((dir) => names.map((name) => join(dir, name)));
}

function commonToolCandidates(command) {
  if (process.platform === 'win32') return [];
  return command === 'php'
    ? ['/opt/local/bin/php', '/opt/homebrew/bin/php', '/usr/local/bin/php', '/usr/bin/php']
    : [];
}

async function resolveCommand(command) {
  for (const candidate of [...pathCandidates(command), ...commonToolCandidates(command)]) {
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

function nodeSource(path) {
  const normalized = path.replaceAll('\\', '/');
  if (normalized.includes('/.cache/codex-runtimes/') || normalized.includes('/ChatGPT.app/')) return 'embedded/bundled application runtime';
  if (normalized.includes('/.nvm/') || normalized.includes('/.fnm/') || normalized.includes('/.asdf/')) return 'user-managed Node runtime';
  if (normalized.includes('/opt/homebrew/') || normalized.includes('/usr/local/Cellar/') || normalized.includes('/usr/local/opt/')) return 'Homebrew Node runtime';
  if (normalized.startsWith('/usr/bin/') || normalized.startsWith('/System/')) return 'system Node runtime';
  return 'user-installed Node runtime (source not otherwise identified)';
}

async function discoverNpm() {
  const pathNpm = await resolveCommand('npm');
  const nodeDir = dirname(process.execPath);
  const candidates = [
    pathNpm,
    join(nodeDir, 'npm'),
    join(nodeDir, 'npm.cmd'),
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    '/usr/local/bin/npm', '/opt/homebrew/bin/npm', '/opt/local/bin/npm', '/usr/bin/npm',
    '/usr/local/opt/node/bin/npm', '/opt/homebrew/opt/node/bin/npm',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue;
    const launch = npmLaunchSpec(candidate, process.execPath);
    return { ...launch, source: candidate === pathNpm && launch.source === 'native executable' ? 'PATH' : launch.source };
  }
  return null;
}

function probe(executable, args, timeoutMs = 5_000) {
  return new Promise((resolveResult) => {
    const child = spawn(executable, args, {
      cwd: ROOT,
      env: safeEnv(),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => { child.kill(); resolveResult({ code: -1, output: '' }); }, timeoutMs);
    const collect = (chunk) => { if (output.length < 4096) output += String(chunk).slice(0, 4096 - output.length); };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', () => { clearTimeout(timer); resolveResult({ code: -1, output: '' }); });
    child.once('close', (code) => { clearTimeout(timer); resolveResult({ code: code ?? -1, output: output.trim() }); });
  });
}

async function toolVersion(info) {
  if (!info) return null;
  const result = await probe(info.executable, [...info.argsPrefix, '--version']);
  return result.code === 0 ? result.output.split(/\r?\n/, 1)[0]?.trim() || null : null;
}

function run(executable, args, options = {}) {
  return new Promise((resolveResult) => {
    const child = spawn(executable, args, {
      cwd: ROOT,
      env: safeEnv(options.env),
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
      else child.kill();
    }, options.timeoutMs ?? 15 * 60_000);
    child.once('error', () => { clearTimeout(timer); resolveResult({ code: -1, timedOut }); });
    child.once('close', (code) => { clearTimeout(timer); resolveResult({ code: code ?? -1, timedOut }); });
  });
}

async function runScript(script, timeoutMs = 15 * 60_000) {
  const npm = await discoverNpm();
  if (npm) return run(npm.executable, [...npm.argsPrefix, 'run', script], { timeoutMs });

  // The orchestrator remains usable in managed/offline workspaces where Node is
  // present but npm is not on PATH. These are fixed equivalents of package.json
  // scripts, not user-provided commands.
  const tsc = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  const tsx = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const testFiles = [
    'test/security.test.ts', 'test/files.test.ts', 'test/git.test.ts', 'test/process.test.ts',
    'test/changes.test.ts', 'test/tasks.test.ts', 'test/project.test.ts', 'test/project-registry.test.ts', 'test/hub-contract.test.ts', 'test/device-identity.test.ts', 'test/web-preview.test.ts', 'test/stdio.test.ts',
    'test/tunnel.test.ts', 'test/codex.test.ts', 'test/settings.test.ts', 'test/deployment-foundation.test.ts', 'test/qa-toolchain.test.ts', 'test/desktop.test.ts', 'test/desktop-projects.test.ts',
    'test/version.test.ts', 'test/installer.test.ts',
  ];
  if (script === 'typecheck') return (await exists(tsc)) ? run(process.execPath, [tsc, '-p', 'tsconfig.json', '--noEmit'], { timeoutMs }) : { code: -1, unavailable: true };
  if (script === 'build') return (await exists(tsc)) ? run(process.execPath, [tsc, '-p', 'tsconfig.json'], { timeoutMs }) : { code: -1, unavailable: true };
  if (script === 'test') return (await exists(tsx)) ? run(process.execPath, ['--import', tsx, '--test', ...testFiles], { timeoutMs }) : { code: -1, unavailable: true };
  if (script === 'desktop:smoke') {
    const electron = join(ROOT, 'node_modules', 'electron', 'cli.js');
    return (await exists(electron)) ? run(process.execPath, [electron, '.', '--smoke-test'], { timeoutMs }) : { code: -1, unavailable: true };
  }
  return { code: -1, unavailable: true };
}

async function runNodeTest(files, timeoutMs = 15 * 60_000) {
  return run(process.execPath, ['--import', 'tsx', '--test', ...files], { timeoutMs });
}

async function toolchainCheck() {
  const started = Date.now();
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  const source = nodeSource(process.execPath);
  toolState.node = { path: process.execPath, version: process.version, source };
  check('node', major >= 20 ? 'PASS' : 'FAIL', `Node ${process.version}; path=${process.execPath}; source=${source}`, started);

  const runtimeStatus = source.startsWith('embedded/') ? 'FAIL' : 'PASS';
  check('node-runtime', runtimeStatus, runtimeStatus === 'PASS' ? `stable user/system Node runtime detected (${source})` : `ENVIRONMENT BLOCKER: active Node is embedded/bundled; install a normal user Node+npm runtime`, started);

  const npmStarted = Date.now();
  const npm = await discoverNpm();
  if (!npm) {
    toolState.npm = { available: false, path: null, version: null };
    check('npm', 'FAIL', 'ENVIRONMENT BLOCKER: stable npm runtime not available (not in PATH, next to Node, or common macOS locations)', npmStarted);
  } else {
    const version = await toolVersion(npm);
    toolState.npm = { available: version !== null, path: npm.path, version, source: npm.source };
    check('npm', version ? 'PASS' : 'FAIL', version ? `npm ${version}; path=${npm.path}; source=${npm.source}` : `ENVIRONMENT BLOCKER: npm found at ${npm.path} but did not answer --version`, npmStarted);
  }

  const gitStarted = Date.now();
  const git = await resolveCommand('git');
  const gitVersion = git ? await toolVersion({ path: git, executable: git, argsPrefix: [] }) : null;
  toolState.git = { available: gitVersion !== null, path: git ?? null, version: gitVersion };
  check('git-tool', git && gitVersion ? 'PASS' : 'FAIL', git && gitVersion ? `${gitVersion}; path=${git}` : 'ENVIRONMENT BLOCKER: Git executable is not available', gitStarted);

  const corepackStarted = Date.now();
  const corepack = await resolveCommand('corepack');
  const corepackVersion = corepack ? await toolVersion({ path: corepack, executable: corepack, argsPrefix: [] }) : null;
  check('corepack', corepack && corepackVersion ? 'PASS' : 'SKIP', corepack && corepackVersion ? `Corepack ${corepackVersion}; path=${corepack}` : 'Corepack not available; optional and not required by AWH QA', corepackStarted);

  const optional = [
    ['php', 'PHP'],
    ['python3', 'Python'],
    ['ffmpeg', 'FFmpeg'],
  ];
  for (const [command, label] of optional) {
    const optionalStarted = Date.now();
    const path = await resolveCommand(command);
    const version = path ? await toolVersion({ path, executable: path, argsPrefix: [] }) : null;
    check(command, path && version ? 'PASS' : 'SKIP', path && version ? `${label} ${version}; path=${path}; optional` : `${label} not available; optional future runtime tool`, optionalStarted);
  }
  const remotionStarted = Date.now();
  check('remotion', 'SKIP', 'Remotion readiness is not required and is not evaluated without project dependencies', remotionStarted);
}

async function dependencyCheck() {
  const started = Date.now();
  const installed = await exists(join(ROOT, 'node_modules'));
  check('dependencies', installed ? 'PASS' : 'FAIL', installed ? 'node_modules is present' : 'ENVIRONMENT BLOCKER: node_modules is absent; install dependencies with the normal Node+npm runtime', started);
  return installed;
}

function blockedCheck(id, summary) {
  const started = Date.now();
  check(id, 'FAIL', `ENVIRONMENT BLOCKER: ${summary}`, started);
}

async function lockCheck() {
  const started = Date.now();
  try {
    const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
    const lock = JSON.parse(await readFile(join(ROOT, 'package-lock.json'), 'utf8'));
    const root = lock.packages?.[''];
    const same = root && root.name === pkg.name && root.version === pkg.version &&
      JSON.stringify(root.dependencies ?? {}) === JSON.stringify(pkg.dependencies ?? {}) &&
      JSON.stringify(root.devDependencies ?? {}) === JSON.stringify(pkg.devDependencies ?? {});
    if (!same || lock.lockfileVersion !== 3) throw new Error('package-lock root metadata does not match package.json');
    const npm = await discoverNpm();
    if (npm) {
      const result = await run(npm.executable, [...npm.argsPrefix, 'ci', '--dry-run', '--ignore-scripts', '--no-audit', '--no-fund', '--offline'], { timeoutMs: 60_000 });
      check('lockfile', result.code === 0 ? 'PASS' : 'FAIL', result.code === 0 ? 'package.json/package-lock.json match and npm ci dry-run passed offline' : 'npm ci dry-run failed offline', started);
    } else {
      check('lockfile', 'PASS', 'package.json/package-lock.json root metadata matches; npm executable unavailable for dry-run', started);
    }
  } catch {
    check('lockfile', 'FAIL', 'package.json/package-lock.json consistency check failed', started);
  }
}

async function scriptCheck(id, script, summary, timeoutMs) {
  const started = Date.now();
  const result = await runScript(script, timeoutMs);
  check(id, result.code === 0 ? 'PASS' : 'FAIL', result.unavailable ? `${id} gate could not run; required local tool is unavailable` : result.timedOut ? `${id} gate timed out` : result.code === 0 ? summary : `${id} gate failed; exit code ${result.code}`, started);
  return result.code === 0;
}

async function requiredFilesCheck() {
  const started = Date.now();
  const required = [
    'package.json', 'package-lock.json', 'tsconfig.json', 'forge.config.cjs',
    '.github/workflows/ci.yml', '.github/scripts/verify-packaged-mcp.ps1',
    'src/security.ts', 'src/stdio.ts', 'src/tunnel.ts', 'src/tasks.ts', 'src/files.ts', 'src/git.ts',
    'desktop/index.html', 'desktop/preload.cjs', 'src/desktop/main.ts', 'web/index.html', 'web/app.js', 'web/styles.css', 'web/hub-read-adapter.js', 'scripts/build-web-preview.ts',
    'hub/schema.sql', 'hub/public/index.php', 'hub/public/web-gateway.php', 'hub/src/HubReadModel.php', 'hub/src/HubReadRouter.php', 'hub/src/HubWebGateway.php', 'hub/src/HubEnrollmentService.php', 'hub/bin/index-project.php', 'hub/tests/read-foundation.php', 'deploy/nginx/awh-preview.conf',
  ];
  const missing = [];
  for (const path of required) if (!(await exists(join(ROOT, path)))) missing.push(path);
  check('project-files', missing.length === 0 ? 'PASS' : 'FAIL', missing.length === 0 ? 'required source/configuration files are present' : `missing ${missing.join(', ')}`, started);
}

async function gitCheck() {
  const started = Date.now();
  const branch = await runGit(['branch', '--show-current']);
  const head = await runGit(['rev-parse', 'HEAD']);
  const status = await runGit(['status', '--porcelain']);
  const branchName = branch.stdout;
  const valid = branch.code === 0 && head.code === 0 && status.code === 0 && branchName === 'awh/v0.1-migration';
  check('git-state', valid ? 'PASS' : 'FAIL', valid ? `branch=${branchName}; HEAD=${head.stdout}; dirty=${Boolean(status.stdout)}` : 'local Git state could not be verified or branch is not awh/v0.1-migration', started);
  return { branch: branchName || null, head: head.stdout || null, dirty: Boolean(status.stdout) };
}

async function runGit(args) {
  const git = await resolveCommand('git');
  if (!git) return { code: -1, stdout: '' };
  return new Promise((resolveResult) => {
    const child = spawn(git, args, { cwd: ROOT, env: safeEnv(), shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.once('error', () => resolveResult({ code: -1, stdout: '' }));
    child.once('close', (code) => resolveResult({ code: code ?? -1, stdout: stdout.trim() }));
  });
}

async function securityBoundaryCheck() {
  const started = Date.now();
  const result = await runNodeTest(['test/security.test.ts', 'test/codex.test.ts', 'test/process.test.ts']);
  check('security-boundary', result.code === 0 ? 'PASS' : 'FAIL', result.code === 0 ? 'path, secret, process and Codex boundary tests passed' : 'security boundary tests failed', started);
}

async function mcpIsolationCheck() {
  const started = Date.now();
  const result = await runNodeTest(['test/stdio.test.ts', 'test/tunnel.test.ts']);
  check('mcp-isolation', result.code === 0 ? 'PASS' : 'FAIL', result.code === 0 ? 'MCP stdio and remote-readonly isolation tests passed' : 'MCP or remote-readonly isolation tests failed', started);
}

async function phpHubCheck() {
  const started = Date.now();
  const php = await resolveCommand('php');
  if (!php) {
    check('php-hub', 'FAIL', 'PHP runtime is required to validate the local Hub read foundation', started);
    return;
  }
  const syntaxFiles = ['hub/src/HubReadModel.php', 'hub/src/HubReadRouter.php', 'hub/src/HubWebGateway.php', 'hub/src/HubEnrollmentService.php', 'hub/public/index.php', 'hub/public/web-gateway.php', 'hub/bin/index-project.php'];
  for (const file of syntaxFiles) {
    const result = await run(php, ['-l', join(ROOT, file)], { timeoutMs: 15_000 });
    if (result.code !== 0) {
      check('php-hub', 'FAIL', `PHP syntax failed for ${file}`, started);
      return;
    }
  }
  const sqliteDriver = await run(php, ['-r', 'exit(in_array("sqlite", PDO::getAvailableDrivers(), true) ? 0 : 1);'], { timeoutMs: 15_000 });
  if (sqliteDriver.code !== 0) {
    const sqlite = await resolveCommand('sqlite3');
    const schema = sqlite ? await run(sqlite, [':memory:', `.read ${join(ROOT, 'hub', 'schema.sql')}`], { timeoutMs: 15_000 }) : { code: -1 };
    check('php-hub', sqlite?.length && schema.code === 0 ? 'SKIP' : 'FAIL', sqlite?.length && schema.code === 0 ? 'PHP syntax passed; pdo_sqlite is unavailable, SQLite schema smoke passed with the local sqlite3 tool' : 'PHP syntax passed but neither pdo_sqlite nor a local SQLite schema tool is available', started);
    return;
  }
  const test = await run(php, [join(ROOT, 'hub', 'tests', 'read-foundation.php')], { timeoutMs: 60_000 });
  check('php-hub', test.code === 0 ? 'PASS' : 'FAIL', test.code === 0 ? 'PHP Hub read foundation syntax and security tests passed' : 'PHP Hub read foundation tests failed', started);
}

async function desktopReadinessCheck(dependenciesReady) {
  const started = Date.now();
  if (!dependenciesReady) {
    check('desktop-runtime', 'FAIL', 'ENVIRONMENT BLOCKER: Electron runtime cannot be evaluated while node_modules is absent', started);
    return;
  }
  const electron = await exists(join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron'));
  const sourceReady = await Promise.all(['src/desktop/main.ts', 'desktop/index.html', 'desktop/preload.cjs', 'desktop/renderer.js'].map((file) => exists(join(ROOT, file))));
  if (!sourceReady.every(Boolean)) check('desktop-runtime', 'FAIL', 'desktop source/runtime files are incomplete', started);
  else if (!electron) check('desktop-runtime', 'FAIL', 'ENVIRONMENT BLOCKER: desktop source is present but Electron runtime is not installed', started);
  else check('desktop-runtime', 'PASS', `desktop source and Electron runtime are present for ${process.platform}/${process.arch}`, started);
}

async function desktopSmokeCheck(dependenciesReady) {
  const started = Date.now();
  if (!dependenciesReady) {
    check('desktop-smoke', 'FAIL', 'ENVIRONMENT BLOCKER: Electron desktop smoke requires installed project dependencies', started);
    return;
  }
  if (process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux') {
    const result = await runScript('desktop:smoke', 45_000);
    check('desktop-smoke', result.code === 0 ? 'PASS' : 'FAIL', result.code === 0 ? 'Electron desktop smoke marker passed' : 'Electron desktop smoke did not pass', started);
    return;
  }
  check('desktop-smoke', 'SKIP_PLATFORM', `desktop smoke is not supported on ${process.platform}`, started);
}

async function installerCheck() {
  const started = Date.now();
  if (process.platform !== 'win32') {
    check('windows-installer', 'SKIP_PLATFORM', 'Windows installer verification is not run on macOS/Linux', started);
    return;
  }
  const result = await scriptCheck('windows-installer-build', 'desktop:make', 'Windows package/installer build and verification', 20 * 60_000);
  if (!result) return;
  const out = join(ROOT, 'out');
  const { readdir } = await import('node:fs/promises');
  const found = new Map();
  async function walk(path) {
    if (!(await exists(path))) return;
    const info = await stat(path);
    if (info.isFile()) {
      const name = path.split('\\').pop() ?? path.split('/').pop();
      if (['ArtAgent.exe', 'ArtAgentSetup.exe', 'RELEASES'].includes(name) || name?.endsWith('.nupkg')) found.set(name, path);
      return;
    }
    if (info.isDirectory()) for (const entry of await readdir(path)) await walk(join(path, entry));
  }
  await walk(out);
  const required = ['ArtAgent.exe', 'ArtAgentSetup.exe', 'RELEASES'];
  const missing = required.filter((name) => !found.has(name));
  check('windows-installer-files', missing.length === 0 && [...found.keys()].some((name) => name.endsWith('.nupkg')) ? 'PASS' : 'FAIL', missing.length === 0 ? 'packaged executable, Squirrel installer, RELEASES and nupkg are present' : `installer output missing ${missing.join(', ')}`, started);

  const verifierStarted = Date.now();
  const pwsh = await resolveCommand('pwsh');
  let version = '0.0.0';
  try { version = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version; } catch { /* file gate already reports the root cause */ }
  if (!pwsh) {
    check('packaged-mcp', 'FAIL', 'PowerShell is unavailable for the existing packaged MCP verifier', verifierStarted);
  } else {
    const verify = await run(pwsh, ['-NoProfile', '-File', join(ROOT, '.github', 'scripts', 'verify-packaged-mcp.ps1'), '-Version', version], { timeoutMs: 60_000 });
    check('packaged-mcp', verify.code === 0 ? 'PASS' : 'FAIL', verify.code === 0 ? 'existing packaged MCP PowerShell verifier passed' : 'existing packaged MCP PowerShell verifier failed', verifierStarted);
  }
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await toolchainCheck();
  await lockCheck();
  const dependenciesReady = await dependencyCheck();
  if (dependenciesReady) {
    await scriptCheck('typescript', 'typecheck', 'TypeScript typecheck passed');
    await scriptCheck('tests', 'test', 'unit and security test suite passed');
    await scriptCheck('build', 'build', 'production TypeScript build passed');
  } else {
    blockedCheck('typescript', 'TypeScript requires installed npm dependencies');
    blockedCheck('tests', 'Tests require installed npm dependencies');
    blockedCheck('build', 'Build requires installed npm dependencies');
  }

  let git = { branch: null, head: null, dirty: false };
  git = await gitCheck();
  if (mode !== 'fast') {
    await requiredFilesCheck();
    await desktopReadinessCheck(dependenciesReady);
    if (dependenciesReady) {
      await securityBoundaryCheck();
      await mcpIsolationCheck();
      await phpHubCheck();
    } else {
      blockedCheck('security-boundary', 'Security tests require installed npm dependencies');
      blockedCheck('mcp-isolation', 'MCP isolation tests require installed npm dependencies');
    }
  }
  if (mode === 'full') {
    await desktopSmokeCheck(dependenciesReady);
    await installerCheck();
  }

  const failed = checks.some((item) => item.status === 'FAIL');
  const environmentNotReady = checks.some((item) => item.summary.includes('ENVIRONMENT BLOCKER'));
  const result = environmentNotReady ? 'ENVIRONMENT_NOT_READY' : failed ? 'FAIL' : 'PASS';
  const completedAt = new Date();
  const payload = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    platform: platform(),
    arch: arch(),
    nodeVersion: process.versions.node,
    branch: git.branch,
    head: git.head,
    dirty: git.dirty,
    result,
    tools: toolState,
    checks,
  };
  const lines = [
    'AWH LOCAL QA',
    `Platform: ${platform()} ${arch()}`,
    `Git branch: ${git.branch ?? 'unavailable'}`,
    `Git HEAD: ${git.head ?? 'unavailable'}`,
    `Environment: ${environmentNotReady ? 'NOT_READY' : 'READY'}`,
    '',
    ...checks.map((item) => `[${item.status}] ${item.id}: ${item.summary}`),
    '',
    `RESULT: ${result}`,
  ];
  const summary = `${lines.join('\n')}\n`;
  await writeFile(join(OUTPUT_DIR, 'latest.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await writeFile(join(OUTPUT_DIR, 'latest.log'), summary, 'utf8');
  process.stdout.write(summary);
  process.exitCode = failed ? 1 : 0;
}

if (VALID_MODES.has(mode)) await main();
