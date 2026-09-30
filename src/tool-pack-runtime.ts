import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, win32 as pathWin32 } from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from './process.js';
import { activateVerifiedToolRelease, inspectToolLifecycle, writeVerifiedToolReleaseManifest } from './tool-fabric-lifecycle.js';

const require = createRequire(import.meta.url);
const NODE_VERSION = (require('../config/device-runtime-release.json') as { nodeRuntime: { version: string } }).nodeRuntime.version;

export type ToolPackId = 'browser.playwright' | 'browser.devtools' | 'creative.aftereffects' | 'creative.premiere';

export interface ToolPackDefinition {
  id: ToolPackId;
  capability: string;
  legacyCapabilities?: readonly string[];
  inventoryTool: string;
  packageName: string;
  version: string;
  integrity: string;
  license: 'MIT' | 'Apache-2.0';
  entry: string[];
  args: string[];
  host: 'browser' | 'aftereffects' | 'premiere';
}

export const TOOL_PACKS: readonly ToolPackDefinition[] = [
  {
    id: 'browser.playwright',
    capability: 'web.interact',
    legacyCapabilities: ['browser.playwright'],
    inventoryTool: 'tool.pack.playwright',
    packageName: '@playwright/mcp',
    version: '0.0.82',
    integrity: 'sha512-OCqftfb8H4dnqm/njbTBRk3seUvUPttOlJUxCtEzXGETYOlRH5Qt3bbXIjmZIuWAxD9RF+yg1ASrPeXvm0y5cA==',
    license: 'Apache-2.0',
    entry: ['node_modules','@playwright','mcp','cli.js'],
    args: ['--headless','--browser','chrome'],
    host: 'browser',
  },
  {
    id: 'browser.devtools',
    capability: 'web.debug',
    legacyCapabilities: ['browser.debug'],
    inventoryTool: 'tool.pack.chrome-devtools',
    packageName: 'chrome-devtools-mcp',
    version: '1.10.1',
    integrity: 'sha512-Klw6HWDqHC/XS1JwZldd2r49aUhbUJN9m9Mvcx4SEueIPXtzuQX+QelxAViobv8YUkDZ7HWDrmViR6LeYK0wAw==',
    license: 'Apache-2.0',
    entry: ['node_modules','chrome-devtools-mcp','build','src','bin','chrome-devtools-mcp.js'],
    args: ['--headless'],
    host: 'browser',
  },
  {
    id: 'creative.aftereffects',
    capability: 'creative.aftereffects',
    inventoryTool: 'tool.pack.after-effects',
    packageName: '@engine-room/after-effects-mcp',
    version: '0.5.1',
    integrity: 'sha512-BsevU2a3y5kwhyW3OejfzrlHMQdmeocokk0rEFhn25z968sZbxf+mzD8vOw1JpD9Lj2ejLW/kG8xaXdJU/F+rw==',
    license: 'MIT',
    entry: ['node_modules','@engine-room','after-effects-mcp','bin','server.js'],
    args: [],
    host: 'aftereffects',
  },
  {
    id: 'creative.premiere',
    capability: 'creative.premiere',
    inventoryTool: 'tool.pack.premiere',
    packageName: 'premiere-pro-mcp',
    version: '1.18.2',
    integrity: 'sha512-3BKIZBn2hrVpZ8I41CsBVm9EtoWmDfmupMXXkXaW1cIVm98xOEGy5BUUXT/WiRnbws4ZUE7VR210cFYtUHEEXA==',
    license: 'MIT',
    entry: ['node_modules','premiere-pro-mcp','dist','index.js'],
    args: [],
    host: 'premiere',
  },
] as const;

export function toolPackForCapability(capability: string): ToolPackDefinition | null {
  return TOOL_PACKS.find((pack) => pack.capability === capability || pack.legacyCapabilities?.includes(capability)) ?? null;
}

export async function launchToolPackHost(pack: ToolPackDefinition, platform: NodeJS.Platform = process.platform, home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (pack.host === 'browser') return;
  if (platform === 'darwin') {
    const candidates = pack.host === 'aftereffects'
      ? ['2026','2025','2024'].map((year) => `/Applications/Adobe After Effects ${year}/Adobe After Effects ${year}.app`)
      : ['2026','2025','2024'].map((year) => `/Applications/Adobe Premiere Pro ${year}/Adobe Premiere Pro ${year}.app`);
    for (const app of candidates) {
      if (!await available(app)) continue;
      const result = await execFile('/usr/bin/open', ['-g', app], home, 30_000, env);
      if (result.code !== 0) throw new Error('TOOL_PACK_HOST_LAUNCH_FAILED');
      return;
    }
    throw new Error('TOOL_PACK_HOST_APP_MISSING');
  }
  if (platform === 'win32') {
    const roots = [env.ProgramFiles, env['ProgramFiles(x86)']].filter((value): value is string => typeof value === 'string' && value.length > 0);
    const candidates: string[] = [];
    for (const root of roots) {
      for (const year of ['2026','2025','2024']) {
        candidates.push(pack.host === 'aftereffects'
          ? pathWin32.join(root, 'Adobe', `Adobe After Effects ${year}`, 'Support Files', 'AfterFX.exe')
          : pathWin32.join(root, 'Adobe', `Adobe Premiere Pro ${year}`, 'Adobe Premiere Pro.exe'));
      }
    }
    for (const executable of candidates) {
      if (!await available(executable)) continue;
      const systemRoot = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows';
      const powershell = pathWin32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const escaped = executable.replace(/'/g, "''");
      const result = await execFile(powershell, ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',`Start-Process -FilePath '${escaped}'`], home, 30_000, env);
      if (result.code !== 0) throw new Error('TOOL_PACK_HOST_LAUNCH_FAILED');
      return;
    }
    throw new Error('TOOL_PACK_HOST_APP_MISSING');
  }
  throw new Error('TOOL_PACK_PLATFORM_UNSUPPORTED');
}

function localBase(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'AWH');
  if (platform === 'win32' && env.LOCALAPPDATA) return pathWin32.join(env.LOCALAPPDATA, 'AWH');
  throw new Error('TOOL_PACK_PLATFORM_UNSUPPORTED');
}

function toolPackReleaseKey(pack: ToolPackDefinition): string {
  const fingerprint = createHash('sha256').update(`${pack.packageName}\n${pack.version}\n${pack.integrity}`, 'utf8').digest('hex').slice(0, 16);
  return `${pack.version}-${fingerprint}`;
}

export function toolPackRoot(pack: ToolPackDefinition, platform: NodeJS.Platform = process.platform, home = homedir(), env: NodeJS.ProcessEnv = process.env): string {
  const base = localBase(platform, home, env);
  const parts = ['ToolPacks', pack.capability, 'releases', toolPackReleaseKey(pack)];
  return platform === 'win32' ? pathWin32.join(base, ...parts) : join(base, ...parts);
}

function legacyToolPackRoot(pack: ToolPackDefinition, platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): string | null {
  if (pack.id === pack.capability) return null;
  const base = localBase(platform, home, env);
  const parts = ['ToolPacks', pack.id, 'releases', toolPackReleaseKey(pack)];
  return platform === 'win32' ? pathWin32.join(base, ...parts) : join(base, ...parts);
}

async function adoptLegacyToolPackRelease(pack: ToolPackDefinition, platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): Promise<void> {
  const legacy = legacyToolPackRoot(pack, platform, home, env);
  if (!legacy) return;
  const canonical = toolPackRoot(pack, platform, home, env);
  if (await available(canonical) || !await available(legacy)) return;
  const releases = platform === 'win32'
    ? pathWin32.join(localBase(platform, home, env), 'ToolPacks', pack.capability, 'releases')
    : join(localBase(platform, home, env), 'ToolPacks', pack.capability, 'releases');
  await mkdir(releases, { recursive: true, mode: 0o700 });
  try { await rename(legacy, canonical); }
  catch {
    if (!await available(canonical)) throw new Error('TOOL_PACK_LEGACY_ADOPTION_FAILED');
  }
}

function toolPackLockPaths(pack: ToolPackDefinition, platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): { parent: string; lock: string } {
  const base = localBase(platform, home, env);
  const parts = ['ToolPacks', pack.capability, 'locks'];
  const parent = platform === 'win32' ? pathWin32.join(base, ...parts) : join(base, ...parts);
  const lock = platform === 'win32' ? pathWin32.join(parent, `${toolPackReleaseKey(pack)}.lock`) : join(parent, `${toolPackReleaseKey(pack)}.lock`);
  return { parent, lock };
}

async function acquireToolPackInstallLock(pack: ToolPackDefinition, platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): Promise<() => Promise<void>> {
  const paths = toolPackLockPaths(pack, platform, home, env);
  await mkdir(paths.parent, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + 330_000;
  for (;;) {
    try {
      await mkdir(paths.lock, { mode: 0o700 });
      const owner = platform === 'win32' ? pathWin32.join(paths.lock, 'owner.json') : join(paths.lock, 'owner.json');
      await writeFile(owner, JSON.stringify({ schemaVersion: 1, pid: process.pid, acquiredAt: new Date().toISOString(), release: toolPackReleaseKey(pack) }) + '\n', { encoding: 'utf8', mode: 0o600 });
      return async () => { await rm(paths.lock, { recursive: true, force: true }); };
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
      if (code !== 'EEXIST') throw error;
      try {
        const info = await stat(paths.lock);
        if (Date.now() - info.mtimeMs > 600_000) { await rm(paths.lock, { recursive: true, force: true }); continue; }
      } catch { continue; }
      if (Date.now() >= deadline) throw new Error('TOOL_PACK_INSTALL_LOCK_TIMEOUT');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

function toolchainPaths(platform: NodeJS.Platform, arch: string, home: string, env: NodeJS.ProcessEnv): { node: string; npmCli: string } {
  const base = localBase(platform, home, env);
  const root = platform === 'win32'
    ? pathWin32.join(base, 'Toolchain', `node-${NODE_VERSION}-${arch}`)
    : join(base, 'Toolchain', `node-${NODE_VERSION}-${arch}`);
  return platform === 'win32'
    ? { node: pathWin32.join(root, 'node.exe'), npmCli: pathWin32.join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js') }
    : { node: join(root, 'bin', 'node'), npmCli: join(root, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js') };
}

async function available(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }

function entryPath(pack: ToolPackDefinition, root: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? pathWin32.join(root, ...pack.entry) : join(root, ...pack.entry);
}

export interface ToolPackStatus {
  id: ToolPackId;
  capability: string;
  legacyCapabilities?: readonly string[];
  inventoryTool: string;
  version: string;
  installed: boolean;
  verified: boolean;
  hostReady: boolean;
  connectorReady: boolean;
  root: string;
  node: string | null;
  entry: string | null;
  reason: string | null;
}

async function hostReady(pack: ToolPackDefinition, platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv, pathAvailable: (path: string) => Promise<boolean> = available): Promise<boolean> {
  if (platform === 'darwin') {
    if (pack.host === 'browser') return await pathAvailable('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') || await pathAvailable('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    if (pack.host === 'aftereffects') {
      for (const year of ['2026','2025','2024']) if (await pathAvailable(`/Applications/Adobe After Effects ${year}/Adobe After Effects ${year}.app/Contents/MacOS/After Effects`)) return true;
      return false;
    }
    if (pack.host === 'premiere') {
      for (const year of ['2026','2025','2024']) if (await pathAvailable(`/Applications/Adobe Premiere Pro ${year}/Adobe Premiere Pro ${year}.app/Contents/MacOS/Adobe Premiere Pro ${year}`)) return true;
      return false;
    }
  }
  if (platform === 'win32') {
    const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (pack.host === 'browser') {
      for (const root of roots) {
        if (await pathAvailable(pathWin32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))) return true;
        if (await pathAvailable(pathWin32.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))) return true;
      }
      return false;
    }
    if (pack.host === 'aftereffects') {
      for (const root of roots) for (const year of ['2026','2025','2024']) if (await pathAvailable(pathWin32.join(root, 'Adobe', `Adobe After Effects ${year}`, 'Support Files', 'AfterFX.exe'))) return true;
      return false;
    }
    if (pack.host === 'premiere') {
      for (const root of roots) for (const year of ['2026','2025','2024']) if (await pathAvailable(pathWin32.join(root, 'Adobe', `Adobe Premiere Pro ${year}`, 'Adobe Premiere Pro.exe'))) return true;
      return false;
    }
  }
  return false;
}

function connectorManifest(pack: ToolPackDefinition, platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): string | null {
  if (pack.host === 'browser') return null;
  const extension = pack.host === 'aftereffects' ? 'games.engine-room.ae-mcp' : 'MCPBridgeCEP';
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions', extension, 'CSXS', 'manifest.xml');
  if (platform === 'win32' && env.APPDATA) return pathWin32.join(env.APPDATA, 'Adobe', 'CEP', 'extensions', extension, 'CSXS', 'manifest.xml');
  return null;
}

async function connectorReady(pack: ToolPackDefinition, platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  if (pack.host === 'browser') return true;
  const manifest = connectorManifest(pack, platform, home, env);
  if (!manifest) return false;
  try {
    const text = await readFile(manifest, 'utf8');
    return text.includes(pack.version);
  } catch { return false; }
}

async function callAeSetup(node: string, entry: string, cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(node, [entry], { cwd, shell: false, windowsHide: true, stdio: ['pipe','pipe','pipe'], env });
    let buffer = '';
    let initialized = false;
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(new Error('TOOL_PACK_AE_SETUP_TIMEOUT')), 45_000);
    child.once('error', (error) => finish(error instanceof Error ? error : new Error('TOOL_PACK_AE_SETUP_FAILED')));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (settled) return;
      buffer += chunk;
      if (buffer.length > 1024 * 1024) return finish(new Error('TOOL_PACK_AE_SETUP_OVERFLOW'));
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim().startsWith('{')) continue;
        let message: unknown;
        try { message = JSON.parse(line); } catch { continue; }
        if (!message || typeof message !== 'object' || Array.isArray(message)) continue;
        const row = message as Record<string, unknown>;
        if (row.id === 1 && !initialized) {
          if (row.error) return finish(new Error('TOOL_PACK_AE_INITIALIZE_FAILED'));
          initialized = true;
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'setup_panel', arguments: { enableDebugMode: true, force: false } } }) + '\n');
        } else if (row.id === 2) {
          const result = row.result;
          if (!result || typeof result !== 'object' || Array.isArray(result) || (result as Record<string, unknown>).isError === true) return finish(new Error('TOOL_PACK_AE_SETUP_FAILED'));
          return finish();
        }
      }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'AWH Agent Connector Setup', version: '1' } } }) + '\n');
  });
}

async function ensureConnector(pack: ToolPackDefinition, state: ToolPackStatus, platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): Promise<void> {
  if (pack.host === 'browser' || state.connectorReady) return;
  if (!state.node || !state.entry) throw new Error('TOOL_PACK_CONNECTOR_RUNTIME_MISSING');
  if (pack.host === 'premiere') {
    const result = await execFile(state.node, [state.entry, '--install-cep'], state.root, 120_000, env);
    if (result.code !== 0) throw new Error('TOOL_PACK_PREMIERE_CONNECTOR_FAILED');
  } else if (pack.host === 'aftereffects') {
    await callAeSetup(state.node, state.entry, state.root, env);
  }
  if (!await connectorReady(pack, platform, home, env)) throw new Error('TOOL_PACK_CONNECTOR_VERIFY_FAILED');
}

export async function inspectToolPack(pack: ToolPackDefinition, platform: NodeJS.Platform = process.platform, arch: string = process.arch, home = homedir(), env: NodeJS.ProcessEnv = process.env, hostPathAvailable: (path: string) => Promise<boolean> = available): Promise<ToolPackStatus> {
  const root = toolPackRoot(pack, platform, home, env);
  const paths = toolchainPaths(platform, arch, home, env);
  const entry = entryPath(pack, root, platform);
  let installed = false;
  let verified = false;
  let reason: string | null = null;
  try {
    const packagePath = platform === 'win32'
      ? pathWin32.join(root, 'node_modules', ...pack.packageName.split('/'), 'package.json')
      : join(root, 'node_modules', ...pack.packageName.split('/'), 'package.json');
    const meta = JSON.parse(await readFile(packagePath, 'utf8')) as { version?: unknown };
    installed = meta.version === pack.version && await available(entry);
    if (!installed) reason = 'PACKAGE_VERSION_MISMATCH';
    else {
      const lock = JSON.parse(await readFile(platform === 'win32' ? pathWin32.join(root, 'package-lock.json') : join(root, 'package-lock.json'), 'utf8')) as { packages?: Record<string, { version?: string; integrity?: string }> };
      const key = 'node_modules/' + pack.packageName;
      const row = lock.packages?.[key];
      verified = row?.version === pack.version && row.integrity === pack.integrity && await available(paths.node);
      if (!verified) reason = 'PACKAGE_INTEGRITY_MISMATCH';
    }
  } catch { reason = 'PACKAGE_NOT_INSTALLED'; }
  const host = await hostReady(pack, platform, home, env, hostPathAvailable);
  const connector = verified && host ? await connectorReady(pack, platform, home, env) : false;
  if (verified && !host) reason = 'HOST_APP_MISSING';
  else if (verified && host && !connector) reason = 'HOST_CONNECTOR_MISSING';
  return { id: pack.id, capability: pack.capability, inventoryTool: pack.inventoryTool, version: pack.version, installed, verified, hostReady: host, connectorReady: connector, root, node: await available(paths.node) ? paths.node : null, entry: await available(entry) ? entry : null, reason };
}

export async function ensureToolPack(pack: ToolPackDefinition, platform: NodeJS.Platform = process.platform, arch: string = process.arch, home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<ToolPackStatus> {
  await adoptLegacyToolPackRelease(pack, platform, home, env);
  const current = await inspectToolPack(pack, platform, arch, home, env);
  if (current.verified) return current;
  const releaseLock = await acquireToolPackInstallLock(pack, platform, home, env);
  try {
    const afterLock = await inspectToolPack(pack, platform, arch, home, env);
    if (afterLock.verified) return afterLock;
    const root = afterLock.root;
    const paths = toolchainPaths(platform, arch, home, env);
    if (!await available(paths.node) || !await available(paths.npmCli)) throw new Error('TOOL_PACK_PRIVATE_NODE_REQUIRED');
    await mkdir(root, { recursive: true, mode: 0o700 });
    await writeFile(platform === 'win32' ? pathWin32.join(root, 'package.json') : join(root, 'package.json'), JSON.stringify({
      name: 'awh-tool-pack-' + pack.id.replace(/[^a-z0-9]+/g, '-'),
      private: true,
      version: '1.0.0',
      awhToolPackRelease: toolPackReleaseKey(pack),
      dependencies: { [pack.packageName]: pack.version },
    }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    const install = await execFile(paths.node, [paths.npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', `${pack.packageName}@${pack.version}`], root, 300_000, { ...env, npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' });
    if (install.code !== 0) throw new Error('TOOL_PACK_INSTALL_FAILED_' + pack.id.replace(/[^A-Z0-9]/gi, '_').toUpperCase());
    const next = await inspectToolPack(pack, platform, arch, home, env);
    if (!next.verified) throw new Error('TOOL_PACK_VERIFY_FAILED_' + pack.id.replace(/[^A-Z0-9]/gi, '_').toUpperCase());
    return next;
  } finally {
    await releaseLock();
  }
}

export async function ensureToolPackReady(pack: ToolPackDefinition, platform: NodeJS.Platform = process.platform, arch: string = process.arch, home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<ToolPackStatus> {
  const installed = await ensureToolPack(pack, platform, arch, home, env);
  if (!installed.verified || !installed.hostReady) return installed;
  await ensureConnector(pack, installed, platform, home, env);
  return inspectToolPack(pack, platform, arch, home, env);
}

export async function activateToolPackAfterSmoke(pack: ToolPackDefinition, state: ToolPackStatus, platform: NodeJS.Platform = process.platform, home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!state.verified || !state.hostReady || !state.connectorReady || !state.node || !state.entry) throw new Error('TOOL_PACK_NOT_VERIFIED_FOR_ACTIVATION');
  const releaseKey = toolPackReleaseKey(pack);
  await writeVerifiedToolReleaseManifest({
    schemaVersion: 1,
    kind: 'AWH_TOOL_RELEASE',
    capability: pack.capability,
    providerId: pack.id,
    releaseKey,
    channel: 'stable',
    version: pack.version,
    revision: null,
    license: pack.license,
    verificationState: 'VERIFIED',
    checks: { integrity: 'PASS', smoke: 'PASS', capabilityContract: 'PASS', rollback: 'READY' },
    launch: { command: state.node, args: [state.entry, ...pack.args] },
  }, platform, home, env);
  await activateVerifiedToolRelease(pack.capability, releaseKey, platform, home, env);
}

export async function provisionEligibleToolPacks(platform: NodeJS.Platform = process.platform, arch: string = process.arch, home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<ToolPackStatus[]> {
  const states: ToolPackStatus[] = [];
  for (const pack of TOOL_PACKS) {
    const state = await inspectToolPack(pack, platform, arch, home, env);
    if (!state.hostReady) { states.push(state); continue; }
    try {
      const installed = state.verified && state.connectorReady ? state : await ensureToolPackReady(pack, platform, arch, home, env);
      states.push(installed);
    } catch { states.push(await inspectToolPack(pack, platform, arch, home, env)); }
  }
  return states;
}

export async function provisionableToolPackCapabilities(platform: NodeJS.Platform = process.platform, home = homedir(), env: NodeJS.ProcessEnv = process.env, hostPathAvailable: (path: string) => Promise<boolean> = available): Promise<string[]> {
  const capabilities: string[] = [];
  for (const pack of TOOL_PACKS) {
    if (await hostReady(pack, platform, home, env, hostPathAvailable)) capabilities.push(pack.capability, ...(pack.legacyCapabilities ?? []));
  }
  return [...new Set(capabilities)].sort();
}

export async function installedToolPackCapabilities(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
  hostPathAvailable: (path: string) => Promise<boolean> = available,
): Promise<{ tools: string[]; capabilities: string[] }> {
  const tools: string[] = [];
  const capabilities: string[] = [];
  for (const pack of TOOL_PACKS) {
    const state = await inspectToolPack(pack, platform, arch, home, env, hostPathAvailable);
    if (!state.verified || !state.hostReady || !state.connectorReady) continue;
    const lifecycle = await inspectToolLifecycle(pack.capability, platform, home, env);
    if (lifecycle.current?.releaseKey !== toolPackReleaseKey(pack) || lifecycle.current.channel !== 'stable') continue;
    tools.push(pack.inventoryTool);
    capabilities.push(pack.capability, ...(pack.legacyCapabilities ?? []));
  }
  return { tools: tools.sort(), capabilities: [...new Set(capabilities)].sort() };
}
