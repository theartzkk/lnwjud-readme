import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { createPackageWithOptions, extractAll, extractFile, getRawHeader } from '@electron/asar';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, win32 as pathWin32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { execFile } from './process.js';
import { LnwjudDeviceClient, discoverLnwjudLaunchSpec } from './lnwjud-device-client.js';

type RuntimeAssetSpec = { nameTemplate: string; sha256: string };
type DeviceRuntimeReleaseManifest = {
  package: string;
  version: string;
  npmIntegrity: string;
  minimumVersion: string;
  deviceEngine: {
    version: string;
    minimumVersion: string;
    sourceUrlTemplate: string;
    assets: Record<'darwin-arm64' | 'darwin-x64' | 'win32-x64', RuntimeAssetSpec>;
  };
  nodeRuntime: {
    version: string;
    minimumVersion: string;
    sourceUrlTemplate: string;
    assets: Record<'darwin-arm64' | 'darwin-x64' | 'win32-x64', RuntimeAssetSpec>;
  };
};
const require = createRequire(import.meta.url);
const DEVICE_RUNTIME_RELEASE = require('../config/device-runtime-release.json') as DeviceRuntimeReleaseManifest;
const renderReleaseTemplate = (template: string, version: string): string => template.replaceAll('{version}', version);

const LNWJUD_VERSION = DEVICE_RUNTIME_RELEASE.deviceEngine.version;
const engineAsset = (key: 'darwin-arm64' | 'darwin-x64' | 'win32-x64') => {
  const spec = DEVICE_RUNTIME_RELEASE.deviceEngine.assets[key];
  return { name: renderReleaseTemplate(spec.nameTemplate, LNWJUD_VERSION), sha256: spec.sha256 };
};
const MAC_ASSETS = { arm64: engineAsset('darwin-arm64'), x64: engineAsset('darwin-x64') } as const;
const WINDOWS_ASSET = engineAsset('win32-x64');
const RELEASE_BASE = DEVICE_RUNTIME_RELEASE.deviceEngine.sourceUrlTemplate
  .replaceAll('{version}', LNWJUD_VERSION)
  .replace('/{asset}', '');
const MAC_RUNTIME_EXECUTABLE = 'AWH Device Runtime';
const AWH_RUNTIME_APP_NAME = 'AWH Device Runtime';
const WINDOWS_RUNTIME_EXECUTABLE = 'AWH Device Runtime.exe';

const NODE_VERSION = DEVICE_RUNTIME_RELEASE.nodeRuntime.version;
const NODE_RELEASE_BASE = DEVICE_RUNTIME_RELEASE.nodeRuntime.sourceUrlTemplate
  .replaceAll('{version}', NODE_VERSION)
  .replace('/{asset}', '');
const nodeAsset = (key: 'darwin-arm64' | 'darwin-x64' | 'win32-x64') => {
  const spec = DEVICE_RUNTIME_RELEASE.nodeRuntime.assets[key];
  return { name: renderReleaseTemplate(spec.nameTemplate, NODE_VERSION), sha256: spec.sha256 };
};
const NODE_ASSETS = {
  'darwin-arm64': nodeAsset('darwin-arm64'),
  'darwin-x64': nodeAsset('darwin-x64'),
  'win32-x64': nodeAsset('win32-x64'),
} as const;
const SYSTEM_MCP_PACKAGE = DEVICE_RUNTIME_RELEASE.package;
const SYSTEM_MCP_VERSION = DEVICE_RUNTIME_RELEASE.version;
const SYSTEM_MCP_INTEGRITY = DEVICE_RUNTIME_RELEASE.npmIntegrity;

export interface DeviceBootstrapResult {
  state: 'READY' | 'UNSUPPORTED' | 'FAILED';
  version: string | null;
  installed: boolean;
  verified: boolean;
  reason: string | null;
}

export interface DeviceRuntimePermissionStatus {
  schemaVersion: 1;
  runtime: 'AWH Device Runtime';
  accessibility: boolean;
  screenCapture: string;
  microphone: string;
  automation: string;
  ready: boolean;
  requested: boolean;
  error?: string;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('end', resolve);
    stream.once('error', reject);
  });
  return hash.digest('hex');
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url, { redirect: 'follow', cache: 'no-store' });
  if (!response.ok || !response.body) throw new Error('DEVICE_RUNTIME_DOWNLOAD_FAILED_' + String(response.status));
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > 300 * 1024 * 1024) throw new Error('DEVICE_RUNTIME_DOWNLOAD_TOO_LARGE');
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(destination, { mode: 0o600 }));
}

async function findApp(root: string): Promise<string | null> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && entry.name === 'lnwjud.app') return path;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findApp(join(root, entry.name));
    if (found) return found;
  }
  return null;
}

const AWH_HEADLESS_PATCH_MARKER = 'AWH_DEVICE_RUNTIME_HEADLESS === "1"';
const AWH_RUNTIME_NAME_MARKER = `var APP_NAME = "${AWH_RUNTIME_APP_NAME}";`;
const AWH_RUNTIME_MCP_NAME_MARKER = `var APP_NAME2 = "${AWH_RUNTIME_APP_NAME}";`;
const AWH_RUNTIME_INSTRUCTIONS_MARKER = 'Continue using AWH Device Runtime tools';
const AWH_RUNTIME_READY_MARKER = 'AWH Device Runtime MCP stdio ready';
const AWH_RUNTIME_PERMISSION_MARKER = 'AWH_PERMISSION_BOOTSTRAP_V3';
const AWH_RUNTIME_PERMISSION_V2_MARKER = 'var AWH_PERMISSION_BOOTSTRAP_V2 = true;';
const AWH_RUNTIME_PERMISSION_V1_MARKER = 'var AWH_PERMISSION_BOOTSTRAP_V1 = true;';

async function patchMacHeadlessRuntime(appRoot: string): Promise<void> {
  const archive = join(appRoot, 'Contents', 'Resources', 'app.asar');
  let currentMain: string;
  try { currentMain = extractFile(archive, 'dist/main/main.js').toString('utf8'); }
  catch { throw new Error('DEVICE_RUNTIME_PATCH_SOURCE_INVALID'); }
  if (currentMain.includes(AWH_HEADLESS_PATCH_MARKER) && currentMain.includes(AWH_RUNTIME_NAME_MARKER) && currentMain.includes(AWH_RUNTIME_MCP_NAME_MARKER) && currentMain.includes(AWH_RUNTIME_INSTRUCTIONS_MARKER) && currentMain.includes(AWH_RUNTIME_READY_MARKER) && currentMain.includes(AWH_RUNTIME_PERMISSION_MARKER)) return;

  const functionMarker = 'async function resolveDesktopRuntimeSecrets(dataPath) {\n';
  const electronImportMarker = 'import { app, BrowserWindow as BrowserWindow2, clipboard, ClipboardItem, crashReporter, desktopCapturer, dialog, ipcMain, Menu, nativeImage, net, Notification, safeStorage, screen, shell, Tray } from "electron";';
  const requiredTokens = ['path72','mkdirSync8','lstatSync3','readFileSync9','writeFileSync6','randomBytes8','createExplicitKeySecretProtector','CheckpointKeyStore','execFileAsync10','wantsMcpStdio','FACTORY_RESET_APPLY_ARG'];
  if (!currentMain.includes(functionMarker) || requiredTokens.some((token) => !currentMain.includes(token))) throw new Error('DEVICE_RUNTIME_PATCH_CONTRACT_MISMATCH');
  if (!currentMain.includes(AWH_RUNTIME_PERMISSION_MARKER) && !currentMain.includes(AWH_RUNTIME_PERMISSION_V2_MARKER) && !currentMain.includes(AWH_RUNTIME_PERMISSION_V1_MARKER) && !currentMain.includes(electronImportMarker)) throw new Error('DEVICE_RUNTIME_PERMISSION_IMPORT_CONTRACT_MISMATCH');

  const branch = `  if (process.env.AWH_DEVICE_RUNTIME_HEADLESS === "1") {
    const keyDirectory = path72.join(dataPath, "awh-runtime");
    mkdirSync8(keyDirectory, { recursive: true, mode: 448 });
    const keyPath = path72.join(keyDirectory, "engine-secret.key");
    let key;
    try {
      const metadata = lstatSync3(keyPath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("AWH Device Runtime secret key is not a trusted regular file");
      key = Buffer.from(readFileSync9(keyPath, "utf8").trim(), "base64");
    } catch (error46) {
      if (!(typeof error46 === "object" && error46 !== null && "code" in error46 && error46.code === "ENOENT")) throw error46;
      key = randomBytes8(32);
      writeFileSync6(keyPath, key.toString("base64"), { encoding: "utf8", flag: "wx", mode: 384 });
    }
    if (key.byteLength !== 32) throw new Error("AWH Device Runtime secret key is invalid");
    const secretProtector = createExplicitKeySecretProtector(key);
    const checkpointKey = await new CheckpointKeyStore({
      filePath: path72.join(dataPath, "checkpoint-master.key"),
      secretProtector,
      quarantineUnsupported: true
    }).loadOrCreate();
    return { checkpointEncryptionKey: checkpointKey, secretProtector };
  }
`;

  const work = await mkdtemp(join(tmpdir(), 'awh-engine-patch-'));
  const next = archive + '.awh-next';
  const backup = archive + '.awh-upstream';
  try {
    extractAll(archive, work);
    const mainPath = join(work, 'dist', 'main', 'main.js');
    let nextMain = currentMain;
    if (!nextMain.includes(AWH_HEADLESS_PATCH_MARKER)) nextMain = nextMain.replace(functionMarker, functionMarker + branch);
    for (const [legacyMarker, errorCode] of [
      [AWH_RUNTIME_PERMISSION_V2_MARKER, 'DEVICE_RUNTIME_PERMISSION_V2_MIGRATION_CONTRACT_MISMATCH'],
      [AWH_RUNTIME_PERMISSION_V1_MARKER, 'DEVICE_RUNTIME_PERMISSION_V1_MIGRATION_CONTRACT_MISMATCH'],
    ] as const) {
      if (!nextMain.includes(legacyMarker)) continue;
      const permissionEntry = 'var factoryResetApplyRequested = process.argv.includes(FACTORY_RESET_APPLY_ARG);';
      const permissionStart = nextMain.indexOf(legacyMarker);
      const permissionEnd = nextMain.indexOf(permissionEntry, permissionStart);
      if (permissionStart < 0 || permissionEnd < 0) throw new Error(errorCode);
      nextMain = nextMain.slice(0, permissionStart) + nextMain.slice(permissionEnd);
    }
    if (!nextMain.includes(AWH_RUNTIME_PERMISSION_MARKER)) {
      nextMain = nextMain.replace(
        'import { app, BrowserWindow as BrowserWindow2, clipboard, ClipboardItem, crashReporter, desktopCapturer, dialog, ipcMain, Menu, nativeImage, net, Notification, safeStorage, screen, shell, Tray } from "electron";',
        'import { app, BrowserWindow as BrowserWindow2, clipboard, ClipboardItem, crashReporter, desktopCapturer, dialog, ipcMain, Menu, nativeImage, net, Notification, safeStorage, screen, shell, systemPreferences, Tray } from "electron";'
      );
      const lockContract = 'function shouldHoldSingleInstanceLock(argv) {\n  return !wantsMcpStdio(argv);\n}';
      const lockReplacement = 'function shouldHoldSingleInstanceLock(argv) {\n  return !wantsMcpStdio(argv) && !argv.includes("--awh-permission-status") && !argv.includes("--awh-permission-setup");\n}';
      if (nextMain.includes(lockContract)) nextMain = nextMain.replace(lockContract, lockReplacement);
      else if (!nextMain.includes(lockReplacement)) throw new Error('DEVICE_RUNTIME_PERMISSION_LOCK_CONTRACT_MISMATCH');
      const permissionEntry = 'var factoryResetApplyRequested = process.argv.includes(FACTORY_RESET_APPLY_ARG);';
      const permissionBootstrap = `
var AWH_PERMISSION_BOOTSTRAP_V3 = true;
var AWH_PERMISSION_STATUS_ARG = "--awh-permission-status";
var AWH_PERMISSION_SETUP_ARG = "--awh-permission-setup";
async function awhPermissionSnapshot(requestPermissions) {
  await app.whenReady();
  const accessibility = process.platform === "darwin" ? systemPreferences.isTrustedAccessibilityClient(requestPermissions === true) : true;
  let screenCapture = process.platform === "darwin" ? systemPreferences.getMediaAccessStatus("screen") : "granted";
  if (process.platform === "darwin" && requestPermissions === true && screenCapture !== "granted") {
    try { await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 }, fetchWindowIcons: false }); } catch {}
    screenCapture = systemPreferences.getMediaAccessStatus("screen");
  }
  const microphone = process.platform === "darwin" ? systemPreferences.getMediaAccessStatus("microphone") : "granted";
  // Microphone and Automation are capability-scoped. Core setup must not
  // prompt for them or use them as readiness gates.
  const automation = process.platform === "darwin" ? "unknown" : "granted";
  const ready = accessibility === true && screenCapture === "granted";
  return { schemaVersion: 1, runtime: "AWH Device Runtime", accessibility, screenCapture, microphone, automation, ready, requested: requestPermissions === true };
}
async function awhRunPermissionBootstrap() {
  const requestPermissions = process.argv.includes(AWH_PERMISSION_SETUP_ARG);
  try {
    const result = await awhPermissionSnapshot(requestPermissions);
    const exitCode = result.ready ? 0 : 3;
    process.stdout.write(JSON.stringify(result) + "\\n", () => process.exit(exitCode));
  } catch (error46) {
    process.stdout.write(JSON.stringify({ schemaVersion: 1, runtime: "AWH Device Runtime", ready: false, error: error46 instanceof Error ? error46.message : String(error46) }) + "\\n", () => process.exit(4));
  }
}
if (process.argv.includes(AWH_PERMISSION_STATUS_ARG) || process.argv.includes(AWH_PERMISSION_SETUP_ARG)) {
  void awhRunPermissionBootstrap();
}
`;
      if (!nextMain.includes(permissionEntry)) throw new Error('DEVICE_RUNTIME_PERMISSION_PATCH_CONTRACT_MISMATCH');
      nextMain = nextMain.replace(permissionEntry, permissionBootstrap + permissionEntry);
      const runtimeDispatch = 'if (wantsMcpStdio(process.argv)) {';
      const permissionDispatch = 'if (process.argv.includes(AWH_PERMISSION_STATUS_ARG) || process.argv.includes(AWH_PERMISSION_SETUP_ARG)) {';
      if (nextMain.includes(permissionDispatch)) {
        // A prior permission bootstrap already owns this dispatch boundary.
      } else if (nextMain.includes(runtimeDispatch)) {
        nextMain = nextMain.replace(runtimeDispatch, 'if (process.argv.includes(AWH_PERMISSION_STATUS_ARG) || process.argv.includes(AWH_PERMISSION_SETUP_ARG)) {\n      // Permission helper owns this short-lived runtime process.\n    } else if (wantsMcpStdio(process.argv)) {');
      } else throw new Error('DEVICE_RUNTIME_PERMISSION_DISPATCH_CONTRACT_MISMATCH');
    }
    nextMain = nextMain.replace('var APP_NAME = "lnwjud";', AWH_RUNTIME_NAME_MARKER);
    nextMain = nextMain.replace('var APP_NAME2 = "lnwjud";', AWH_RUNTIME_MCP_NAME_MARKER);
    nextMain = nextMain.replaceAll('Continue using lnwjud tools', AWH_RUNTIME_INSTRUCTIONS_MARKER);
    nextMain = nextMain.replaceAll('lnwjud MCP stdio ready', AWH_RUNTIME_READY_MARKER);
    nextMain = nextMain.replaceAll('lnwjud updated the live MCP tool list', 'AWH Device Runtime updated the live MCP tool list');
    nextMain = nextMain.replaceAll('? "lnwjud \\u0E2D', '? "AWH Device Runtime \\u0E2D');
    if (!nextMain.includes(AWH_RUNTIME_NAME_MARKER) || !nextMain.includes(AWH_RUNTIME_MCP_NAME_MARKER) || !nextMain.includes(AWH_RUNTIME_INSTRUCTIONS_MARKER) || !nextMain.includes(AWH_RUNTIME_READY_MARKER)) throw new Error('DEVICE_RUNTIME_REBRAND_NAME_PATCH_FAILED');
    await writeFile(mainPath, nextMain, 'utf8');
    const runtimePackagePath = join(work, 'package.json');
    const runtimePackage = JSON.parse(await readFile(runtimePackagePath, 'utf8')) as Record<string, unknown>;
    runtimePackage.name = 'awh-device-runtime';
    runtimePackage.productName = 'AWH Device Runtime';
    await writeFile(runtimePackagePath, JSON.stringify(runtimePackage, null, 2) + '\n', 'utf8');
    await rm(next, { force: true });
    await createPackageWithOptions(work, next, { unpack: '{dist/main/*.node,node_modules/@electron-internal/extract-zip/**}' });
    const patched = extractFile(next, 'dist/main/main.js').toString('utf8');
    const patchedPackage = JSON.parse(extractFile(next, 'package.json').toString('utf8')) as Record<string, unknown>;
    if (!patched.includes(AWH_HEADLESS_PATCH_MARKER) || !patched.includes(AWH_RUNTIME_NAME_MARKER) || !patched.includes(AWH_RUNTIME_MCP_NAME_MARKER) || !patched.includes(AWH_RUNTIME_INSTRUCTIONS_MARKER) || !patched.includes(AWH_RUNTIME_READY_MARKER) || !patched.includes(AWH_RUNTIME_PERMISSION_MARKER) || patched.includes(AWH_RUNTIME_PERMISSION_V1_MARKER)) throw new Error('DEVICE_RUNTIME_PATCH_VERIFY_FAILED');
    if (patchedPackage.name !== 'awh-device-runtime' || patchedPackage.productName !== 'AWH Device Runtime') throw new Error('DEVICE_RUNTIME_PACKAGE_IDENTITY_VERIFY_FAILED');
    await rm(backup, { force: true });
    await rename(archive, backup);
    try { await rename(next, archive); }
    catch (error) { await rename(backup, archive).catch(() => undefined); throw error; }
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
    await rm(next, { force: true }).catch(() => undefined);
  }
}

async function rebrandMacEngine(appRoot: string): Promise<void> {
  const archive = join(appRoot, 'Contents', 'Resources', 'app.asar');
  const backup = archive + '.awh-upstream';
  await patchMacHeadlessRuntime(appRoot);
  const plist = join(appRoot, 'Contents', 'Info.plist');
  const asarIntegrity = createHash('sha256').update(getRawHeader(archive).headerString).digest('hex');
  const oldExecutable = join(appRoot, 'Contents', 'MacOS', 'lnwjud');
  const newExecutable = join(appRoot, 'Contents', 'MacOS', MAC_RUNTIME_EXECUTABLE);
  try {
    const info = await lstat(newExecutable);
    if (!info.isFile()) throw new Error('DEVICE_RUNTIME_REBRAND_INVALID');
  } catch {
    const old = await lstat(oldExecutable);
    if (!old.isFile()) throw new Error('DEVICE_RUNTIME_REBRAND_SOURCE_MISSING');
    await rename(oldExecutable, newExecutable);
  }
  const updates: Array<[string, string, string]> = [
    ['CFBundleDisplayName', '-string', 'AWH Device Runtime'],
    ['CFBundleName', '-string', 'AWH Device Runtime'],
    ['CFBundleExecutable', '-string', MAC_RUNTIME_EXECUTABLE],
    ['CFBundleIdentifier', '-string', 'online.kruart.awh-device-runtime'],
  ];
  for (const [key, kind, value] of updates) {
    const result = await execFile('/usr/bin/plutil', ['-replace', key, kind, value, plist], appRoot, 15_000);
    if (result.code !== 0) throw new Error('DEVICE_RUNTIME_REBRAND_PLIST_FAILED');
  }
  const background = await execFile('/usr/bin/plutil', ['-replace', 'LSUIElement', '-bool', 'YES', plist], appRoot, 15_000);
  if (background.code !== 0) throw new Error('DEVICE_RUNTIME_REBRAND_PLIST_FAILED');
  const integrity = await execFile('/usr/libexec/PlistBuddy', ['-c', `Set :ElectronAsarIntegrity:Resources/app.asar:hash ${asarIntegrity}`, plist], appRoot, 15_000);
  if (integrity.code !== 0) throw new Error('DEVICE_RUNTIME_REBRAND_ASAR_INTEGRITY_FAILED');
  const microphone = await execFile('/usr/bin/plutil', ['-replace', 'NSMicrophoneUsageDescription', '-string', 'AWH Device Runtime uses the microphone only for an explicitly requested audio task.', plist], appRoot, 15_000);
  if (microphone.code !== 0) throw new Error('DEVICE_RUNTIME_REBRAND_PLIST_FAILED');
  const appleEvents = await execFile('/usr/bin/plutil', ['-replace', 'NSAppleEventsUsageDescription', '-string', 'AWH Device Runtime uses Automation only to control apps you explicitly ask AWH to operate.', plist], appRoot, 15_000);
  if (appleEvents.code !== 0) throw new Error('DEVICE_RUNTIME_REBRAND_PLIST_FAILED');
  const iconWork = await mkdtemp(join(tmpdir(), 'awh-runtime-icon-'));
  try {
    const logoSource = join(dirname(fileURLToPath(import.meta.url)), '..', 'logo-256x256.png');
    const stagedLogo = join(iconWork, 'awh-logo.png');
    const brandedIcon = join(appRoot, 'Contents', 'Resources', 'AWHDeviceRuntime.icns');
    await copyFile(logoSource, stagedLogo);
    const converted = await execFile('/usr/bin/sips', ['-s', 'format', 'icns', stagedLogo, '--out', brandedIcon], appRoot, 30_000);
    if (converted.code !== 0) throw new Error('DEVICE_RUNTIME_REBRAND_ICON_FAILED');
    await copyFile(brandedIcon, join(appRoot, 'Contents', 'Resources', 'icon.icns'));
    const iconPlist = await execFile('/usr/bin/plutil', ['-replace', 'CFBundleIconFile', '-string', 'AWHDeviceRuntime.icns', plist], appRoot, 15_000);
    if (iconPlist.code !== 0) throw new Error('DEVICE_RUNTIME_REBRAND_ICON_FAILED');
  } finally {
    await rm(iconWork, { recursive: true, force: true }).catch(() => undefined);
  }
  // Electron derives helper bundle names from the top-level CFBundleName.
  // Rebrand the helper bundles and executables together so no macOS-facing
  // process or Privacy entry falls back to the historical upstream product.
  const frameworks = join(appRoot, 'Contents', 'Frameworks');
  try {
    for (const entry of await readdir(frameworks, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^lnwjud Helper(?: \(.+\))?\.app$/.test(entry.name)) continue;
      const suffix = /^lnwjud Helper(.*)\.app$/.exec(entry.name)?.[1] ?? '';
      const helperName = `AWH Device Runtime Helper${suffix}`;
      const oldHelperRoot = join(frameworks, entry.name);
      const helperPlist = join(oldHelperRoot, 'Contents', 'Info.plist');
      const oldHelperExecutable = join(oldHelperRoot, 'Contents', 'MacOS', `lnwjud Helper${suffix}`);
      const newHelperExecutable = join(oldHelperRoot, 'Contents', 'MacOS', helperName);
      try {
        const oldExecutableInfo = await lstat(oldHelperExecutable);
        if (oldExecutableInfo.isFile()) await rename(oldHelperExecutable, newHelperExecutable);
      } catch {}
      const helperUpdates: Array<[string, string, string]> = [
        ['CFBundleDisplayName', '-string', helperName],
        ['CFBundleName', '-string', helperName],
        ['CFBundleExecutable', '-string', helperName],
        ['CFBundleIdentifier', '-string', `online.kruart.awh-device-runtime.helper${suffix.toLowerCase().replace(/[^a-z0-9]+/g, '-') || '-main'}`],
      ];
      for (const [key, kind, value] of helperUpdates) {
        const helperResult = await execFile('/usr/bin/plutil', ['-replace', key, kind, value, helperPlist], appRoot, 15_000);
        if (helperResult.code !== 0) throw new Error('DEVICE_RUNTIME_REBRAND_HELPER_FAILED');
      }
      const newHelperRoot = join(frameworks, `${helperName}.app`);
      if (newHelperRoot !== oldHelperRoot) await rename(oldHelperRoot, newHelperRoot);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await rm(backup, { force: true }).catch(() => undefined);
  const sign = await execFile('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appRoot], appRoot, 120_000);
  if (sign.code !== 0) throw new Error('DEVICE_RUNTIME_REBRAND_SIGN_FAILED');
}

function macBridge(): string {
  return `#!/bin/sh
set -eu
AWH_ROOT="$HOME/Library/Application Support/AWH"
ENGINE_LINK="$AWH_ROOT/Engines/lnwjud/current"
ENGINE="$(readlink "$ENGINE_LINK" 2>/dev/null || printf '%s' "$ENGINE_LINK")"
DATA="$AWH_ROOT/DeviceRuntime/device-runtime"
mkdir -p "$DATA"
chmod 700 "$DATA"
unset ELECTRON_RUN_AS_NODE
export AWH_DEVICE_RUNTIME_HEADLESS=1
export LNWJUD_DATA_PATH="$DATA"
exec "$ENGINE/Contents/MacOS/AWH Device Runtime" --mcp-stdio "$@"
`;
}

async function installMacBridge(home: string): Promise<void> {
  const runtime = join(home, 'Library', 'Application Support', 'AWH', 'DeviceRuntime');
  const bin = join(home, '.awh', 'bin');
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  await mkdir(bin, { recursive: true, mode: 0o700 });
  for (const path of [join(runtime, 'awh-mcp-stdio'), join(bin, 'awh-mcp-stdio')]) {
    await writeFile(path, macBridge(), { encoding: 'utf8', mode: 0o700 });
    await chmod(path, 0o700);
  }
}


export async function deviceRuntimePermissionStatus(home = homedir(), requestPermissions = false): Promise<DeviceRuntimePermissionStatus> {
  if (process.platform !== 'darwin') {
    return { schemaVersion: 1, runtime: 'AWH Device Runtime', accessibility: true, screenCapture: 'granted', microphone: 'granted', automation: 'granted', ready: true, requested: requestPermissions };
  }
  const root = join(home, 'Library', 'Application Support', 'AWH', 'Engines', 'lnwjud');
  const current = join(root, 'current');
  let active = current;
  try {
    const link = (await readlink(current)).trim();
    active = isAbsolute(link) ? link : join(root, link);
  } catch {}
  const executable = join(active, 'Contents', 'MacOS', MAC_RUNTIME_EXECUTABLE);
  const dataPath = join(home, 'Library', 'Application Support', 'AWH', 'DeviceRuntime', 'device-runtime');
  await mkdir(dataPath, { recursive: true, mode: 0o700 });
  const env: NodeJS.ProcessEnv = { ...process.env, AWH_DEVICE_RUNTIME_HEADLESS: '1', LNWJUD_DATA_PATH: dataPath };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = await execFile(executable, [requestPermissions ? '--awh-permission-setup' : '--awh-permission-status'], active, requestPermissions ? 120_000 : 30_000, env);
  const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) throw new Error('DEVICE_RUNTIME_PERMISSION_STATUS_MISSING');
  let value: unknown;
  try { value = JSON.parse(line); } catch { throw new Error('DEVICE_RUNTIME_PERMISSION_STATUS_INVALID'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('DEVICE_RUNTIME_PERMISSION_STATUS_INVALID');
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1 || row.runtime !== 'AWH Device Runtime' || typeof row.accessibility !== 'boolean' || typeof row.screenCapture !== 'string' || typeof row.microphone !== 'string' || typeof row.automation !== 'string' || typeof row.ready !== 'boolean') throw new Error('DEVICE_RUNTIME_PERMISSION_STATUS_INVALID');
  return {
    schemaVersion: 1,
    runtime: 'AWH Device Runtime',
    accessibility: row.accessibility,
    screenCapture: row.screenCapture,
    microphone: row.microphone,
    automation: row.automation,
    ready: row.ready,
    requested: requestPermissions,
    ...(typeof row.error === 'string' ? { error: row.error } : {}),
  };
}

async function installMacEngine(home: string, arch: 'arm64' | 'x64'): Promise<boolean> {
  const asset = MAC_ASSETS[arch];
  const root = join(home, 'Library', 'Application Support', 'AWH', 'Engines', 'lnwjud');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const current = join(root, 'current');
  // Preserve an already-qualified AWH engine instead
  // of replacing it with a second upstream copy merely because its directory
  // name carries an AWH suffix.
  try {
    const link = (await readlink(current)).trim();
    const active = isAbsolute(link) ? link : join(root, link);
    if (active.includes(LNWJUD_VERSION)) {
      const branded = join(active, 'Contents', 'MacOS', MAC_RUNTIME_EXECUTABLE);
      const legacy = join(active, 'Contents', 'MacOS', 'lnwjud');
      let usable = false;
      try { usable = (await lstat(branded)).isFile(); } catch {}
      if (!usable) { try { usable = (await lstat(legacy)).isFile(); } catch {} }
      if (usable) {
        await rebrandMacEngine(active);
        await installMacBridge(home);
        return false;
      }
    }
  } catch {}
  const target = join(root, LNWJUD_VERSION);
  const runtimeExecutable = join(target, 'Contents', 'MacOS', MAC_RUNTIME_EXECUTABLE);
  try {
    if ((await lstat(runtimeExecutable)).isFile()) {
      await rebrandMacEngine(target);
      await installMacBridge(home);
      return false;
    }
  } catch {}
  const work = await mkdtemp(join(tmpdir(), 'awh-lnwjud-'));
  try {
    const archive = join(work, asset.name);
    await download(`${RELEASE_BASE}/${asset.name}`, archive);
    if ((await sha256File(archive)) !== asset.sha256) throw new Error('DEVICE_RUNTIME_INTEGRITY_FAILED');
    const extracted = join(work, 'extracted'); await mkdir(extracted, { recursive: true, mode: 0o700 });
    const unzip = await execFile('/usr/bin/ditto', ['-x', '-k', archive, extracted], work, 180_000);
    if (unzip.code !== 0) throw new Error('DEVICE_RUNTIME_EXTRACT_FAILED');
    const app = await findApp(extracted); if (!app) throw new Error('DEVICE_RUNTIME_PACKAGE_INVALID');
    await rm(target, { recursive: true, force: true }); await rename(app, target);
    await rebrandMacEngine(target);
    const current = join(root, 'current'); const previous = join(root, 'previous');
    let old: string | null = null; try { old = await readlink(current); } catch {}
    try { const info = await lstat(current); if (info.isSymbolicLink() || info.isFile() || info.isDirectory()) await rm(current, { recursive: true, force: true }); } catch {}
    await symlink(target, current, 'dir');
    if (old) { try { await rm(previous, { recursive: true, force: true }); await symlink(old.trim(), previous, 'dir'); } catch {} }
    await installMacBridge(home);
    return true;
  } finally { await rm(work, { recursive: true, force: true }); }
}

async function installWindowsEngine(env: NodeJS.ProcessEnv): Promise<boolean> {
  const local = env.LOCALAPPDATA;
  if (!local) throw new Error('DEVICE_RUNTIME_LOCALAPPDATA_MISSING');
  const root = pathWin32.join(local, 'AWH', 'Engines', 'device-runtime', LNWJUD_VERSION);
  const installed = pathWin32.join(root, WINDOWS_RUNTIME_EXECUTABLE);
  try { if ((await lstat(installed)).isFile()) return false; } catch {}
  await mkdir(root, { recursive: true, mode: 0o700 });
  const staged = installed + '.download';
  await rm(staged, { force: true });
  try {
    await download(`${RELEASE_BASE}/${WINDOWS_ASSET.name}`, staged);
    if ((await sha256File(staged)) !== WINDOWS_ASSET.sha256) throw new Error('DEVICE_RUNTIME_INTEGRITY_FAILED');
    await rm(installed, { force: true });
    await rename(staged, installed);
    return true;
  } finally { await rm(staged, { force: true }); }
}

interface PrivateNodeRuntime { node: string; npmCli: string; }

function toolchainRoot(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv, arch: string): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'AWH', 'Toolchain', `node-${NODE_VERSION}-${arch}`);
  const local = env.LOCALAPPDATA;
  if (!local) throw new Error('DEVICE_RUNTIME_LOCALAPPDATA_MISSING');
  return pathWin32.join(local, 'AWH', 'Toolchain', `node-${NODE_VERSION}-${arch}`);
}

async function installPrivateNode(platform: NodeJS.Platform, arch: string, home: string, env: NodeJS.ProcessEnv): Promise<PrivateNodeRuntime> {
  const key = `${platform}-${arch}` as keyof typeof NODE_ASSETS;
  const asset = NODE_ASSETS[key];
  if (!asset) throw new Error('DEVICE_RUNTIME_NODE_ARCH_UNSUPPORTED');
  const target = toolchainRoot(platform, home, env, arch);
  const node = platform === 'win32' ? pathWin32.join(target, 'node.exe') : join(target, 'bin', 'node');
  const npmCli = platform === 'win32'
    ? pathWin32.join(target, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : join(target, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  try {
    if ((await lstat(node)).isFile() && (await lstat(npmCli)).isFile()) return { node, npmCli };
  } catch {}
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const work = await mkdtemp(join(tmpdir(), 'awh-node-'));
  try {
    const archive = join(work, asset.name);
    await download(`${NODE_RELEASE_BASE}/${asset.name}`, archive);
    if ((await sha256File(archive)) !== asset.sha256) throw new Error('DEVICE_RUNTIME_NODE_INTEGRITY_FAILED');
    const extracted = join(work, 'extracted'); await mkdir(extracted, { recursive: true, mode: 0o700 });
    if (platform === 'darwin') {
      const untar = await execFile('/usr/bin/tar', ['-xzf', archive, '-C', extracted], work, 180_000);
      if (untar.code !== 0) throw new Error('DEVICE_RUNTIME_NODE_EXTRACT_FAILED');
    } else {
      const systemRoot = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows';
      const powershell = pathWin32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const command = `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${extracted.replace(/'/g, "''")}' -Force`;
      const unzip = await execFile(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], work, 180_000);
      if (unzip.code !== 0) throw new Error('DEVICE_RUNTIME_NODE_EXTRACT_FAILED');
    }
    const source = join(extracted, asset.name.replace(/\.(?:tar\.gz|zip)$/i, ''));
    const sourceInfo = await lstat(source); if (!sourceInfo.isDirectory()) throw new Error('DEVICE_RUNTIME_NODE_PACKAGE_INVALID');
    await rm(target, { recursive: true, force: true });
    await rename(source, target);
    if (!(await lstat(node)).isFile() || !(await lstat(npmCli)).isFile()) throw new Error('DEVICE_RUNTIME_NODE_PACKAGE_INVALID');
    return { node, npmCli };
  } finally { await rm(work, { recursive: true, force: true }); }
}

function systemRuntimeRoot(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'AWH', 'SystemRuntime', 'runtime');
  const local = env.LOCALAPPDATA;
  if (!local) throw new Error('DEVICE_RUNTIME_LOCALAPPDATA_MISSING');
  return pathWin32.join(local, 'AWH', 'SystemRuntime', 'runtime');
}

function systemMcpEntry(platform: NodeJS.Platform, runtime: string): string {
  return platform === 'win32'
    ? pathWin32.join(runtime, 'awh-system-mcp.mjs')
    : join(runtime, 'awh-system-mcp.mjs');
}

async function writeSystemMcpShim(runtime: string): Promise<void> {
  const source = [
    "const fmt=(xs)=>xs.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');",
    "for(const k of ['log','info','warn','error','debug']) console[k]=(...xs)=>process.stderr.write('[DC '+k.toUpperCase()+'] '+fmt(xs)+'\\n');",
    "global.disableOnboarding=true;",
    "const { StdioServerTransport } = await import('./node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js');",
    "const { server } = await import('./node_modules/@wonderwhy-er/desktop-commander/dist/server.js');",
    "await server.connect(new StdioServerTransport());",
    '',
  ].join('\n');
  await writeFile(join(runtime, 'awh-system-mcp.mjs'), source, { encoding: 'utf8', mode: 0o600 });
}

async function installSystemMcpBridge(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv, runtime: string, node: string): Promise<void> {
  await writeSystemMcpShim(runtime);
  const entry = systemMcpEntry(platform, runtime);
  if (platform === 'darwin') {
    const bin = join(home, '.awh', 'bin'); await mkdir(bin, { recursive: true, mode: 0o700 });
    const wrapper = join(bin, 'awh-system-mcp');
    await writeFile(wrapper, `#!/bin/sh\nset -eu\nexec "${node}" "${entry}" "$@"\n`, { encoding: 'utf8', mode: 0o700 });
    await chmod(wrapper, 0o700);
  } else {
    const local = env.LOCALAPPDATA; if (!local) throw new Error('DEVICE_RUNTIME_LOCALAPPDATA_MISSING');
    const bin = pathWin32.join(local, 'AWH', 'bin'); await mkdir(bin, { recursive: true, mode: 0o700 });
    const wrapper = pathWin32.join(bin, 'awh-system-mcp.cmd');
    await writeFile(wrapper, `@echo off\r\n"${node}" "${entry}" %*\r\n`, { encoding: 'utf8', mode: 0o600 });
  }
}

async function verifySystemMcpRuntime(node: string, entry: string, cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(node, [entry], { cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env });
    let buffer = '';
    let stderr = '';
    let initialized = false;
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error); else resolve();
    };
    const classifyExit = (code: number | null, signal: NodeJS.Signals | null): Error => {
      if (/ERR_MODULE_NOT_FOUND|Cannot find module/i.test(stderr)) return new Error('DEVICE_RUNTIME_SYSTEM_DEPENDENCY_MISSING');
      if (signal) return new Error('DEVICE_RUNTIME_SYSTEM_SMOKE_SIGNAL_' + signal.replace(/[^A-Z0-9]/gi, '_').toUpperCase());
      if (typeof code === 'number') return new Error('DEVICE_RUNTIME_SYSTEM_SMOKE_EXIT_' + code);
      return new Error('DEVICE_RUNTIME_SYSTEM_SMOKE_EXIT_UNKNOWN');
    };
    const timer = setTimeout(() => finish(new Error('DEVICE_RUNTIME_SYSTEM_SMOKE_TIMEOUT')), 30_000);
    child.once('error', () => finish(new Error('DEVICE_RUNTIME_SYSTEM_SMOKE_SPAWN_FAILED')));
    child.once('exit', (code, signal) => { if (!settled) finish(classifyExit(code, signal)); });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-64 * 1024);
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (settled) return;
      buffer += chunk;
      if (buffer.length > 256 * 1024) return finish(new Error('DEVICE_RUNTIME_SYSTEM_SMOKE_OVERFLOW'));
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim().startsWith('{')) continue;
        let message: unknown;
        try { message = JSON.parse(line); } catch { continue; }
        if (!message || typeof message !== 'object' || Array.isArray(message)) continue;
        const row = message as Record<string, unknown>;
        if (row.id === 1 && !initialized) {
          const result = row.result as Record<string, unknown> | undefined;
          const server = result?.serverInfo as Record<string, unknown> | undefined;
          if (server?.version !== SYSTEM_MCP_VERSION) return finish(new Error('DEVICE_RUNTIME_SYSTEM_SMOKE_VERSION_MISMATCH'));
          initialized = true;
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
        } else if (row.id === 2) {
          const result = row.result as Record<string, unknown> | undefined;
          const tools = result?.tools;
          if (!Array.isArray(tools) || tools.length < 10) return finish(new Error('DEVICE_RUNTIME_SYSTEM_TOOLS_MISSING'));
          return finish();
        }
      }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'awh-device-bootstrap', version: '1' } } }) + '\n');
  });
}

async function installAndVerifySystemMcpRuntime(platform: NodeJS.Platform, runtime: string, privateNode: PrivateNodeRuntime, env: NodeJS.ProcessEnv): Promise<void> {
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ name: 'awh-system-runtime', private: true, version: '1.0.0', dependencies: { [SYSTEM_MCP_PACKAGE]: SYSTEM_MCP_VERSION } }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  const install = await execFile(privateNode.node, [privateNode.npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', `${SYSTEM_MCP_PACKAGE}@${SYSTEM_MCP_VERSION}`], runtime, 300_000, { ...env, npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' });
  if (install.code !== 0) throw new Error('DEVICE_RUNTIME_SYSTEM_INSTALL_FAILED');
  const packagePath = platform === 'win32'
    ? pathWin32.join(runtime, 'node_modules', '@wonderwhy-er', 'desktop-commander', 'package.json')
    : join(runtime, 'node_modules', '@wonderwhy-er', 'desktop-commander', 'package.json');
  const entry = systemMcpEntry(platform, runtime);
  const installed = JSON.parse(await readFile(packagePath, 'utf8')) as { version?: unknown };
  if (installed.version !== SYSTEM_MCP_VERSION) throw new Error('DEVICE_RUNTIME_SYSTEM_VERSION_MISMATCH');
  const lock = JSON.parse(await readFile(join(runtime, 'package-lock.json'), 'utf8')) as { packages?: Record<string, { version?: string; integrity?: string }> };
  const row = lock.packages?.['node_modules/@wonderwhy-er/desktop-commander'];
  if (row?.version !== SYSTEM_MCP_VERSION || row.integrity !== SYSTEM_MCP_INTEGRITY) throw new Error('DEVICE_RUNTIME_SYSTEM_INTEGRITY_FAILED');
  await writeSystemMcpShim(runtime);
  await verifySystemMcpRuntime(privateNode.node, entry, runtime, env);
}

async function ensureSystemMcpRuntime(platform: NodeJS.Platform, arch: string, home: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  if (platform === 'win32' && arch !== 'x64') throw new Error('DEVICE_RUNTIME_SYSTEM_ARCH_UNSUPPORTED');
  if (platform === 'darwin' && arch !== 'arm64' && arch !== 'x64') throw new Error('DEVICE_RUNTIME_SYSTEM_ARCH_UNSUPPORTED');
  const privateNode = await installPrivateNode(platform, arch, home, env);
  const runtime = systemRuntimeRoot(platform, home, env);
  const packagePath = platform === 'win32'
    ? pathWin32.join(runtime, 'node_modules', '@wonderwhy-er', 'desktop-commander', 'package.json')
    : join(runtime, 'node_modules', '@wonderwhy-er', 'desktop-commander', 'package.json');
  const entry = systemMcpEntry(platform, runtime);
  let current = '';
  try {
    const parsed = JSON.parse(await readFile(packagePath, 'utf8')) as { version?: unknown };
    current = typeof parsed.version === 'string' ? parsed.version : '';
  } catch {}
  if (current === SYSTEM_MCP_VERSION) {
    try {
      await installSystemMcpBridge(platform, home, env, runtime, privateNode.node);
      await verifySystemMcpRuntime(privateNode.node, entry, runtime, env);
      return false;
    } catch {
      const staged = runtime + '.repair';
      const previous = runtime + '.previous';
      await rm(staged, { recursive: true, force: true });
      await installAndVerifySystemMcpRuntime(platform, staged, privateNode, env);
      await rm(previous, { recursive: true, force: true });
      await rename(runtime, previous);
      try { await rename(staged, runtime); }
      catch (error) { await rename(previous, runtime).catch(() => undefined); throw error; }
      await installSystemMcpBridge(platform, home, env, runtime, privateNode.node);
      await verifySystemMcpRuntime(privateNode.node, entry, runtime, env);
      return true;
    }
  }
  await installAndVerifySystemMcpRuntime(platform, runtime, privateNode, env);
  await installSystemMcpBridge(platform, home, env, runtime, privateNode.node);
  return true;
}

async function readinessFile(dataDir: string, result: DeviceBootstrapResult): Promise<void> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await writeFile(join(dataDir, 'device-runtime-readiness.json'), JSON.stringify({ schemaVersion: 1, ...result, verifiedAt: new Date().toISOString(), source: 'pinned-audited-device-runtime' }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

export async function ensureAwhDeviceRuntime(dataDir: string, platform: NodeJS.Platform = process.platform, arch: string = process.arch, home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<DeviceBootstrapResult> {
  if (!['darwin', 'win32'].includes(platform)) {
    const result: DeviceBootstrapResult = { state: 'UNSUPPORTED', version: null, installed: false, verified: false, reason: 'PLATFORM_NOT_SUPPORTED' };
    await readinessFile(dataDir, result); return result;
  }
  try {
    if (platform === 'darwin') {
      if (arch !== 'arm64' && arch !== 'x64') throw new Error('DEVICE_RUNTIME_ARCH_UNSUPPORTED');
      await installMacEngine(home, arch);
    } else await installWindowsEngine(env);
    // AWH Device Runtime owns the full device tool surface. Remote Desktop Commander
    // remains an independent fallback and must not be duplicated under AWH/SystemRuntime.
    // Tool Packs are provisioned lazily on first routed use; Agent bootstrap never installs them eagerly.
    const installed = true;
    const spec = await discoverLnwjudLaunchSpec(platform, home, env);
    if (!spec) throw new Error('DEVICE_RUNTIME_LAUNCHER_MISSING');
    const smokeRoot = join(dataDir, 'device-runtime-smoke');
    const client = await LnwjudDeviceClient.open(smokeRoot);
    try { await client.callTool('health', { operation: 'check_all' }, 20_000); } finally { client.close(); }
    const result: DeviceBootstrapResult = { state: 'READY', version: LNWJUD_VERSION, installed, verified: true, reason: null };
    await readinessFile(dataDir, result); return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message.replace(/[^A-Z0-9_.-]/gi, '_').slice(0, 120) : 'DEVICE_RUNTIME_BOOTSTRAP_FAILED';
    const result: DeviceBootstrapResult = { state: 'FAILED', version: null, installed: false, verified: false, reason };
    await readinessFile(dataDir, result).catch(() => undefined); return result;
  }
}
