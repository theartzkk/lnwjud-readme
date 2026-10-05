import { createHash } from 'node:crypto';
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
  deviceEngine: {
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
const AWH_RUNTIME_HEALTH_MARKER = 'AWH_HEALTH_ACCESSIBILITY_RECONCILE_V1';
const AWH_RUNTIME_APPROVAL_BRIDGE_MARKER = 'AWH_EXACT_APPROVAL_BRIDGE_V2';
const AWH_RUNTIME_APPROVAL_INLINE_MARKER = 'AWH_EXACT_APPROVAL_INLINE_V1';
const AWH_RUNTIME_APPROVAL_BRIDGE_V1_MARKER = 'var AWH_EXACT_APPROVAL_BRIDGE_V1 = true;';
const AWH_RUNTIME_NATIVE_HOST_NAME = 'AWHDeviceRuntimeHost';
const AWH_RUNTIME_BUNDLE_ID = 'online.kruart.awh-device-runtime';
const AWH_RUNTIME_DESIGNATED_REQUIREMENT = '=designated => identifier "online.kruart.awh-device-runtime"';
let freshAsarReadSequence = 0;
async function withFreshAsarRead<T>(archive: string, reader: (freshArchive: string) => T): Promise<T> {
  const fresh = archive + '.awh-read-' + String(process.pid) + '-' + String(++freshAsarReadSequence);
  await copyFile(archive, fresh);
  try { return reader(fresh); }
  finally { await rm(fresh, { force: true }).catch(() => undefined); }
}

async function readAsarMainFresh(archive: string): Promise<string> {
  return withFreshAsarRead(archive, (fresh) => extractFile(fresh, 'dist/main/main.js').toString('utf8'));
}

async function readAsarHeaderFresh(archive: string): Promise<string> {
  return withFreshAsarRead(archive, (fresh) => getRawHeader(fresh).headerString);
}

async function patchMacHeadlessRuntime(appRoot: string): Promise<void> {
  const archive = join(appRoot, 'Contents', 'Resources', 'app.asar');
  let currentMain: string;
  try { currentMain = extractFile(archive, 'dist/main/main.js').toString('utf8'); }
  catch { throw new Error('DEVICE_RUNTIME_PATCH_SOURCE_INVALID'); }
  if (currentMain.includes(AWH_HEADLESS_PATCH_MARKER) && currentMain.includes(AWH_RUNTIME_NAME_MARKER) && currentMain.includes(AWH_RUNTIME_MCP_NAME_MARKER) && currentMain.includes(AWH_RUNTIME_INSTRUCTIONS_MARKER) && currentMain.includes(AWH_RUNTIME_READY_MARKER) && currentMain.includes(AWH_RUNTIME_PERMISSION_MARKER) && currentMain.includes(AWH_RUNTIME_HEALTH_MARKER) && currentMain.includes(AWH_RUNTIME_APPROVAL_BRIDGE_MARKER) && currentMain.includes(AWH_RUNTIME_APPROVAL_INLINE_MARKER) && currentMain.includes(AWH_RUNTIME_NATIVE_HOST_NAME)) return;

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
    if (!nextMain.includes(AWH_RUNTIME_HEALTH_MARKER)) {
      const healthContract = '    const composed = this.backends[tool];\n    if (composed !== void 0)\n      return this.describe(tool, await this.checkDelegated(composed, statusInputFor(tool)));';
      const healthReplacement = '    const composed = this.backends[tool];\n'
        + '    if (composed !== void 0) {\n'
        + '      const status = await this.checkDelegated(composed, statusInputFor(tool));\n'
        + '      if (tool === "accessibility" && status.ready === false && status.hostAvailable !== false && status.hostReady !== false) {\n'
        + '        const probe = await this.checkDelegated(composed, { action: "list_windows" });\n'
        + '        if (probe.available !== false && probe.ready !== false) {\n'
        + '          return this.describe(tool, { ...status, available: true, ready: true, reason: void 0, readinessReason: void 0, healthReconciledBy: "' + AWH_RUNTIME_HEALTH_MARKER + '" });\n'
        + '        }\n'
        + '      }\n'
        + '      return this.describe(tool, status);\n'
        + '    }';
      const healthContractMatches = nextMain.split(healthContract).length - 1;
      if (healthContractMatches < 1) throw new Error('DEVICE_RUNTIME_HEALTH_PATCH_CONTRACT_MISMATCH');
      nextMain = nextMain.replaceAll(healthContract, healthReplacement);
    }
    if (!nextMain.includes(AWH_RUNTIME_APPROVAL_BRIDGE_MARKER) && nextMain.includes(AWH_RUNTIME_APPROVAL_BRIDGE_V1_MARKER)) {
      nextMain = nextMain.replace(AWH_RUNTIME_APPROVAL_BRIDGE_V1_MARKER, 'var AWH_EXACT_APPROVAL_BRIDGE_V2 = true;');
      const approvalV1Fallback = '        if (!hostApproved && this.hostMutationApprovalProvider === void 0 && hasExplicitUserConfirmation(activeRoutedInput)) {';
      const approvalV2Fallback = '        if (!hostApproved && process.env.AWH_DEVICE_RUNTIME_HEADLESS === "1" && hasExplicitUserConfirmation(activeRoutedInput)) {';
      if (nextMain.includes(approvalV1Fallback)) nextMain = nextMain.replace(approvalV1Fallback, approvalV2Fallback);
      else if (!nextMain.includes(approvalV2Fallback)) throw new Error('DEVICE_RUNTIME_APPROVAL_V1_FALLBACK_MIGRATION_MISMATCH');
      const approvalV1Denied = `          const message = this.hostMutationApprovalProvider === void 0
            ? "Host exact-action approval is unavailable for this mutation; provide explicit user confirmation to prepare a one-shot approval token"
            : "The host denied or could not verify exact-action approval for this mutation";`;
      const approvalV2Denied = `          const message = process.env.AWH_DEVICE_RUNTIME_HEADLESS === "1"
            ? "Headless exact-action approval requires explicit owner confirmation for this exact action"
            : this.hostMutationApprovalProvider === void 0
              ? "Host exact-action approval is unavailable for this mutation; use Desktop or a trusted host approval adapter"
              : "The host denied or could not verify exact-action approval for this mutation";`;
      if (nextMain.includes(approvalV1Denied)) nextMain = nextMain.replace(approvalV1Denied, approvalV2Denied);
      else if (!nextMain.includes(approvalV2Denied)) throw new Error('DEVICE_RUNTIME_APPROVAL_V1_MESSAGE_MIGRATION_MISMATCH');
    }
    if (!nextMain.includes(AWH_RUNTIME_APPROVAL_BRIDGE_MARKER)) {
      const approvalSchemaMarker = 'var approvalEnvelopeSchema = external_exports.boolean();\n';
      if (!nextMain.includes(approvalSchemaMarker)) throw new Error('DEVICE_RUNTIME_APPROVAL_SCHEMA_CONTRACT_MISMATCH');
      const approvalHelpers = `var approvalEnvelopeSchema = external_exports.boolean();
var AWH_EXACT_APPROVAL_BRIDGE_V2 = true;
var AWH_EXACT_APPROVAL_INLINE_V1 = true;
var awhExactApprovalTokenSchema = external_exports.string().regex(/^[A-Za-z0-9_-]{43}$/);
var AWH_EXACT_APPROVAL_TTL_MS = 12e4;
var AWH_EXACT_APPROVAL_MAX = 256;
var awhExactApprovalTokens = /* @__PURE__ */ new Map();
var awhExactInlineApprovals = /* @__PURE__ */ new Map();
function awhExactApprovalSignature(toolName, mutationKind, input, activeWorkspaceScope, mutationWorkspaceId) {
  return JSON.stringify({
    toolName,
    mutationKind,
    summary: summarizeMutationForApproval(toolName, input, activeWorkspaceScope),
    workspaceId: mutationWorkspaceId ?? "",
    workspaceRoot: activeWorkspaceScope?.rootPath ?? ""
  });
}
function awhPruneExactApprovalTokens(now = Date.now()) {
  for (const [token, entry] of awhExactApprovalTokens) {
    if (entry.expiresAt <= now) awhExactApprovalTokens.delete(token);
  }
  while (awhExactApprovalTokens.size >= AWH_EXACT_APPROVAL_MAX) {
    const oldest = awhExactApprovalTokens.keys().next().value;
    if (typeof oldest !== "string") break;
    awhExactApprovalTokens.delete(oldest);
  }
}
function awhAcceptInlineExactApproval(signature, now = Date.now()) {
  for (const [key, expiresAt] of awhExactInlineApprovals) {
    if (expiresAt <= now) awhExactInlineApprovals.delete(key);
  }
  const existing = awhExactInlineApprovals.get(signature);
  if (typeof existing === "number" && existing > now) return false;
  while (awhExactInlineApprovals.size >= AWH_EXACT_APPROVAL_MAX) {
    const oldest = awhExactInlineApprovals.keys().next().value;
    if (typeof oldest !== "string") break;
    awhExactInlineApprovals.delete(oldest);
  }
  awhExactInlineApprovals.set(signature, now + AWH_EXACT_APPROVAL_TTL_MS);
  return true;
}
function awhIssueExactApprovalToken(signature) {
  awhPruneExactApprovalTokens();
  const token = randomBytes8(32).toString("base64url");
  awhExactApprovalTokens.set(token, { signature, expiresAt: Date.now() + AWH_EXACT_APPROVAL_TTL_MS });
  return token;
}
function awhConsumeExactApprovalToken(token, signature) {
  awhPruneExactApprovalTokens();
  const entry = awhExactApprovalTokens.get(token);
  if (entry === void 0) return false;
  awhExactApprovalTokens.delete(token);
  return entry.expiresAt > Date.now() && entry.signature === signature;
}
function awhReadExactApprovalToken(input) {
  if (!isRecord38(input) || typeof input.approvalToken !== "string") return void 0;
  const parsed = awhExactApprovalTokenSchema.safeParse(input.approvalToken);
  return parsed.success ? parsed.data : void 0;
}
`;
      nextMain = nextMain.replace(approvalSchemaMarker, approvalHelpers);

      const approvalEnvelopeStart = nextMain.indexOf('function withApprovalEnvelope(tool) {\n');
      const approvalEnvelopeEnd = nextMain.indexOf('function withGoalLeaseEnvelope(tool) {\n', approvalEnvelopeStart);
      if (approvalEnvelopeStart < 0 || approvalEnvelopeEnd < 0) throw new Error('DEVICE_RUNTIME_APPROVAL_ENVELOPE_CONTRACT_MISMATCH');
      const approvalEnvelopeReplacement = `function withApprovalEnvelope(tool) {
  const extendObjectSchema = (schema) => schema.safeExtend({
    userConfirmed: approvalEnvelopeSchema.optional(),
    approvalToken: awhExactApprovalTokenSchema.optional()
  });
  const inputSchema = tool.inputSchema instanceof external_exports.ZodObject ? extendObjectSchema(tool.inputSchema) : tool.inputSchema instanceof external_exports.ZodUnion ? external_exports.union(tool.inputSchema.options.map((option) => {
    if (!(option instanceof external_exports.ZodObject)) {
      throw new Error(\`Tool \${tool.name} union input branches must use object schemas\`);
    }
    return extendObjectSchema(option);
  })) : tool.inputSchema;
  if (inputSchema === tool.inputSchema)
    return tool;
  return {
    ...tool,
    inputSchema,
    parse(input) {
      const rawConfirmation = isRecord38(input) ? input.userConfirmed : void 0;
      const rawApprovalToken = isRecord38(input) ? input.approvalToken : void 0;
      const parsedConfirmation = rawConfirmation === void 0 ? void 0 : approvalEnvelopeSchema.safeParse(rawConfirmation);
      const parsedApprovalToken = rawApprovalToken === void 0 ? void 0 : awhExactApprovalTokenSchema.safeParse(rawApprovalToken);
      if (parsedConfirmation !== void 0 && !parsedConfirmation.success)
        return err(appError("INVALID_INPUT", "userConfirmed is invalid"));
      if (parsedApprovalToken !== void 0 && !parsedApprovalToken.success)
        return err(appError("INVALID_INPUT", "approvalToken is invalid"));
      const parsed = tool.parse(stripUserConfirmationEnvelope(input));
      if (!parsed.ok || parsedConfirmation === void 0 && parsedApprovalToken === void 0)
        return parsed;
      if (!isRecord38(parsed.value))
        return err(appError("INVALID_INPUT", "Tool input must be an object"));
      return ok({
        ...parsed.value,
        ...parsedConfirmation === void 0 ? {} : { userConfirmed: parsedConfirmation.data },
        ...parsedApprovalToken === void 0 ? {} : { approvalToken: parsedApprovalToken.data }
      });
    }
  };
}
`;
      nextMain = nextMain.slice(0, approvalEnvelopeStart) + approvalEnvelopeReplacement + nextMain.slice(approvalEnvelopeEnd);

      const stripApprovalStart = nextMain.indexOf('function stripUserConfirmationEnvelope(input) {\n');
      const stripApprovalEnd = nextMain.indexOf('function startGoalMutationFenceHeartbeat', stripApprovalStart);
      if (stripApprovalStart < 0 || stripApprovalEnd < 0) throw new Error('DEVICE_RUNTIME_APPROVAL_STRIP_CONTRACT_MISMATCH');
      const stripApprovalReplacement = `function stripUserConfirmationEnvelope(input) {
  if (!isRecord38(input))
    return input;
  if (!Object.prototype.hasOwnProperty.call(input, "userConfirmed") && !Object.prototype.hasOwnProperty.call(input, "approvalToken"))
    return input;
  return Object.fromEntries(Object.entries(input).filter(([key]) => key !== "userConfirmed" && key !== "approvalToken"));
}
`;
      nextMain = nextMain.slice(0, stripApprovalStart) + stripApprovalReplacement + nextMain.slice(stripApprovalEnd);

      const hostApprovalStartMarker = '      if (hostApprovalRequired && !policyAllowsScopedDestructive) {\n';
      const hostApprovalEndMarker = '      if (mutationFenceProof !== void 0 && mutationFenceWorkspaceId !== void 0 && this.services.goalMutationFence !== void 0) {\n';
      const hostApprovalStart = nextMain.indexOf(hostApprovalStartMarker);
      const hostApprovalEnd = nextMain.indexOf(hostApprovalEndMarker, hostApprovalStart);
      if (hostApprovalStart < 0 || hostApprovalEnd < 0) throw new Error('DEVICE_RUNTIME_HOST_APPROVAL_CONTRACT_MISMATCH');
      const hostApprovalReplacement = `      if (hostApprovalRequired && !policyAllowsScopedDestructive) {
        const exactApprovalSignature = awhExactApprovalSignature(tool.name, mutationDecision.kind, approvalExecutionInput, activeWorkspaceScope, mutationWorkspaceId);
        const presentedApprovalToken = awhReadExactApprovalToken(activeRoutedInput);
        let hostApproved = presentedApprovalToken !== void 0 && awhConsumeExactApprovalToken(presentedApprovalToken, exactApprovalSignature);
        if (presentedApprovalToken !== void 0 && !hostApproved) {
          const message = "AWH exact-action approval token is invalid, expired, already used, or does not match this exact action";
          const response2 = mapError2(appError("PERMISSION_DENIED", message));
          await this.activity.end(callId, "PERMISSION_DENIED", Date.now() - started, message);
          return response2;
        }
        if (!hostApproved && this.hostMutationApprovalProvider !== void 0) {
          try {
            hostApproved = await this.hostMutationApprovalProvider({
              toolName: tool.name,
              mutationKind: mutationDecision.kind,
              reason: mutationDecision.reason,
              summary: summarizeMutationForApproval(tool.name, approvalExecutionInput, activeWorkspaceScope),
              ...mutationWorkspaceId === void 0 ? {} : { workspaceId: mutationWorkspaceId },
              ...activeWorkspaceScope === null ? {} : { workspaceRoot: activeWorkspaceScope.rootPath }
            });
          } catch {
            hostApproved = false;
          }
        }
        if (!hostApproved && process.env.AWH_DEVICE_RUNTIME_HEADLESS === "1" && hasExplicitUserConfirmation(activeRoutedInput)) {
          if (!awhAcceptInlineExactApproval(exactApprovalSignature)) {
            const message = "AWH exact-action owner approval was already consumed for this exact action";
            const response2 = mapError2(appError("PERMISSION_DENIED", message));
            await this.activity.end(callId, "PERMISSION_DENIED", Date.now() - started, message);
            return response2;
          }
          hostApproved = true;
        }
        if (!hostApproved) {
          const message = process.env.AWH_DEVICE_RUNTIME_HEADLESS === "1"
            ? "Headless exact-action approval requires explicit owner confirmation for this exact action"
            : this.hostMutationApprovalProvider === void 0
              ? "Host exact-action approval is unavailable for this mutation; use Desktop or a trusted host approval adapter"
              : "The host denied or could not verify exact-action approval for this mutation";
          const response2 = mapError2(appError("PERMISSION_DENIED", message));
          await this.activity.end(callId, "PERMISSION_DENIED", Date.now() - started, message);
          return response2;
        }
      }
`;
      nextMain = nextMain.slice(0, hostApprovalStart) + hostApprovalReplacement + nextMain.slice(hostApprovalEnd);
      if (!nextMain.includes(AWH_RUNTIME_APPROVAL_BRIDGE_MARKER)
        || !nextMain.includes(AWH_RUNTIME_APPROVAL_INLINE_MARKER)
        || !nextMain.includes('approvalToken: awhExactApprovalTokenSchema.optional()')
        || !nextMain.includes('awhConsumeExactApprovalToken')
        || !nextMain.includes('awhAcceptInlineExactApproval')
        || !nextMain.includes('AWH exact-action owner approval was already consumed for this exact action')) {
        throw new Error('DEVICE_RUNTIME_APPROVAL_PATCH_VERIFY_FAILED');
      }
    }
    if (!nextMain.includes(AWH_RUNTIME_NATIVE_HOST_NAME)) {
      if (!nextMain.includes('lnwjud-macos-host')) throw new Error('DEVICE_RUNTIME_NATIVE_HOST_PATCH_CONTRACT_MISMATCH');
      nextMain = nextMain.replaceAll('lnwjud-macos-host', AWH_RUNTIME_NATIVE_HOST_NAME);
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
    if (!patched.includes(AWH_HEADLESS_PATCH_MARKER) || !patched.includes(AWH_RUNTIME_NAME_MARKER) || !patched.includes(AWH_RUNTIME_MCP_NAME_MARKER) || !patched.includes(AWH_RUNTIME_INSTRUCTIONS_MARKER) || !patched.includes(AWH_RUNTIME_READY_MARKER) || !patched.includes(AWH_RUNTIME_PERMISSION_MARKER) || !patched.includes(AWH_RUNTIME_HEALTH_MARKER) || !patched.includes(AWH_RUNTIME_APPROVAL_BRIDGE_MARKER) || !patched.includes(AWH_RUNTIME_APPROVAL_INLINE_MARKER) || !patched.includes('approvalToken: awhExactApprovalTokenSchema.optional()') || !patched.includes('awhConsumeExactApprovalToken') || !patched.includes('awhAcceptInlineExactApproval') || !patched.includes('process.env.AWH_DEVICE_RUNTIME_HEADLESS === "1" && hasExplicitUserConfirmation(activeRoutedInput)') || !patched.includes(AWH_RUNTIME_NATIVE_HOST_NAME) || patched.includes('lnwjud-macos-host') || patched.includes(AWH_RUNTIME_PERMISSION_V1_MARKER)) throw new Error('DEVICE_RUNTIME_PATCH_VERIFY_FAILED');
    if (patchedPackage.name !== 'awh-device-runtime' || patchedPackage.productName !== 'AWH Device Runtime') throw new Error('DEVICE_RUNTIME_PACKAGE_IDENTITY_VERIFY_FAILED');
    await rm(backup, { force: true });
    await rename(archive, backup);
    try {
      await rename(next, archive);
      const committed = await readAsarMainFresh(archive);
      if (!committed.includes(AWH_HEADLESS_PATCH_MARKER)
        || !committed.includes(AWH_RUNTIME_NAME_MARKER)
        || !committed.includes(AWH_RUNTIME_MCP_NAME_MARKER)
        || !committed.includes(AWH_RUNTIME_INSTRUCTIONS_MARKER)
        || !committed.includes(AWH_RUNTIME_READY_MARKER)
        || !committed.includes(AWH_RUNTIME_PERMISSION_MARKER)
        || !committed.includes(AWH_RUNTIME_HEALTH_MARKER)
        || !committed.includes(AWH_RUNTIME_APPROVAL_BRIDGE_MARKER)
        || !committed.includes(AWH_RUNTIME_APPROVAL_INLINE_MARKER)
        || !committed.includes('approvalToken: awhExactApprovalTokenSchema.optional()')
        || !committed.includes('awhConsumeExactApprovalToken')
        || !committed.includes('awhAcceptInlineExactApproval')
        || !committed.includes('process.env.AWH_DEVICE_RUNTIME_HEADLESS === "1" && hasExplicitUserConfirmation(activeRoutedInput)')
        || !committed.includes(AWH_RUNTIME_NATIVE_HOST_NAME)
        || committed.includes('lnwjud-macos-host')) {
        throw new Error('DEVICE_RUNTIME_PATCH_COMMIT_VERIFY_FAILED');
      }
    } catch (error) {
      await rm(archive, { force: true }).catch(() => undefined);
      await rename(backup, archive).catch(() => undefined);
      throw error;
    }
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
    await rm(next, { force: true }).catch(() => undefined);
  }
}

async function rebrandMacNativeHosts(appRoot: string): Promise<void> {
  const nativeRoot = join(appRoot, 'Contents', 'Resources', 'native-host', 'macos');
  try {
    for (const entry of await readdir(nativeRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const archRoot = join(nativeRoot, entry.name);
      const legacy = join(archRoot, 'lnwjud-macos-host');
      const branded = join(archRoot, AWH_RUNTIME_NATIVE_HOST_NAME);
      const manifestPath = join(archRoot, 'NATIVE_HOST.json');
      let brandedReady = false;
      try { brandedReady = (await lstat(branded)).isFile(); } catch {}
      if (!brandedReady) {
        const legacyInfo = await lstat(legacy);
        if (!legacyInfo.isFile() || legacyInfo.isSymbolicLink()) throw new Error('DEVICE_RUNTIME_NATIVE_HOST_REBRAND_INVALID');
        await rename(legacy, branded);
      } else {
        await rm(legacy, { force: true }).catch(() => undefined);
      }
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
      if (manifest.name !== 'lnwjud-macos-host' && manifest.name !== AWH_RUNTIME_NATIVE_HOST_NAME) {
        throw new Error('DEVICE_RUNTIME_NATIVE_HOST_MANIFEST_INVALID');
      }
      if (manifest.arch !== entry.name || manifest.platform !== 'darwin') {
        throw new Error('DEVICE_RUNTIME_NATIVE_HOST_MANIFEST_INVALID');
      }
      manifest.name = AWH_RUNTIME_NATIVE_HOST_NAME;
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
      const verifiedManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
      if (verifiedManifest.name !== AWH_RUNTIME_NATIVE_HOST_NAME) throw new Error('DEVICE_RUNTIME_NATIVE_HOST_MANIFEST_VERIFY_FAILED');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('DEVICE_RUNTIME_NATIVE_HOST_REBRAND_MISSING');
    throw error;
  }
}

async function rebrandMacEngine(appRoot: string): Promise<void> {
  const archive = join(appRoot, 'Contents', 'Resources', 'app.asar');
  const backup = archive + '.awh-upstream';
  await patchMacHeadlessRuntime(appRoot);
  await rebrandMacNativeHosts(appRoot);
  const plist = join(appRoot, 'Contents', 'Info.plist');
  const asarIntegrity = createHash('sha256').update(await readAsarHeaderFresh(archive)).digest('hex');
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
    ['CFBundleIdentifier', '-string', AWH_RUNTIME_BUNDLE_ID],
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
  const sign = await execFile('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '-i', AWH_RUNTIME_BUNDLE_ID, '-r', AWH_RUNTIME_DESIGNATED_REQUIREMENT, appRoot], appRoot, 180_000);
  if (sign.code !== 0) throw new Error('DEVICE_RUNTIME_REBRAND_SIGN_FAILED');
  const finalMain = await readAsarMainFresh(archive);
  if (!finalMain.includes(AWH_HEADLESS_PATCH_MARKER)
    || !finalMain.includes(AWH_RUNTIME_NAME_MARKER)
    || !finalMain.includes(AWH_RUNTIME_MCP_NAME_MARKER)
    || !finalMain.includes(AWH_RUNTIME_INSTRUCTIONS_MARKER)
    || !finalMain.includes(AWH_RUNTIME_READY_MARKER)
    || !finalMain.includes(AWH_RUNTIME_PERMISSION_MARKER)
    || !finalMain.includes(AWH_RUNTIME_HEALTH_MARKER)
    || !finalMain.includes(AWH_RUNTIME_NATIVE_HOST_NAME)
    || finalMain.includes('lnwjud-macos-host')) {
    throw new Error('DEVICE_RUNTIME_REBRAND_FINAL_VERIFY_FAILED');
  }
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
  const probeRoot = await mkdtemp(join(tmpdir(), 'awh-device-permission-'));
  const dataPath = join(probeRoot, 'runtime');
  await mkdir(dataPath, { recursive: true, mode: 0o700 });
  const env: NodeJS.ProcessEnv = { ...process.env, AWH_DEVICE_RUNTIME_HEADLESS: '1', LNWJUD_DATA_PATH: dataPath };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
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
  } finally {
    await rm(probeRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function macEngineVerificationFailure(appRoot: string, arch: 'arm64' | 'x64'): Promise<string | null> {
  try {
    const executable = join(appRoot, 'Contents', 'MacOS', MAC_RUNTIME_EXECUTABLE);
    if (!(await lstat(executable)).isFile()) return 'DEVICE_RUNTIME_VERIFY_EXECUTABLE_MISSING';
    const archive = join(appRoot, 'Contents', 'Resources', 'app.asar');
    const main = await readAsarMainFresh(archive);
    const markers: Array<[string, string]> = [
      [AWH_HEADLESS_PATCH_MARKER, 'HEADLESS'],
      [AWH_RUNTIME_NAME_MARKER, 'RUNTIME_NAME'],
      [AWH_RUNTIME_MCP_NAME_MARKER, 'MCP_NAME'],
      [AWH_RUNTIME_INSTRUCTIONS_MARKER, 'INSTRUCTIONS'],
      [AWH_RUNTIME_READY_MARKER, 'READY'],
      [AWH_RUNTIME_PERMISSION_MARKER, 'PERMISSION'],
      [AWH_RUNTIME_HEALTH_MARKER, 'HEALTH'],
      [AWH_RUNTIME_APPROVAL_BRIDGE_MARKER, 'APPROVAL_BRIDGE'],
      [AWH_RUNTIME_APPROVAL_INLINE_MARKER, 'APPROVAL_INLINE'],
      [AWH_RUNTIME_NATIVE_HOST_NAME, 'NATIVE_HOST_NAME'],
    ];
    for (const [marker, name] of markers) if (!main.includes(marker)) return 'DEVICE_RUNTIME_VERIFY_MARKER_' + name + '_MISSING';
    if (main.includes('lnwjud-macos-host')) return 'DEVICE_RUNTIME_VERIFY_LEGACY_NATIVE_STRING_PRESENT';
    const hostRoot = join(appRoot, 'Contents', 'Resources', 'native-host', 'macos', arch);
    const host = join(hostRoot, AWH_RUNTIME_NATIVE_HOST_NAME);
    const hostInfo = await lstat(host);
    if (!hostInfo.isFile()) return 'DEVICE_RUNTIME_VERIFY_NATIVE_HOST_MISSING';
    try {
      if ((await lstat(join(hostRoot, 'lnwjud-macos-host'))).isFile()) return 'DEVICE_RUNTIME_VERIFY_LEGACY_NATIVE_FILE_PRESENT';
    } catch {}
    const hostManifest = JSON.parse(await readFile(join(hostRoot, 'NATIVE_HOST.json'), 'utf8')) as Record<string, unknown>;
    if (hostManifest.name !== AWH_RUNTIME_NATIVE_HOST_NAME) return 'DEVICE_RUNTIME_VERIFY_NATIVE_HOST_MANIFEST_NAME';
    if (hostManifest.platform !== 'darwin' || hostManifest.arch !== arch) return 'DEVICE_RUNTIME_VERIFY_NATIVE_HOST_MANIFEST_PLATFORM';
    if (typeof hostManifest.sha256 !== 'string' || await sha256File(host) !== hostManifest.sha256) return 'DEVICE_RUNTIME_VERIFY_NATIVE_HOST_MANIFEST_HASH';
    if (typeof hostManifest.sizeBytes !== 'number' || hostInfo.size !== hostManifest.sizeBytes) return 'DEVICE_RUNTIME_VERIFY_NATIVE_HOST_MANIFEST_SIZE';
    const signed = await execFile('/usr/bin/codesign', ['--verify', '--deep', '--strict', appRoot], appRoot, 180_000);
    if (signed.code !== 0) return 'DEVICE_RUNTIME_VERIFY_CODESIGN_' + String(signed.code);
    const designated = await execFile('/usr/bin/codesign', ['-dr', '-', appRoot], appRoot, 30_000);
    const designatedText = designated.stdout + '\n' + designated.stderr;
    if (designated.code !== 0 || !designatedText.includes('designated => identifier "online.kruart.awh-device-runtime"') || designatedText.includes('cdhash H"')) return 'DEVICE_RUNTIME_VERIFY_UNSTABLE_DESIGNATED_REQUIREMENT';
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/[^A-Z0-9_.-]/gi, '_').slice(0, 100) : 'UNKNOWN';
    return 'DEVICE_RUNTIME_VERIFY_EXCEPTION_' + message;
  }
}

async function verifyMacEngineBundleStable(appRoot: string, arch: 'arm64' | 'x64', attempts = 3): Promise<{ ok: boolean; failure: string | null }> {
  let failure: string | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    failure = await macEngineVerificationFailure(appRoot, arch);
    if (failure === null) return { ok: true, failure: null };
    if (attempt < attempts) await new Promise<void>((resolve) => setTimeout(resolve, attempt * 150));
  }
  return { ok: false, failure };
}

async function installMacEngine(home: string, arch: 'arm64' | 'x64', forceRepair = false): Promise<boolean> {
  const asset = MAC_ASSETS[arch];
  const root = join(home, 'Library', 'Application Support', 'AWH', 'Engines', 'lnwjud');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const current = join(root, 'current');
  const target = join(root, LNWJUD_VERSION);

  if (!forceRepair) {
    try {
      const link = (await readlink(current)).trim();
      const active = isAbsolute(link) ? link : join(root, link);
      if (active.includes(LNWJUD_VERSION)) {
        const verified = await verifyMacEngineBundleStable(active, arch);
        if (verified.ok) {
          await installMacBridge(home);
          return false;
        }
        console.warn(`AWH_DEVICE_RUNTIME_ACTIVE_VERIFY_RETRY_EXHAUSTED ${verified.failure ?? 'UNKNOWN'}`);
      }
    } catch (error) {
      console.warn(`AWH_DEVICE_RUNTIME_ACTIVE_RESOLVE_FAILED ${error instanceof Error ? error.message : String(error)}`);
    }
    const targetVerified = await verifyMacEngineBundleStable(target, arch);
    if (targetVerified.ok) {
      const nextLink = current + '.next';
      await rm(nextLink, { force: true }).catch(() => undefined);
      await symlink(target, nextLink, 'dir');
      await rename(nextLink, current);
      await installMacBridge(home);
      return false;
    }
    console.warn(`AWH_DEVICE_RUNTIME_TARGET_VERIFY_RETRY_EXHAUSTED ${targetVerified.failure ?? 'UNKNOWN'}`);
  }

  const work = await mkdtemp(join(tmpdir(), 'awh-lnwjud-'));
  const staged = join(root, '.' + LNWJUD_VERSION + '.staged-' + process.pid);
  const rollback = join(root, LNWJUD_VERSION + '.rollback');
  const currentNext = current + '.next';
  let oldCurrent: string | null = null;
  let movedOld = false;
  try {
    const archive = join(work, asset.name);
    await download(RELEASE_BASE + '/' + asset.name, archive);
    if ((await sha256File(archive)) !== asset.sha256) throw new Error('DEVICE_RUNTIME_INTEGRITY_FAILED');
    const extracted = join(work, 'extracted');
    await mkdir(extracted, { recursive: true, mode: 0o700 });
    const unzip = await execFile('/usr/bin/ditto', ['-x', '-k', archive, extracted], work, 180_000);
    if (unzip.code !== 0) throw new Error('DEVICE_RUNTIME_EXTRACT_FAILED');
    const app = await findApp(extracted);
    if (!app) throw new Error('DEVICE_RUNTIME_PACKAGE_INVALID');

    await rebrandMacEngine(app);
    const stagedVerification = await verifyMacEngineBundleStable(app, arch);
    if (!stagedVerification.ok) throw new Error('DEVICE_RUNTIME_STAGED_VERIFY_FAILED_' + (stagedVerification.failure ?? 'UNKNOWN'));
    await rm(staged, { recursive: true, force: true });
    const copy = await execFile('/usr/bin/ditto', [app, staged], work, 180_000);
    if (copy.code !== 0) throw new Error('DEVICE_RUNTIME_STAGED_COPY_FAILED_' + String(copy.code));
    const copiedVerification = await verifyMacEngineBundleStable(staged, arch);
    if (!copiedVerification.ok) throw new Error('DEVICE_RUNTIME_STAGED_COPY_VERIFY_FAILED_' + (copiedVerification.failure ?? 'UNKNOWN'));

    try { oldCurrent = (await readlink(current)).trim(); } catch { oldCurrent = null; }
    await rm(rollback, { recursive: true, force: true }).catch(() => undefined);
    try {
      const info = await lstat(target);
      if (info.isDirectory() || info.isFile() || info.isSymbolicLink()) {
        await rename(target, rollback);
        movedOld = true;
      }
    } catch {}

    try {
      await rename(staged, target);
      await rm(currentNext, { force: true }).catch(() => undefined);
      await symlink(target, currentNext, 'dir');
      try {
        const currentInfo = await lstat(current);
        if (!currentInfo.isSymbolicLink()) await rm(current, { recursive: true, force: true });
      } catch {}
      await rename(currentNext, current);
      await installMacBridge(home);
      const postSwapVerification = await verifyMacEngineBundleStable(target, arch);
      if (!postSwapVerification.ok) throw new Error('DEVICE_RUNTIME_POST_SWAP_VERIFY_FAILED_' + (postSwapVerification.failure ?? 'UNKNOWN'));

      const previous = join(root, 'previous');
      const previousNext = previous + '.next';
      await rm(previousNext, { force: true }).catch(() => undefined);
      if (movedOld) {
        await symlink(rollback, previousNext, 'dir');
        try {
          const previousInfo = await lstat(previous);
          if (!previousInfo.isSymbolicLink()) await rm(previous, { recursive: true, force: true });
        } catch {}
        await rename(previousNext, previous);
      }
      return true;
    } catch (error) {
      await rm(target, { recursive: true, force: true }).catch(() => undefined);
      if (movedOld) await rename(rollback, target).catch(() => undefined);
      if (oldCurrent) {
        await rm(currentNext, { force: true }).catch(() => undefined);
        await symlink(oldCurrent, currentNext, 'dir').catch(() => undefined);
        await rename(currentNext, current).catch(() => undefined);
      }
      throw error;
    }
  } finally {
    await rm(staged, { recursive: true, force: true }).catch(() => undefined);
    await rm(currentNext, { force: true }).catch(() => undefined);
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function installWindowsEngine(env: NodeJS.ProcessEnv, forceRepair = false): Promise<boolean> {
  const local = env.LOCALAPPDATA;
  if (!local) throw new Error('DEVICE_RUNTIME_LOCALAPPDATA_MISSING');
  const root = pathWin32.join(local, 'AWH', 'Engines', 'device-runtime', LNWJUD_VERSION);
  const installed = pathWin32.join(root, WINDOWS_RUNTIME_EXECUTABLE);
  if (!forceRepair) {
    try { if ((await lstat(installed)).isFile()) return false; } catch {}
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  const staged = installed + '.download';
  const rollback = installed + '.rollback';
  await rm(staged, { force: true });
  let movedOld = false;
  try {
    await download(RELEASE_BASE + '/' + WINDOWS_ASSET.name, staged);
    if ((await sha256File(staged)) !== WINDOWS_ASSET.sha256) throw new Error('DEVICE_RUNTIME_INTEGRITY_FAILED');
    await rm(rollback, { force: true }).catch(() => undefined);
    try {
      if ((await lstat(installed)).isFile()) {
        await rename(installed, rollback);
        movedOld = true;
      }
    } catch {}
    try {
      await rename(staged, installed);
      if (!(await lstat(installed)).isFile()) throw new Error('DEVICE_RUNTIME_POST_SWAP_VERIFY_FAILED');
      return true;
    } catch (error) {
      await rm(installed, { force: true }).catch(() => undefined);
      if (movedOld) await rename(rollback, installed).catch(() => undefined);
      throw error;
    }
  } finally {
    await rm(staged, { force: true }).catch(() => undefined);
  }
}

async function readinessFile(dataDir: string, result: DeviceBootstrapResult): Promise<void> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await writeFile(join(dataDir, 'device-runtime-readiness.json'), JSON.stringify({ schemaVersion: 1, ...result, verifiedAt: new Date().toISOString(), source: 'pinned-audited-device-runtime' }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

async function recoverVerifiedInstalledMacRuntime(dataDir: string, home: string, arch: 'arm64' | 'x64', env: NodeJS.ProcessEnv): Promise<boolean> {
  const root = join(home, 'Library', 'Application Support', 'AWH', 'Engines', 'lnwjud');
  const current = join(root, 'current');
  try {
    const link = (await readlink(current)).trim();
    const active = isAbsolute(link) ? link : join(root, link);
    const verified = await verifyMacEngineBundleStable(active, arch);
    if (!verified.ok) return false;
    await installMacBridge(home);
    const smokeRoot = join(dataDir, 'device-runtime-smoke-recovery');
    const client = await LnwjudDeviceClient.openWithSpec({
      command: join(active, 'Contents', 'MacOS', MAC_RUNTIME_EXECUTABLE),
      argsPrefix: ['--mcp-stdio'],
    }, smokeRoot);
    try { await client.callTool('health', { operation: 'check_all' }, 20_000); }
    finally { await client.closeAndWait(); }
    return true;
  } catch {
    return false;
  }
}

export async function ensureAwhDeviceRuntime(dataDir: string, platform: NodeJS.Platform = process.platform, arch: string = process.arch, home = homedir(), env: NodeJS.ProcessEnv = process.env, forceRepair = false): Promise<DeviceBootstrapResult> {
  if (!['darwin', 'win32'].includes(platform)) {
    const result: DeviceBootstrapResult = { state: 'UNSUPPORTED', version: null, installed: false, verified: false, reason: 'PLATFORM_NOT_SUPPORTED' };
    await readinessFile(dataDir, result); return result;
  }
  try {
    if (platform === 'darwin') {
      if (arch !== 'arm64' && arch !== 'x64') throw new Error('DEVICE_RUNTIME_ARCH_UNSUPPORTED');
      await installMacEngine(home, arch, forceRepair);
    } else await installWindowsEngine(env, forceRepair);
    // AWH Device Runtime owns the full device tool surface. Remote Desktop Commander
    // remains an independent fallback and must not be duplicated under AWH/SystemRuntime.
    // Tool Packs are provisioned lazily on first routed use; Agent bootstrap never installs them eagerly.
    const installed = true;
    const spec = await discoverLnwjudLaunchSpec(platform, home, env);
    if (!spec) throw new Error('DEVICE_RUNTIME_LAUNCHER_MISSING');
    const smokeRoot = join(dataDir, 'device-runtime-smoke');
    const client = await LnwjudDeviceClient.open(smokeRoot);
    try { await client.callTool('health', { operation: 'check_all' }, 20_000); }
    finally { await client.closeAndWait(); }
    const result: DeviceBootstrapResult = { state: 'READY', version: LNWJUD_VERSION, installed, verified: true, reason: null };
    await readinessFile(dataDir, result); return result;
  } catch (error) {
    if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) {
      const recovered = await recoverVerifiedInstalledMacRuntime(dataDir, home, arch, env);
      if (recovered) {
        console.warn('AWH_DEVICE_RUNTIME_BOOTSTRAP_RECOVERED_INSTALLED_RUNTIME');
        const result: DeviceBootstrapResult = { state: 'READY', version: LNWJUD_VERSION, installed: true, verified: true, reason: null };
        await readinessFile(dataDir, result).catch(() => undefined);
        return result;
      }
    }
    const reason = error instanceof Error ? error.message.replace(/[^A-Z0-9_.-]/gi, '_').slice(0, 120) : 'DEVICE_RUNTIME_BOOTSTRAP_FAILED';
    const result: DeviceBootstrapResult = { state: 'FAILED', version: null, installed: false, verified: false, reason };
    await readinessFile(dataDir, result).catch(() => undefined); return result;
  }
}

export async function repairAwhDeviceRuntime(dataDir: string, platform: NodeJS.Platform = process.platform, arch: string = process.arch, home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<DeviceBootstrapResult> {
  return ensureAwhDeviceRuntime(dataDir, platform, arch, home, env, true);
}
