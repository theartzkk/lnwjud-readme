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
  return ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', '/usr/bin', '/bin'].map((dir) => join(dir, command));
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

async function toolVersion(info, args = ['--version']) {
  if (!info) return null;
  const result = await probe(info.executable, [...info.argsPrefix, ...args]);
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
    'test/tunnel.test.ts', 'test/codex.test.ts', 'test/settings.test.ts', 'test/deployment-foundation.test.ts', 'test/m4-control-plane.test.ts', 'test/control-plane-worker-client.test.ts', 'test/control-plane-worker-runtime.test.ts', 'test/qa-toolchain.test.ts', 'test/desktop.test.ts', 'test/desktop-projects.test.ts', 'test/credential-store.test.ts', 'test/enrollment-client.test.ts', 'test/bootstrap-provisioning.test.ts', 'test/bootstrap-orchestration.test.ts', 'test/autopilot.test.ts', 'test/first-run.test.ts', 'test/video.test.ts', 'test/release-identity.test.ts',
    'test/version.test.ts', 'test/installer.test.ts', 'test/central-project-authority-deployment.test.ts',
  ];
  if (script === 'typecheck') return (await exists(tsc)) ? run(process.execPath, [tsc, '-p', 'tsconfig.json', '--noEmit'], { timeoutMs }) : { code: -1, unavailable: true };
  if (script === 'build') return (await exists(tsc)) ? run(process.execPath, [tsc, '-p', 'tsconfig.json'], { timeoutMs }) : { code: -1, unavailable: true };
  if (script === 'test') return (await exists(tsx)) ? run(process.execPath, ['--test-concurrency=1', '--import', tsx, '--test', ...testFiles], { timeoutMs }) : { code: -1, unavailable: true };
  if (script === 'desktop:smoke') {
    const smoke = join(ROOT, 'scripts', 'desktop-smoke.mjs');
    return (await exists(smoke)) ? run(process.execPath, [smoke], { timeoutMs }) : { code: -1, unavailable: true };
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
  ];
  for (const [command, label] of optional) {
    const optionalStarted = Date.now();
    const path = await resolveCommand(command);
    const version = path ? await toolVersion({ path, executable: path, argsPrefix: [] }, command === 'ffmpeg' ? ['-version'] : ['--version']) : null;
    check(command, path && version ? 'PASS' : 'SKIP', path && version ? `${label} ${version}; path=${path}; optional` : `${label} not available; optional future runtime tool`, optionalStarted);
  }
  const ffmpegStarted = Date.now();
  const ffmpegPath = await resolveCommand('ffmpeg');
  const ffprobePath = await resolveCommand('ffprobe');
  const ffmpegVersion = ffmpegPath ? await toolVersion({ path: ffmpegPath, executable: ffmpegPath, argsPrefix: [] }, ['-version']) : null;
  const ffprobeVersion = ffprobePath ? await toolVersion({ path: ffprobePath, executable: ffprobePath, argsPrefix: [] }, ['-version']) : null;
  toolState.ffmpeg = { available: false, path: ffmpegPath ?? null, ffprobePath: ffprobePath ?? null, version: ffmpegVersion, ffprobeVersion };
  if (!ffmpegPath && !ffprobePath) {
    check('ffmpeg', 'SKIP', 'FFmpeg/FFprobe not available; video pipeline is optional on this device', ffmpegStarted);
  } else if (!ffmpegPath || !ffprobePath || !ffmpegVersion || !ffprobeVersion) {
    check('ffmpeg', 'FAIL', 'FFmpeg/FFprobe installation is incomplete or version probes failed', ffmpegStarted);
  } else {
    const result = await run(process.execPath, ['--import', 'tsx', join(ROOT, 'scripts', 'qa', 'video-e2e.mjs')], { timeoutMs: 90_000 });
    const passed = result.code === 0;
    toolState.ffmpeg.available = passed;
    check('ffmpeg', passed ? 'PASS' : 'FAIL', passed ? `FFmpeg/FFprobe frame-sequence E2E passed; ffmpeg=${ffmpegPath}; ffprobe=${ffprobePath}` : `FFmpeg/FFprobe frame-sequence E2E failed; exit code ${result.code}`, ffmpegStarted);
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
    'src/security.ts', 'src/stdio.ts', 'src/tunnel.ts', 'src/tasks.ts', 'src/files.ts', 'src/git.ts', 'src/autopilot.ts', 'src/artifacts.ts', 'src/continuity.ts', 'src/workspace-continuity.ts', 'src/first-run.ts', 'src/video.ts', 'scripts/qa/video-e2e.mjs', 'scripts/qa/verify-packaged-bundle.mjs', 'scripts/qa/run-hub-tests.mjs', 'scripts/prepare-macos-icon.mjs', 'scripts/prepare-windows-icon.mjs',
    'desktop/index.html', 'desktop/preload.cjs', 'src/desktop/main.ts', 'src/control-plane-worker-runtime.ts', 'web/index.html', 'web/app.js', 'web/navigation.js', 'web/styles.css', 'web/responsive-layout.css', 'web/hub-read-adapter.js', 'web/manifest.webmanifest', 'web/sw.js', 'scripts/build-web-preview.ts', 'scripts/create-web-release-manifest.mjs', 'scripts/desktop-smoke.mjs',
    'hub/schema.sql', 'hub/migrations/001_m3e_enrollment.sql', 'hub/migrations/002_m3e2_enrollment_api.sql', 'hub/migrations/003_m4_control_plane.sql', 'hub/migrations/004_owner_auth.sql', 'hub/migrations/005_assistant_workstream.sql', 'hub/migrations/006_workspace_continuity.sql', 'hub/migrations/007_unified_workspace.sql', 'hub/migrations/008_final_product.sql', 'hub/migrations/009_founding_memory.sql', 'hub/migrations/010_self_service.sql', 'hub/public/index.php', 'hub/public/web-gateway.php', 'hub/public/enrollment.php', 'hub/public/control-plane.php', 'hub/src/HubReadModel.php', 'hub/src/HubReadRouter.php', 'hub/src/HubWebGateway.php', 'hub/src/HubEnrollmentService.php', 'hub/src/HubEnrollmentRouter.php', 'hub/src/HubSchemaMigration.php', 'hub/src/HubEnrollmentApiMigration.php', 'hub/src/HubControlPlaneMigration.php', 'hub/src/HubControlPlaneService.php', 'hub/src/HubThaiGovernmentDocumentService.php', 'hub/assets/thai-government-garuda-v7.png', 'hub/src/HubControlPlaneRouter.php', 'hub/src/HubBrowserOriginPolicy.php', 'hub/src/HubControlPlaneProjectRegistration.php', 'hub/src/HubOwnerAuthMigration.php', 'hub/src/HubOwnerAuthService.php', 'hub/src/HubOwnerAuthRouter.php', 'hub/src/HubAssistantWorkstreamMigration.php', 'hub/src/HubWorkspaceContinuityMigration.php', 'hub/src/HubUnifiedWorkspaceMigration.php', 'hub/src/HubFinalProductMigration.php', 'hub/src/HubFoundingMemorySeed.php', 'hub/src/HubFoundingMemoryMigration.php', 'hub/src/HubFoundingMemoryService.php', 'hub/src/HubSelfServiceMigration.php', 'hub/src/HubProviderCredentialStore.php', 'hub/bin/index-project.php', 'hub/bin/migrate-m3e.php', 'hub/bin/migrate-m3e2.php', 'hub/bin/migrate-m4.php', 'hub/bin/migrate-owner-auth.php', 'hub/bin/migrate-assistant-workstream.php', 'hub/bin/migrate-workspace-continuity.php', 'hub/bin/migrate-unified-workspace.php', 'hub/bin/migrate-final-product.php', 'hub/bin/migrate-founding-memory.php', 'hub/bin/migrate-self-service.php', 'hub/bin/register-m4-projects.php', 'hub/bin/setup-owner-auth.php', 'hub/bin/verify-owner-auth-runtime.php', 'hub/tests/read-foundation.php', 'hub/tests/m3e-migration.php', 'hub/tests/m3e2-migration.php', 'hub/tests/enrollment-api.php', 'hub/tests/m4-control-plane.php', 'hub/tests/m4-zero-project-control.php', 'hub/tests/m4-project-registration.php', 'hub/tests/owner-auth.php', 'hub/tests/owner-auth-rollback.php', 'hub/tests/m6-assistant-workstream.php', 'hub/tests/m7-workspace-continuity.php', 'hub/tests/m8-unified-workspace.php', 'hub/tests/m9-final-product.php', 'hub/tests/m10-founding-memory.php', 'hub/tests/m11-self-service.php', 'hub/tests/m11-production-parity.php', 'src/enrollment-client.ts', 'src/control-plane-worker-client.ts', 'src/credential-store.ts', 'scripts/deploy/provision-bootstrap-hash.mjs', 'scripts/deploy/bootstrap-owner.mjs', 'scripts/ops/activate-owner-auth.mjs', 'docs/M3E2_ENROLLMENT_API.md', 'docs/M3E_FINAL_PRODUCTION_VALIDATION.md', 'docs/M4_CONTROL_PLANE_ACTIVATION.md', 'docs/OWNER_AUTH_ACTIVATION.md', 'docs/OWNER_DATA_RECOVERY.md', 'deploy/nginx/awh-preview.conf', 'deploy/nginx/awh-enrollment.conf', 'deploy/nginx/awh-control-plane.conf', 'deploy/nginx/render-control-plane-include.php', 'deploy/nginx/transform-owner-auth.php', 'deploy/php-fpm/awh-enrollment.pool.conf', 'deploy/awh-enrollment/deploy-enrollment.sh', 'deploy/awh-enrollment/preflight-production.sh', 'deploy/awh-enrollment/remote-deploy.sh', 'deploy/awh-enrollment/insert-nginx-include.php', 'deploy/awh-control-plane/deploy-control-plane.sh', 'deploy/awh-control-plane/remote-deploy-control-plane.sh', 'test/owner-auth-deployment.test.ts', 'test/founding-memory-deployment.test.ts', 'test/self-service-deployment.test.ts',
  ];
  const m12Required = [
    'hub/migrations/011_central_project_authority.sql', 'hub/src/HubCentralProjectAuthorityMigration.php',
    'hub/src/HubProjectVault.php', 'hub/src/HubProjectVaultService.php', 'hub/src/HubDurableExecutionService.php', 'hub/src/HubStorageGovernanceService.php', 'hub/src/HubExecutionTriageService.php', 'hub/src/HubStaffGovernorService.php', 'hub/src/HubStaffOperationsService.php',
    'hub/bin/migrate-central-project-authority.php', 'hub/bin/awh-native-executor.php', 'hub/bin/sync-deployed-source-vault.php', 'hub/tests/m12-central-project-authority.php', 'hub/tests/m12-production-parity.php', 'hub/tests/staff-governor-loop.php',
    'deploy/systemd/awh-native-executor.service', 'deploy/systemd/awh-native-executor.timer', 'deploy/awh-control-plane/verify-web-release.php', 'deploy/awh-control-plane/validate-remote-output.sh', 'test/central-project-authority-deployment.test.ts', 'test/final-uat-shell.test.ts', 'test/mobile-horizontal-overflow.test.ts',
  ];
  const missing = [];
  for (const path of [...required, ...m12Required]) if (!(await exists(join(ROOT, path)))) missing.push(path);
  check('project-files', missing.length === 0 ? 'PASS' : 'FAIL', missing.length === 0 ? 'required source/configuration files are present' : `missing ${missing.join(', ')}`, started);
}

async function gitCheck() {
  const started = Date.now();
  const branch = await runGit(['branch', '--show-current']);
  const head = await runGit(['rev-parse', 'HEAD']);
  const status = await runGit(['status', '--porcelain']);
  const upstream = await runGit(['rev-parse', '@{u}']);
  const branchName = branch.stdout;
  const clean = status.code === 0 && status.stdout === '';
  const tracked = upstream.code === 0 && upstream.stdout !== '';
  const exactRemote = tracked && head.stdout === upstream.stdout;
  const validHead = /^[0-9a-f]{40}$/i.test(head.stdout);
  const validBranch = branchName.length > 0 && branchName.length <= 200 && !/[\s\0]/.test(branchName);
  const baseValid = branch.code === 0 && head.code === 0 && status.code === 0 && validHead && validBranch;
  const valid = mode === 'fast' ? baseValid : baseValid && clean && exactRemote;
  const detail = mode === 'fast'
    ? `branch=${branchName}; HEAD=${head.stdout}; dirty=${!clean}; fastMode=true`
    : `branch=${branchName}; HEAD=${head.stdout}; clean=${clean}; upstreamExact=${exactRemote}`;
  check('git-state', valid ? 'PASS' : 'FAIL', valid ? detail : `Git state is not valid for ${mode} QA (branch=${branchName || 'DETACHED'}; clean=${clean}; upstreamExact=${exactRemote})`, started);
  return { branch: branchName || null, head: head.stdout || null, dirty: !clean, upstream: tracked ? upstream.stdout : null, upstreamExact: exactRemote };
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
  const syntaxFiles = ['hub/src/HubReadModel.php', 'hub/src/HubReadRouter.php', 'hub/src/HubWebGateway.php', 'hub/src/HubEnrollmentService.php', 'hub/src/HubEnrollmentRouter.php', 'hub/src/HubSchemaMigration.php', 'hub/src/HubEnrollmentApiMigration.php', 'hub/src/HubControlPlaneMigration.php', 'hub/src/HubControlPlaneService.php', 'hub/src/HubThaiGovernmentDocumentService.php', 'hub/src/HubControlPlaneRouter.php', 'hub/src/HubControlPlaneProjectRegistration.php', 'hub/src/HubOwnerAuthMigration.php', 'hub/src/HubOwnerAuthService.php', 'hub/src/HubOwnerAuthRouter.php', 'hub/src/HubAssistantWorkstreamMigration.php', 'hub/src/HubWorkspaceContinuityMigration.php', 'hub/src/HubUnifiedWorkspaceMigration.php', 'hub/src/HubFinalProductMigration.php', 'hub/src/HubFoundingMemorySeed.php', 'hub/src/HubFoundingMemoryMigration.php', 'hub/src/HubFoundingMemoryService.php', 'hub/src/HubSelfServiceMigration.php', 'hub/src/HubProviderCredentialStore.php', 'hub/src/HubAttachmentStore.php', 'hub/src/HubNativeAgentService.php', 'hub/public/index.php', 'hub/public/web-gateway.php', 'hub/public/enrollment.php', 'hub/public/control-plane.php', 'hub/bin/index-project.php', 'hub/bin/migrate-m3e.php', 'hub/bin/migrate-m3e2.php', 'hub/bin/migrate-m4.php', 'hub/bin/migrate-owner-auth.php', 'hub/bin/migrate-assistant-workstream.php', 'hub/bin/migrate-workspace-continuity.php', 'hub/bin/migrate-unified-workspace.php', 'hub/bin/migrate-final-product.php', 'hub/bin/migrate-founding-memory.php', 'hub/bin/migrate-self-service.php', 'hub/bin/register-m4-projects.php', 'hub/bin/setup-owner-auth.php', 'hub/bin/verify-owner-auth-runtime.php', 'hub/tests/m4-zero-project-control.php', 'hub/tests/m6-assistant-workstream.php', 'hub/tests/m7-workspace-continuity.php', 'hub/tests/m8-unified-workspace.php', 'hub/tests/m9-final-product.php', 'hub/tests/m10-founding-memory.php', 'hub/tests/m11-self-service.php', 'deploy/awh-enrollment/insert-nginx-include.php'];
  const m12Syntax = ['hub/src/HubCentralProjectAuthorityMigration.php', 'hub/src/HubProjectVault.php', 'hub/src/HubProjectVaultService.php', 'hub/src/HubDurableExecutionService.php', 'hub/src/HubStorageGovernanceService.php', 'hub/src/HubExecutionTriageService.php', 'hub/src/HubStaffGovernorService.php', 'hub/src/HubStaffOperationsService.php', 'hub/bin/migrate-central-project-authority.php', 'hub/bin/awh-native-executor.php', 'hub/tests/m12-central-project-authority.php', 'hub/tests/m12-production-parity.php', 'hub/tests/staff-operations.php', 'hub/tests/staff-governor-loop.php', 'hub/tests/m17-product-verticals.php', 'deploy/awh-control-plane/verify-web-release.php'];
  for (const file of [...syntaxFiles, ...m12Syntax]) {
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
  if (test.code !== 0) {
    check('php-hub', 'FAIL', 'PHP Hub read foundation tests failed', started);
    return;
  }
  const migration = await run(php, [join(ROOT, 'hub', 'tests', 'm3e-migration.php')], { timeoutMs: 60_000 });
  if (migration.code !== 0) {
    check('php-hub', 'FAIL', 'PHP Hub or M3E migration tests failed', started);
    return;
  }
  const apiMigration = await run(php, [join(ROOT, 'hub', 'tests', 'm3e2-migration.php')], { timeoutMs: 60_000 });
  if (apiMigration.code !== 0) {
    check('php-hub', 'FAIL', 'PHP M3E.2 migration tests failed', started);
    return;
  }
  const enrollment = await run(php, [join(ROOT, 'hub', 'tests', 'enrollment-api.php')], { timeoutMs: 60_000 });
  if (enrollment.code !== 0) { check('php-hub', 'FAIL', 'PHP enrollment API tests failed', started); return; }
  const control = await run(php, [join(ROOT, 'hub', 'tests', 'm4-control-plane.php')], { timeoutMs: 60_000 });
  if (control.code !== 0) { check('php-hub', 'FAIL', 'PHP M4 control-plane tests failed', started); return; }
  const projects = await run(php, [join(ROOT, 'hub', 'tests', 'm4-project-registration.php')], { timeoutMs: 60_000 });
  if (projects.code !== 0) { check('php-hub', 'FAIL', 'PHP M4 project registration tests failed', started); return; }
  const assistant = await run(php, [join(ROOT, 'hub', 'tests', 'm6-assistant-workstream.php')], { timeoutMs: 60_000 });
  if (assistant.code !== 0 && assistant.code !== 77) { check('php-hub', 'FAIL', 'PHP M6 assistant workstream tests failed', started); return; }
  const workspace = await run(php, [join(ROOT, 'hub', 'tests', 'm7-workspace-continuity.php')], { timeoutMs: 60_000 });
  if (workspace.code !== 0 && workspace.code !== 77) { check('php-hub', 'FAIL', 'PHP M7 workspace continuity tests failed', started); return; }
  const unified = await run(php, [join(ROOT, 'hub', 'tests', 'm8-unified-workspace.php')], { timeoutMs: 60_000 });
  if (unified.code !== 0 && unified.code !== 77) { check('php-hub', 'FAIL', 'PHP M8 unified workspace tests failed', started); return; }
  const finalProduct = await run(php, [join(ROOT, 'hub', 'tests', 'm9-final-product.php')], { timeoutMs: 60_000 });
  if (finalProduct.code !== 0 && finalProduct.code !== 77) { check('php-hub', 'FAIL', 'PHP M9 final product tests failed', started); return; }
  const foundingMemory = await run(php, [join(ROOT, 'hub', 'tests', 'm10-founding-memory.php')], { timeoutMs: 60_000 });
  if (foundingMemory.code !== 0 && foundingMemory.code !== 77) { check('php-hub', 'FAIL', 'PHP M10 Founding Memory tests failed', started); return; }
  const selfService = await run(php, [join(ROOT, 'hub', 'tests', 'm11-self-service.php')], { timeoutMs: 60_000 });
  if (selfService.code !== 0 && selfService.code !== 77) { check('php-hub', 'FAIL', 'PHP M11 self-service tests failed', started); return; }
  const central = await run(php, [join(ROOT, 'hub', 'tests', 'm12-central-project-authority.php')], { timeoutMs: 60_000 });
  if (central.code !== 0 && central.code !== 77) { check('php-hub', 'FAIL', 'PHP M12 central Project Authority tests failed', started); return; }
  const verticals = await run(php, [join(ROOT, 'hub', 'tests', 'm17-product-verticals.php')], { timeoutMs: 60_000 });
  if (verticals.code !== 0 && verticals.code !== 77) { check('php-hub', 'FAIL', 'PHP M17 product vertical tests failed', started); return; }
  const staffLoop = await run(php, [join(ROOT, 'hub', 'tests', 'staff-governor-loop.php')], { timeoutMs: 60_000 });
  check('php-hub', staffLoop.code === 0 || staffLoop.code === 77 ? 'PASS' : 'FAIL', staffLoop.code === 0 || staffLoop.code === 77 ? 'PHP Hub migrations, canonical product verticals, Staff Governor loop and integrity checks passed' : 'PHP Staff Governor field-loop tests failed', started);
}

async function fastQaCheck() {
  const started = Date.now();
  const files = [
    'test/security.test.ts',
    'test/process.test.ts',
    'test/platform-contract.test.ts',
    'test/sustainability-contract.test.ts',
    'test/control-plane-worker-runtime.test.ts',
    'test/central-project-authority-deployment.test.ts',
    'test/automation-deployment.test.ts',
    'test/release-readiness.test.ts',
    'test/release-activator.test.ts',
  ];
  const result = await runNodeTest(files, 90_000);
  check('fast-contracts', result.code === 0 ? 'PASS' : 'FAIL', result.code === 0 ? 'bounded core security/execution/release contracts passed' : `bounded core contract suite failed with exit code ${result.code}`, started);
}

async function finalUatShellCheck() {
  const started = Date.now();
  const result = await runNodeTest(['test/final-uat-shell.test.ts', 'test/mobile-horizontal-overflow.test.ts'], 90_000);
  check('final-uat-shell', result.code === 0 ? 'PASS' : 'FAIL', result.code === 0 ? 'mobile scroll, horizontal-width, shared navigation, manifest and typed deploy output regressions passed' : `final UAT shell contracts failed with exit code ${result.code}`, started);
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
    if (result.code === 0) check('desktop-smoke', 'PASS', 'Electron desktop smoke marker passed', started);
    else if (result.code === 2) check('desktop-smoke', 'SKIP', 'GUI_SANDBOX_BLOCKED: Codex/macOS GUI sandbox prevented LaunchServices/AppKit registration; no AWH runtime result is claimed; interactive GUI validation remains required', started);
    else check('desktop-smoke', 'FAIL', 'Electron runtime/app smoke failed before a valid marker was produced', started);
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
      if (['AWH.exe', 'AWHSetup.exe', 'RELEASES'].includes(name) || name?.endsWith('.nupkg')) found.set(name, path);
      return;
    }
    if (info.isDirectory()) for (const entry of await readdir(path)) await walk(join(path, entry));
  }
  await walk(out);
  const required = ['AWH.exe', 'AWHSetup.exe', 'RELEASES'];
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
    if (mode === 'fast') {
      await fastQaCheck();
    } else {
      await scriptCheck('tests', 'test', 'unit and security test suite passed');
      await scriptCheck('build', 'build', 'production TypeScript build passed');
    }
    await finalUatShellCheck();
  } else {
    blockedCheck('typescript', 'TypeScript requires installed npm dependencies');
    if (mode === 'fast') blockedCheck('fast-contracts', 'Core contract tests require installed npm dependencies');
    else { blockedCheck('tests', 'Tests require installed npm dependencies'); blockedCheck('build', 'Build requires installed npm dependencies'); }
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
  const environmentNotReady = checks.some((item) => item.status === 'FAIL' && item.summary.includes('ENVIRONMENT BLOCKER'));
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
