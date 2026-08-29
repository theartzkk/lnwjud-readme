import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
  type OpenDialogOptions,
} from 'electron';
import { AuditLog } from '../audit.js';
import { listCheckpoints } from '../changes.js';
import { codexStatus } from '../codex.js';
import { explicitWorkspaceEnv, loadConfig } from '../config.js';
import { gitStatus } from '../git.js';
import { canonicalWorkspace } from '../security.js';
import { loadStoredSettings, saveStoredSettings } from '../settings.js';
import { loadOrCreateDeviceIdentity, readDeviceIdentity, updateDeviceDisplayName } from '../device-identity.js';
import { createDesktopCredentialStore, CredentialStoreError } from '../credential-store.js';
import { EnrollmentClient, EnrollmentClientError, readLocalEnrollmentState } from '../enrollment-client.js';
import { ensureAwhDataDirectoryActive } from '../data-migration.js';
import { AutopilotRunner, detectLocalCapabilities, loadAutopilotTasks, selectAutopilotProfile } from '../autopilot.js';
import { ControlPlaneWorkerClient } from '../control-plane-worker-client.js';
import { ControlPlaneWorkerRuntime } from '../control-plane-worker-runtime.js';
import { createWorkspaceWipCheckpoint, reconstructWorkspaceWip } from '../workspace-continuity.js';
import { listArtifacts } from '../artifacts.js';
import { discoverContinuity } from '../continuity.js';
import { readOwnerSession, trustOwner } from '../first-run.js';
import { detectProject } from '../project.js';
import {
  buildProjectContext,
  initializeProject,
  initializeProjectMemory,
  listProjects,
  openRegisteredProject,
  projectMemoryStatus,
  ProjectRegistryError,
  readProjectManifest,
  registerProject,
  resolveRegisteredProject,
  PROJECT_MEMORY_FILES,
} from '../project-registry.js';
import {
  connectTunnelRuntime,
  inspectTunnelReadiness,
  stopTunnelRuntime,
  type TunnelReadiness,
  type TunnelRuntimeStatus,
} from '../tunnel.js';
import { DESKTOP_IPC, DESKTOP_WEB_PREFERENCES } from './security.js';
import { RELEASE_VERSION } from '../version.js';
import { PRODUCT } from '../product.js';

const VERSION = RELEASE_VERSION;
const SMOKE_TEST = process.argv.includes('--smoke-test') || process.env.ART_AGENT_SMOKE_TEST === '1';
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let remoteOperationInFlight = false;
let lastRemoteRuntime: ReturnType<typeof sanitizedTunnelRuntime> | null = null;
let autopilotRuntime: { key: string; runner: AutopilotRunner } | null = null;
let workerRuntime: { key: string; runtime: ControlPlaneWorkerRuntime } | null = null;
let workerTimer: NodeJS.Timeout | null = null;
let workerRunning = false;
const MAX_HANDOFF_PREVIEW_CHARS = 4_000;

const require = createRequire(import.meta.url);
const SQUIRREL_STARTUP = process.platform === 'win32' && Boolean(require('electron-squirrel-startup'));

if (SMOKE_TEST) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  if (process.platform === 'linux') app.commandLine.appendSwitch('ozone-platform', 'x11');
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

function applySmokeArguments(): void {
  if (!SMOKE_TEST) return;
  const dataDir = argValue('--smoke-data-dir');
  const workspace = argValue('--smoke-workspace');
  if (dataDir && isAbsolute(dataDir) && !/[\u0000-\u001f\u007f]/.test(dataDir)) process.env.AWH_DATA_DIR = dataDir;
  if (workspace && isAbsolute(workspace) && !/[\u0000-\u001f\u007f]/.test(workspace)) process.env.AWH_WORKSPACE = workspace;
}

applySmokeArguments();

function hasExplicitWorkspace(dataDir: string): boolean {
  return Boolean(
    argValue('--workspace') ||
    explicitWorkspaceEnv()?.trim() ||
    loadStoredSettings(dataDir).defaultWorkspace?.trim(),
  );
}

function sanitizedTunnelReadiness(status: TunnelReadiness) {
  return {
    ready: status.ready,
    binaryConfigured: status.binaryConfigured,
    binaryReady: status.binaryReady,
    binaryVersion: status.binaryVersion ?? null,
    pathDiagnosticCandidate: status.pathDiagnosticCandidate ?? null,
    runtimeKeyPresent: status.runtimeKeyPresent,
    runtimeKeyValid: status.runtimeKeyValid,
    tunnelIdPresent: status.tunnelIdPresent,
    tunnelIdValid: status.tunnelIdValid,
    packagedMcpReady: status.packagedMcpReady,
    blockers: status.blockers,
  };
}

function sanitizedTunnelRuntime(status: TunnelRuntimeStatus) {
  return {
    state: status.state,
    connected: status.connected,
    processRunning: status.processRunning,
    healthy: status.healthy,
    ready: status.ready,
    runtimeState: status.runtimeState,
    verifiedAt: new Date().toISOString(),
  };
}

async function canonicalRemoteWorkspace(): Promise<{ config: ReturnType<typeof loadConfig>; workspace: string }> {
  const config = loadConfig();
  if (!hasExplicitWorkspace(config.dataDir)) throw new Error('Workspace is not configured');
  return { config, workspace: await canonicalWorkspace(config.workspace) };
}

async function confirmRemoteAction(action: 'connect' | 'stop'): Promise<boolean> {
  const connect = action === 'connect';
  const options = {
    type: 'warning' as const,
    title: connect ? 'ยืนยัน Remote Connection' : 'ยืนยันหยุด Remote Connection',
    message: connect
      ? `เชื่อมต่อ ${PRODUCT.desktopName} กับ ChatGPT ผ่าน Secure MCP Tunnel ตอนนี้หรือไม่?`
      : `หยุด Secure MCP Tunnel ที่ ${PRODUCT.desktopName} จัดการอยู่ตอนนี้หรือไม่?`,
    detail: connect
      ? 'การเชื่อมต่อเป็น outbound-only และ remote profile เป็น read-only 8 tools ไม่มี write / execute / Codex'
      : `${PRODUCT.desktopName} จะสั่งหยุดเฉพาะ managed runtime alias ของ workspace ปัจจุบัน และตรวจสถานะซ้ำก่อนรายงานผล`,
    buttons: ['ยกเลิก', connect ? 'เชื่อมต่อ' : 'หยุดการเชื่อมต่อ'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  return result.response === 1;
}

async function chooseDirectory(title: string): Promise<string | null> {
  const options: OpenDialogOptions = { title, properties: ['openDirectory'] };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
}

function projectError(error: unknown): { code: string; message: string } {
  if (error instanceof ProjectRegistryError) return { code: error.code, message: error.message };
  return { code: 'PROJECT_OPERATION_FAILED', message: error instanceof Error ? error.message : String(error) };
}

function enrollmentError(error: unknown): { ok: false; error: string; message: string } {
  if (error instanceof CredentialStoreError) return { ok: false, error: error.code, message: 'AWH session storage is unavailable' };
  if (error instanceof EnrollmentClientError) return { ok: false, error: error.code, message: error.code === 'HUB_NOT_CONFIGURED' ? 'AWH Hub ยังไม่พร้อม' : error.code === 'AUTH_FAILED' ? 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' : error.message };
  return { ok: false, error: 'ENROLLMENT_FAILED', message: 'Device enrollment is unavailable' };
}

function enrollmentClient(config: ReturnType<typeof loadConfig>): EnrollmentClient {
  if (!config.hubApiBase) throw new EnrollmentClientError('Hub enrollment API is not configured', 'HUB_NOT_CONFIGURED');
  return new EnrollmentClient(config.hubApiBase, config.dataDir, createDesktopCredentialStore(config.dataDir));
}

function controlPlaneWorker(config: ReturnType<typeof loadConfig>): ControlPlaneWorkerRuntime {
  const key = `${config.dataDir}:${config.hubApiBase}:${config.allowExec}:${config.allowWrite}:${config.allowCodex}`;
  if (!workerRuntime || workerRuntime.key !== key) workerRuntime = { key, runtime: new ControlPlaneWorkerRuntime(new ControlPlaneWorkerClient(config.hubApiBase, config.dataDir, createDesktopCredentialStore(config.dataDir)), { dataDir: config.dataDir, maxReadBytes: config.maxReadBytes, allowExec: config.allowExec, allowWrite: config.allowWrite, allowCodex: config.allowCodex }) };
  return workerRuntime.runtime;
}

async function workerState() {
  const config = loadConfig();
  const identity = await readDeviceIdentity(config.dataDir).catch(() => null);
  return { enabled: config.controlPlaneWorker, hubConfigured: Boolean(config.hubApiBase), hubAuthority: config.hubApiBase, device: identity ? { idShort: identity.deviceId.slice(0, 8), platform: identity.platform, arch: identity.arch, displayName: identity.displayName } : null, running: workerRunning };
}

async function runWorkerOnce() {
  const config = loadConfig();
  if (!config.controlPlaneWorker) return { ok: false, error: 'WORKER_DISABLED', message: 'Worker is disabled in this device policy' };
  if (workerRunning) return { ok: false, error: 'WORKER_BUSY', message: 'Worker is already running' };
  workerRunning = true;
  try { return { ok: true, ...(await controlPlaneWorker(config).runOnce()) }; }
  catch { return { ok: false, error: 'WORKER_RUN_FAILED', message: 'Worker could not complete a safe run' }; }
  finally { workerRunning = false; }
}

async function currentHubWorkClient(): Promise<{ projectId: string; client: ControlPlaneWorkerClient }> {
  const config = loadConfig();
  if (!config.hubApiBase) throw new Error('Hub is not configured');
  const client = new ControlPlaneWorkerClient(config.hubApiBase, config.dataDir, createDesktopCredentialStore(config.dataDir));
  const projects = await client.projects();
  if (projects.length === 0) throw new ProjectRegistryError('AWH Hub has no project for this account', 'PROJECT_NOT_FOUND');
  const stored = loadStoredSettings(config.dataDir);
  const selected = projects.find((project) => project.projectId === stored.selectedHubProjectId) ?? projects[0]!;
  if (stored.selectedHubProjectId !== selected.projectId) await saveStoredSettings(config.dataDir, { ...stored, selectedHubProjectId: selected.projectId });
  return { projectId: selected.projectId, client };
}

async function currentLocalWorkClient(): Promise<{ projectId: string; workspace: string; client: ControlPlaneWorkerClient }> {
  const config = loadConfig();
  if (!config.hubApiBase) throw new Error('Hub is not configured');
  if (!hasExplicitWorkspace(config.dataDir)) throw new Error('Project workspace is not configured');
  const workspace = await canonicalWorkspace(config.workspace);
  const manifest = await readProjectManifest(workspace);
  const registered = await resolveRegisteredProject(config.dataDir, manifest.projectId);
  if (registered.workspacePath !== workspace) throw new ProjectRegistryError('Selected workspace does not match the canonical project registration', 'PROJECT_ID_CONFLICT');
  return { projectId: manifest.projectId, workspace, client: new ControlPlaneWorkerClient(config.hubApiBase, config.dataDir, createDesktopCredentialStore(config.dataDir)) };
}

/** Publish a portable manifest to the Hub; local filesystem paths never cross this boundary. */
async function syncPortableProjectToHub(config: ReturnType<typeof loadConfig>, workspace: string): Promise<boolean> {
  if (!config.hubApiBase) return false;
  const manifest = await readProjectManifest(workspace);
  await new ControlPlaneWorkerClient(config.hubApiBase, config.dataDir, createDesktopCredentialStore(config.dataDir)).registerProject({ projectId: manifest.projectId, name: manifest.name, type: manifest.type, sourceRevision: null });
  return true;
}

async function workConversation() {
  try { const current = await currentHubWorkClient(); return { ok: true, projectId: current.projectId, ...(await current.client.readConversation(current.projectId)) }; }
  catch { return { ok: false, error: 'WORK_UNAVAILABLE', message: 'Work ยังไม่พร้อมบน Hub นี้' }; }
}

async function submitWorkMessage(message: unknown, idempotencyKey: unknown) {
  if (typeof message !== 'string' || !message.trim() || message.length > 2_000) return { ok: false, error: 'MESSAGE_INVALID', message: 'กรุณาบอกสิ่งที่อยากให้ AWH ช่วย' };
  const key = typeof idempotencyKey === 'string' && /^[A-Za-z0-9._-]{8,120}$/.test(idempotencyKey) ? idempotencyKey : `desktop-${randomUUID()}`;
  try { const current = await currentHubWorkClient(); return { ok: true, projectId: current.projectId, ...(await current.client.submitConversation(current.projectId, message.trim(), key)) }; }
  catch { return { ok: false, error: 'WORK_UNAVAILABLE', message: 'AWH ยังบันทึก Work นี้ไม่ได้ กรุณาตรวจการเชื่อมต่อ Hub' }; }
}

async function workspaceContinuity() {
  try {
    const current = await currentLocalWorkClient();
    return { ok: true, projectId: current.projectId, workspace: await current.client.workspace(current.projectId) };
  } catch { return { ok: false, error: 'WORKSPACE_CONTINUITY_UNAVAILABLE', message: 'สถานะการทำงานข้ามอุปกรณ์ยังไม่พร้อม' }; }
}

async function syncWorkspaceForHandoff() {
  const config = loadConfig();
  if (!config.allowExec) return { ok: false, error: 'EXECUTION_NOT_APPROVED', message: 'ต้องเปิด Approved execution บนอุปกรณ์นี้ก่อนจึงจะ sync งานข้ามอุปกรณ์ได้' };
  try {
    const current = await currentLocalWorkClient();
    const identity = await loadOrCreateDeviceIdentity(config.dataDir);
    const checkpoint = await createWorkspaceWipCheckpoint({ workspace: current.workspace, projectId: current.projectId, sourceDeviceId: identity.deviceId });
    await current.client.publishWorkspaceCheckpoint(checkpoint);
    await current.client.releaseWorkspaceLease(current.projectId);
    return { ok: true, projectId: current.projectId, syncStatus: checkpoint.syncState, message: checkpoint.syncState === 'SYNCED' ? 'บันทึกงานระหว่างทำและพร้อมรับต่อบนอุปกรณ์ที่เชื่อถือได้แล้ว' : checkpoint.syncState === 'CLEAN' ? 'workspace นี้สะอาดและ revision พร้อมรับต่อบนอุปกรณ์อื่นแล้ว' : 'ยังมี source revision ที่ sync ไม่ครบ จึงไม่พร้อมส่งต่อ' };
  } catch { return { ok: false, error: 'WORKSPACE_SYNC_FAILED', message: 'AWH ยังไม่สามารถบันทึก workspace นี้เพื่อส่งต่อได้อย่างปลอดภัย' }; }
}

async function takeOverWorkspace() {
  const config = loadConfig();
  if (!config.allowExec) return { ok: false, error: 'EXECUTION_NOT_APPROVED', message: 'ต้องเปิด Approved execution บนอุปกรณ์นี้ก่อนจึงจะรับงานจากอุปกรณ์อื่นได้' };
  try {
    const current = await currentLocalWorkClient();
    const state = await current.client.workspace(current.projectId);
    if (state.syncStatus === 'UNSYNCED_CHANGES' || state.checkpoint?.syncState === 'UNSYNCED') return { ok: false, error: 'UNSYNCED_SOURCE', message: 'อุปกรณ์เดิมมีงานที่ยัง sync ไม่ครบ จึงยังรับต่ออย่างปลอดภัยไม่ได้' };
    const checkpointId = state.checkpoint?.checkpointId ?? null;
    const identity = await loadOrCreateDeviceIdentity(config.dataDir);
    await current.client.claimWorkspaceLease(current.projectId, checkpointId);
    try {
      if (state.checkpoint !== null && state.checkpoint.sourceDeviceId !== identity.deviceId) await reconstructWorkspaceWip({ workspace: current.workspace, checkpoint: state.checkpoint });
    } catch {
      try { await current.client.releaseWorkspaceLease(current.projectId); } catch { /* The Hub retains the lease only if the safe release itself is unavailable. */ }
      return { ok: false, error: 'WORKSPACE_RESTORE_FAILED', message: 'working copy เครื่องนี้ไม่ตรงกับ checkpoint จึงไม่เขียนทับงานเดิม' };
    }
    return { ok: true, projectId: current.projectId, message: 'รับ workspace ล่าสุดแล้ว ตรวจสอบ revision และไฟล์ที่ส่งต่อเรียบร้อย' };
  } catch { return { ok: false, error: 'WORKSPACE_TAKEOVER_FAILED', message: 'AWH ยังรับ workspace นี้ต่อไม่ได้ เพราะ lease หรือ checkpoint ยังไม่พร้อม' }; }
}

function startWorkerLoop(): void {
  const config = loadConfig();
  if (!config.controlPlaneWorker || workerTimer) return;
  void runWorkerOnce();
  workerTimer = setInterval(() => { void runWorkerOnce(); }, 30_000);
  workerTimer.unref?.();
}

async function enrollmentState() {
  const config = loadConfig();
  try {
    const store = createDesktopCredentialStore(config.dataDir);
    const state = await readLocalEnrollmentState(config.dataDir, store);
    return { ok: true, hubConfigured: Boolean(config.hubApiBase), ...state };
  } catch (error) {
    return { ...enrollmentError(error), hubConfigured: Boolean(config.hubApiBase), enrolled: false, deviceId: null, displayName: null, platform: process.platform, credentialStored: false, expiresAt: null, projectCount: null };
  }
}

async function loginDevice(username: unknown, password: unknown) {
  if (typeof username !== 'string' || typeof password !== 'string') return { ok: false, error: 'AUTH_FAILED', message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' };
  try {
    const config = loadConfig();
    const state = await enrollmentClient(config).login(username, password);
    if (config.controlPlaneWorker) void runWorkerOnce().catch(() => undefined);
    return { ok: true, hubConfigured: true, ...state };
  } catch (error) { return enrollmentError(error); }
}

async function pairDevice(pairingCode: unknown) {
  if (typeof pairingCode !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(pairingCode)) return { ok: false, error: 'PAIRING_CODE_INVALID', message: 'Pairing code is invalid' };
  try { return { ok: true, hubConfigured: true, ...(await enrollmentClient(loadConfig()).pair(pairingCode)) }; }
  catch (error) { return enrollmentError(error); }
}

async function rotateDevice() {
  try { return { ok: true, hubConfigured: true, ...(await enrollmentClient(loadConfig()).rotate()) }; }
  catch (error) { return enrollmentError(error); }
}

async function revokeDevice() {
  try { return { ok: true, hubConfigured: true, ...(await enrollmentClient(loadConfig()).revoke()) }; }
  catch (error) { return enrollmentError(error); }
}

async function openOwnerPasswordReset() {
  try {
    const config = loadConfig();
    const state = await readLocalEnrollmentState(config.dataDir, createDesktopCredentialStore(config.dataDir));
    if (!state.enrolled) {
      const url = new URL('/#awh-recovery', config.hubApiBase);
      await shell.openExternal(url.toString());
      return { ok: true, message: 'เปิดหน้ากู้คืนบัญชี AWH แล้ว หาก browser มี session อยู่จะเปิดแผนกู้คืนให้ทันที' };
    }
    const link = await new ControlPlaneWorkerClient(config.hubApiBase, config.dataDir, createDesktopCredentialStore(config.dataDir)).issueOwnerPasswordResetLink();
    const url = new URL(link.resetPath, config.hubApiBase);
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== new URL(config.hubApiBase).origin || url.search) throw new Error('Reset link origin is invalid');
    await shell.openExternal(url.toString());
    return { ok: true, expiresAt: link.expiresAt, message: 'เปิดหน้าตั้งรหัสผ่านใหม่ใน browser แล้ว ลิงก์นี้ใช้ได้ครั้งเดียว' };
  } catch (error) {
    return { ok: false, error: 'OWNER_PASSWORD_RESET_UNAVAILABLE', message: error instanceof Error ? error.message : 'ยังเปิดหน้าตั้งรหัสผ่านใหม่ไม่ได้' };
  }
}

async function selectedEnrollmentProjectIds(config: ReturnType<typeof loadConfig>): Promise<string[]> {
  // An enrolled owner may trust a control surface before any project exists.
  // An explicit workspace still remains the only source of project-scoped access.
  if (!hasExplicitWorkspace(config.dataDir)) return [];
  const workspace = await canonicalWorkspace(config.workspace);
  const manifest = await readProjectManifest(workspace);
  const resolved = await resolveRegisteredProject(config.dataDir, manifest.projectId);
  if (resolved.workspacePath !== workspace) throw new ProjectRegistryError('Selected project workspace does not match the registry', 'PROJECT_ID_CONFLICT');
  return [resolved.manifest.projectId];
}

async function issueDevicePairingCode() {
  try {
    const config = loadConfig();
    const state = await readLocalEnrollmentState(config.dataDir, createDesktopCredentialStore(config.dataDir));
    if (!state.enrolled) throw new EnrollmentClientError('Device is not enrolled', 'DEVICE_NOT_ENROLLED');
    const projectIds = await selectedEnrollmentProjectIds(config);
    const result = await enrollmentClient(config).issuePairingCode(projectIds, 600);
    // The IPC shape uses a neutral field name so the renderer never receives
    // token/credential-shaped fields. The code remains memory-only UI data.
    return { ok: true, hubConfigured: true, code: result.pairingCode, expiresAt: result.expiresAt, projectCount: result.projectCount };
  } catch (error) { return enrollmentError(error); }
}

async function firstRunState() {
  const config = loadConfig();
  const session = await readOwnerSession(config.dataDir).catch(() => null);
  const identity = await readDeviceIdentity(config.dataDir).catch(() => null);
  return {
    ready: Boolean(session),
    trusted: Boolean(session),
    ownerDisplayName: session?.ownerDisplayName ?? null,
    deviceName: identity?.displayName ?? session?.deviceName ?? null,
    deviceId: identity?.deviceId ?? null,
    platform: identity?.platform ?? process.platform,
    nativeCredentialBoundary: 'private_file_session',
  };
}

async function trustLocalOwner(ownerDisplayName: unknown, deviceName: unknown) {
  if (typeof ownerDisplayName !== 'string' || typeof deviceName !== 'string') return { ok: false, error: 'OWNER_INPUT_INVALID', message: 'Owner and device names are required' };
  const config = loadConfig();
  try {
    const identity = await loadOrCreateDeviceIdentity(config.dataDir, deviceName);
    const updated = identity.displayName === deviceName.trim() ? identity : await updateDeviceDisplayName(config.dataDir, deviceName);
    const session = await trustOwner(config.dataDir, ownerDisplayName, updated.displayName);
    return { ok: true, trusted: true, ownerDisplayName: session.ownerDisplayName, deviceName: updated.displayName, deviceId: updated.deviceId };
  } catch {
    return { ok: false, error: 'OWNER_TRUST_FAILED', message: 'Owner setup could not be saved safely' };
  }
}

async function currentAutopilot() {
  const config = loadConfig();
  if (!hasExplicitWorkspace(config.dataDir)) throw new ProjectRegistryError('Workspace is not configured', 'PROJECT_WORKSPACE_UNAVAILABLE');
  const workspace = await canonicalWorkspace(config.workspace);
  const manifest = await readProjectManifest(workspace);
  const identity = await loadOrCreateDeviceIdentity(config.dataDir);
  const key = `${config.dataDir}:${workspace}:${manifest.projectId}:${config.allowExec}`;
  if (!autopilotRuntime || autopilotRuntime.key !== key) autopilotRuntime = {
    key,
    runner: new AutopilotRunner({ dataDir: config.dataDir, workspace, manifest, deviceId: identity.deviceId, maxReadBytes: config.maxReadBytes, allowExec: config.allowExec, allowWrite: config.allowWrite }),
  };
  return { config, workspace, manifest, runner: autopilotRuntime.runner };
}

async function autopilotOverview() {
  const { config, workspace, manifest } = await currentAutopilot();
  const detected = await detectProject(workspace);
  const profile = selectAutopilotProfile(manifest, detected);
  return { project: manifest, profile, capabilities: await detectLocalCapabilities(workspace), approvedScripts: detected.approvedScripts, approvedScriptAliases: detected.approvedScriptAliases ?? {}, executionEnabled: config.allowExec, allowWrite: config.allowWrite, tasks: await loadAutopilotTasks(config.dataDir, 12), artifacts: await listArtifacts(config.dataDir, 12) };
}

async function projectsOverview() {
  const config = loadConfig();
  const stored = loadStoredSettings(config.dataDir);
  const configuredWorkspace = hasExplicitWorkspace(config.dataDir) ? await canonicalWorkspace(config.workspace).catch(() => null) : null;
  const records = await listProjects(config.dataDir);
  const localById = new Map<string, { workspacePath: string; name: string | null; type: string | null; git: { ok: boolean; text: string } | null; memory: Record<string, 'present' | 'missing'> | null }>();
  for (const record of records) {
    try {
      const root = await canonicalWorkspace(record.workspacePath); const manifest = await readProjectManifest(root); if (manifest.projectId !== record.projectId) continue;
      const git = await gitStatus(root); localById.set(record.projectId, { workspacePath: root, name: manifest.name, type: manifest.type, git: { ok: git.code === 0, text: git.code === 0 ? git.stdout : git.stderr }, memory: await projectMemoryStatus(root) });
    } catch { /* Local binding is optional; Hub remains authoritative. */ }
  }
  let hubProjects: Awaited<ReturnType<ControlPlaneWorkerClient['projects']>> = [];
  if (config.hubApiBase) {
    const client = new ControlPlaneWorkerClient(config.hubApiBase, config.dataDir, createDesktopCredentialStore(config.dataDir));
    hubProjects = await client.projects().catch(() => []);
  }
  const entries: Array<Record<string, unknown>> = hubProjects.map((project) => {
    const local = localById.get(project.projectId);
    return {
      projectId: project.projectId, workspacePath: local?.workspacePath ?? null, selected: project.projectId === (stored.selectedHubProjectId ?? hubProjects[0]?.projectId),
      name: project.name, type: project.type, localAvailable: Boolean(local), hubAvailable: true, vaultReady: project.vaultReady, state: 'AVAILABLE' as const, error: null,
      memory: local?.memory ?? null, git: local?.git ?? null,
    };
  });
  for (const [projectId, local] of localById) if (!entries.some((entry) => entry['projectId'] === projectId)) entries.push({ projectId, workspacePath: local.workspacePath, selected: false, name: local.name ?? projectId, type: local.type ?? 'general', localAvailable: true, hubAvailable: false, vaultReady: false, state: 'UNAVAILABLE' as const, error: 'โปรเจกต์นี้ยังไม่ได้เชื่อมกับ AWH Hub', memory: local.memory, git: local.git });
  return { projects: entries, currentWorkspace: configuredWorkspace, selectedHubProjectId: stored.selectedHubProjectId ?? hubProjects[0]?.projectId ?? null };
}

async function projectContext(projectId: unknown) {
  const config = loadConfig();
  if (typeof projectId !== 'string') throw new ProjectRegistryError('Project id is required', 'PROJECT_ID_INVALID');
  const resolved = await resolveRegisteredProject(config.dataDir, projectId);
  const context = await buildProjectContext(resolved.workspacePath);
  const memory = Object.fromEntries(PROJECT_MEMORY_FILES.map((file) => [file, context.memory[file] === null ? 'missing' : 'present']));
  const handoff = context.memory['HANDOFF.md'];
  return {
    project: context.project,
    workspacePath: context.workspace.path,
    memory,
    handoffPreview: handoff === null ? null : { text: handoff.slice(0, MAX_HANDOFF_PREVIEW_CHARS), truncated: handoff.length > MAX_HANDOFF_PREVIEW_CHARS },
  };
}

async function runtimeOverview() {
  const config = loadConfig();
  const audit = new AuditLog(config.dataDir);
  const checkpoints = await listCheckpoints(config.dataDir, 8);
  const auditEntries = await audit.tail(20);
  const workspaceConfigured = hasExplicitWorkspace(config.dataDir);
  let deviceIdentity: Awaited<ReturnType<typeof readDeviceIdentity>> = null;
  let deviceIdentityError: string | null = null;
  try {
    deviceIdentity = await readDeviceIdentity(config.dataDir);
  } catch (error) {
    deviceIdentityError = error instanceof Error ? error.message : String(error);
  }

  let workspace: string | null = null;
  let workspaceError: string | null = null;
  if (workspaceConfigured) {
    try {
      workspace = await canonicalWorkspace(config.workspace);
    } catch (error) {
      workspaceError = error instanceof Error ? error.message : String(error);
    }
  }

  const git = workspace
    ? await gitStatus(workspace).catch((error: unknown) => ({ code: -1, stdout: '', stderr: error instanceof Error ? error.message : String(error) }))
    : { code: -1, stdout: '', stderr: workspaceError ?? 'ยังไม่ได้เลือก workspace' };
  const codex = await codexStatus(workspace ?? process.cwd());
  const remoteTunnel = workspace
    ? await inspectTunnelReadiness(workspace, process.execPath)
        .then(sanitizedTunnelReadiness)
        .catch((error: unknown) => ({
          ready: false,
          binaryConfigured: Boolean(process.env.TUNNEL_CLIENT_BIN?.trim()),
          binaryReady: false,
          binaryVersion: null,
          pathDiagnosticCandidate: null,
          runtimeKeyPresent: Boolean(process.env.CONTROL_PLANE_API_KEY?.trim()),
          runtimeKeyValid: false,
          tunnelIdPresent: Boolean(process.env.CONTROL_PLANE_TUNNEL_ID?.trim()),
          tunnelIdValid: false,
          packagedMcpReady: false,
          blockers: [`Tunnel readiness check failed: ${error instanceof Error ? error.message : String(error)}`],
        }))
    : {
        ready: false,
        binaryConfigured: false,
        binaryReady: false,
        binaryVersion: null,
        pathDiagnosticCandidate: null,
        runtimeKeyPresent: false,
        runtimeKeyValid: false,
        tunnelIdPresent: false,
        tunnelIdValid: false,
        packagedMcpReady: false,
        blockers: ['Workspace is not ready'],
      };

  return {
    name: PRODUCT.productName,
    version: VERSION,
    hubAuthority: config.hubApiBase,
    workspace: workspace ?? (workspaceConfigured ? config.workspace : 'ยังไม่ได้เลือก workspace'),
    dataDir: config.dataDir,
    permissions: {
      write: config.allowWrite,
      execute: config.allowExec,
      codex: config.allowCodex,
      worker: config.controlPlaneWorker,
    },
    git: {
      ok: Boolean(workspace) && git.code === 0,
      text: git.code === 0 ? git.stdout : git.stderr,
    },
    codex,
    checkpoints,
    audit: auditEntries,
    doctor: {
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      electron: (process.versions as NodeJS.ProcessVersions & { electron?: string }).electron ?? null,
      workspaceReady: Boolean(workspace),
      workspaceConfigured,
      workspaceError,
      device: deviceIdentity
        ? { ready: true, displayName: deviceIdentity.displayName, idShort: deviceIdentity.deviceId.slice(0, 8), platform: deviceIdentity.platform, arch: deviceIdentity.arch, error: null }
        : { ready: false, displayName: null, idShort: null, platform: process.platform, arch: process.arch, error: deviceIdentityError },
      remoteTunnel,
      remoteRuntime: lastRemoteRuntime,
    },
  };
}

async function createWindow(showOnReady = true): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: `${PRODUCT.desktopName} — ${PRODUCT.productName}`,
    backgroundColor: '#111318',
    autoHideMenuBar: true,
    webPreferences: {
      ...DESKTOP_WEB_PREFERENCES,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: join(app.getAppPath(), 'desktop', 'preload.cjs'),
    },
  });

  if (showOnReady) win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  await win.loadFile(join(app.getAppPath(), 'desktop', 'index.html'));
  return win;
}

function createTray(): Tray {
  const image = nativeImage.createFromPath(join(app.getAppPath(), 'logo-256x256.png')).resize({ width: 20, height: 20 });
  const item = new Tray(image);
  item.setToolTip(`${PRODUCT.desktopName} — ${PRODUCT.productName}`);
  item.setContextMenu(Menu.buildFromTemplate([
    { label: `เปิด ${PRODUCT.desktopName}`, click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: 'ออก', click: () => { quitting = true; app.quit(); } },
  ]));
  item.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
  return item;
}

function registerIpc(): void {
  ipcMain.handle(DESKTOP_IPC.overview, async () => runtimeOverview());

  ipcMain.handle(DESKTOP_IPC.projects, async () => projectsOverview());

  ipcMain.handle(DESKTOP_IPC.projectContext, async (_event, projectId: unknown) => projectContext(projectId));

  ipcMain.handle(DESKTOP_IPC.registerProject, async () => {
    const selected = await chooseDirectory(`ลงทะเบียนโปรเจกต์ที่มีอยู่ใน ${PRODUCT.desktopName}`);
    if (!selected) return { changed: false, cancelled: true };
    const config = loadConfig();
    const record = await registerProject(config.dataDir, selected);
    const hubSynced = await syncPortableProjectToHub(config, record.workspacePath).catch(() => false);
    return { changed: true, projectId: record.projectId, workspace: record.workspacePath, hubSynced };
  });

  ipcMain.handle(DESKTOP_IPC.initializeProject, async () => {
    const selected = await chooseDirectory(`เริ่มต้นโปรเจกต์ AWH ในโฟลเดอร์ที่เลือก`);
    if (!selected) return { changed: false, cancelled: true };
    const config = loadConfig();
    const manifest = await initializeProject(selected);
    const record = await registerProject(config.dataDir, selected);
    const hubSynced = await syncPortableProjectToHub(config, record.workspacePath).catch(() => false);
    return { changed: true, project: manifest, projectId: record.projectId, workspace: record.workspacePath, hubSynced };
  });

  ipcMain.handle(DESKTOP_IPC.initializeProjectMemory, async (_event, projectId: unknown) => {
    if (typeof projectId !== 'string') throw new ProjectRegistryError('Project id is required', 'PROJECT_ID_INVALID');
    const config = loadConfig();
    const resolved = await resolveRegisteredProject(config.dataDir, projectId);
    const created = await initializeProjectMemory(resolved.workspacePath);
    return { changed: created.length > 0, created };
  });

  ipcMain.handle(DESKTOP_IPC.selectProject, async (_event, projectId: unknown) => {
    if (typeof projectId !== 'string' || !/^[0-9a-f-]{36}$/i.test(projectId)) throw new ProjectRegistryError('Project id is required', 'PROJECT_ID_INVALID');
    const config = loadConfig(); const client = new ControlPlaneWorkerClient(config.hubApiBase, config.dataDir, createDesktopCredentialStore(config.dataDir));
    const projects = await client.projects(); if (!projects.some((project) => project.projectId === projectId)) throw new ProjectRegistryError('Project is not available from AWH Hub', 'PROJECT_NOT_FOUND');
    const stored = loadStoredSettings(config.dataDir); let defaultWorkspace = stored.defaultWorkspace;
    try { const record = await resolveRegisteredProject(config.dataDir, projectId); defaultWorkspace = record.workspacePath; } catch { /* Hub project can be selected without a local folder. */ }
    await saveStoredSettings(config.dataDir, { ...stored, selectedHubProjectId: projectId.toLowerCase(), ...(defaultWorkspace ? { defaultWorkspace } : {}) });
    return { changed: true, restartRequired: false, projectId: projectId.toLowerCase(), hubReady: true, localBound: Boolean(defaultWorkspace) };
  });

  ipcMain.handle(DESKTOP_IPC.locateProject, async (_event, projectId: unknown) => {
    if (typeof projectId !== 'string') throw new ProjectRegistryError('Project id is required', 'PROJECT_ID_INVALID');
    const selected = await chooseDirectory('ค้นหาโฟลเดอร์ของโปรเจกต์ที่ย้ายแล้ว');
    if (!selected) return { changed: false, cancelled: true };
    const config = loadConfig();
    const manifest = await readProjectManifest(selected);
    if (manifest.projectId !== projectId) throw new ProjectRegistryError('โฟลเดอร์ที่เลือกมี projectId ไม่ตรงกัน', 'PROJECT_ID_MISMATCH');
    const record = await registerProject(config.dataDir, selected);
    const hubSynced = await syncPortableProjectToHub(config, record.workspacePath).catch(() => false);
    const stored = loadStoredSettings(config.dataDir);
    await saveStoredSettings(config.dataDir, { ...stored, defaultWorkspace: record.workspacePath, selectedHubProjectId: record.projectId });
    return { changed: true, restartRequired: false, projectId: record.projectId, workspace: record.workspacePath, hubSynced };
  });

  ipcMain.handle(DESKTOP_IPC.chooseWorkspace, async () => {
    const selected = await chooseDirectory(`เลือกโปรเจกต์ที่ลงทะเบียนแล้วสำหรับ ${PRODUCT.desktopName}`);
    if (!selected) return { changed: false, cancelled: true };
    const config = loadConfig();
    const record = await registerProject(config.dataDir, selected);
    const hubSynced = await syncPortableProjectToHub(config, record.workspacePath).catch(() => false);
    const stored = loadStoredSettings(config.dataDir);
    await saveStoredSettings(config.dataDir, { ...stored, defaultWorkspace: record.workspacePath, selectedHubProjectId: record.projectId });
    return { changed: true, projectId: record.projectId, workspace: record.workspacePath, restartRequired: false, hubSynced };
  });

  ipcMain.handle(DESKTOP_IPC.setPermissions, async (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid permission payload');
    const value = input as Record<string, unknown>;
    if (typeof value.write !== 'boolean' || typeof value.execute !== 'boolean' || typeof value.codex !== 'boolean' || typeof value.worker !== 'boolean') {
      throw new Error('Permission values must be booleans');
    }
    if (value.codex && !value.execute) throw new Error('Codex requires approved execution');
    if (value.worker && !value.execute) throw new Error('Worker requires approved execution');
    const config = loadConfig();
    const stored = loadStoredSettings(config.dataDir);
    await saveStoredSettings(config.dataDir, {
      ...stored,
      allowWrite: value.write,
      allowExec: value.execute,
      allowCodex: value.codex,
      controlPlaneWorker: value.worker,
    });
    return { changed: true, restartRequired: true };
  });

  ipcMain.handle(DESKTOP_IPC.enrollmentState, async () => enrollmentState());
  ipcMain.handle(DESKTOP_IPC.enrollmentLogin, async (_event, username: unknown, password: unknown) => loginDevice(username, password));
  ipcMain.handle(DESKTOP_IPC.enrollmentPair, async (_event, pairingCode: unknown) => pairDevice(pairingCode));
  ipcMain.handle(DESKTOP_IPC.enrollmentIssuePairing, async () => issueDevicePairingCode());
  ipcMain.handle(DESKTOP_IPC.enrollmentRotate, async () => rotateDevice());
  ipcMain.handle(DESKTOP_IPC.enrollmentRevoke, async () => revokeDevice());
  ipcMain.handle(DESKTOP_IPC.ownerPasswordReset, async () => openOwnerPasswordReset());
  ipcMain.handle(DESKTOP_IPC.firstRun, async () => firstRunState());
  ipcMain.handle(DESKTOP_IPC.trustOwner, async (_event, ownerDisplayName: unknown, deviceName: unknown) => trustLocalOwner(ownerDisplayName, deviceName));
  ipcMain.handle(DESKTOP_IPC.autopilotOverview, async () => autopilotOverview());
  ipcMain.handle(DESKTOP_IPC.autopilotStart, async (_event, goal: unknown) => {
    if (typeof goal !== 'string' || !goal.trim() || goal.length > 2_000) return { ok: false, error: 'GOAL_INVALID', message: 'Please enter a bounded goal' };
    try {
      const { runner } = await currentAutopilot();
      const task = await runner.start({ goal: goal.trim(), acceptanceCriteria: ['Approved local gates pass', 'A bounded artifact is available', 'A continuity checkpoint is created'] });
      return { ok: task.state !== 'FAILED', task };
    } catch {
      return { ok: false, error: 'AUTOPILOT_UNAVAILABLE', message: 'Autopilot is unavailable for this project' };
    }
  });
  ipcMain.handle(DESKTOP_IPC.autopilotTasks, async () => {
    const config = loadConfig();
    return { tasks: await loadAutopilotTasks(config.dataDir, 20) };
  });
  ipcMain.handle(DESKTOP_IPC.autopilotArtifacts, async () => {
    const config = loadConfig();
    return { artifacts: await listArtifacts(config.dataDir, 20) };
  });
  ipcMain.handle(DESKTOP_IPC.autopilotRemoteResults, async () => {
    try { const config = loadConfig(); return { ok: true, ...(await new ControlPlaneWorkerClient(config.hubApiBase, config.dataDir, createDesktopCredentialStore(config.dataDir)).readResults()) }; }
    catch { return { ok: false, results: [], artifacts: [], approvals: [] }; }
  });
  ipcMain.handle(DESKTOP_IPC.autopilotContinuity, async () => {
    const { config, manifest } = await currentAutopilot();
    const status = await gitStatus(config.workspace);
    const dirty = status.code !== 0 || status.stdout.split(/\r?\n/).some((line) => line.trim() && !line.startsWith('## '));
    return discoverContinuity(config.dataDir, manifest.projectId, dirty);
  });
  ipcMain.handle(DESKTOP_IPC.autopilotCheckpointMemory, async (_event, taskId: unknown) => {
    if (typeof taskId !== 'string' || !taskId.trim()) return { ok: false, error: 'TASK_ID_INVALID', message: 'Task id is invalid' };
    try { const { runner } = await currentAutopilot(); return { ok: true, ...(await runner.checkpointMemory(taskId)) }; }
    catch { return { ok: false, error: 'MEMORY_CHECKPOINT_REJECTED', message: 'Memory checkpoint requires explicit write permission and a completed task' }; }
  });
  ipcMain.handle(DESKTOP_IPC.workConversation, async () => workConversation());
  ipcMain.handle(DESKTOP_IPC.workSubmit, async (_event, message: unknown, idempotencyKey: unknown) => submitWorkMessage(message, idempotencyKey));
  ipcMain.handle(DESKTOP_IPC.workspaceContinuity, async () => workspaceContinuity());
  ipcMain.handle(DESKTOP_IPC.workspaceSync, async () => syncWorkspaceForHandoff());
  ipcMain.handle(DESKTOP_IPC.workspaceTakeover, async () => takeOverWorkspace());
  ipcMain.handle(DESKTOP_IPC.workerState, async () => workerState());
  ipcMain.handle(DESKTOP_IPC.workerRunOnce, async () => runWorkerOnce());

  ipcMain.handle(DESKTOP_IPC.remoteConnect, async () => {
    if (remoteOperationInFlight) return { ok: false, error: 'REMOTE_BUSY', message: 'Remote Connection กำลังทำรายการอื่นอยู่' };
    remoteOperationInFlight = true;
    try {
      const { config, workspace } = await canonicalRemoteWorkspace();
      const audit = new AuditLog(config.dataDir);
      const readiness = await inspectTunnelReadiness(workspace, process.execPath);
      if (!readiness.ready) {
        await audit.write({ tool: 'remote_connect', outcome: 'denied', detail: `not ready: ${readiness.blockers.join('; ')}` });
        return {
          ok: false,
          error: 'REMOTE_NOT_READY',
          message: 'Remote Connection ยังไม่พร้อม',
          blockers: readiness.blockers,
          readiness: sanitizedTunnelReadiness(readiness),
        };
      }
      if (!(await confirmRemoteAction('connect'))) return { ok: false, cancelled: true };

      try {
        const runtime = await connectTunnelRuntime(workspace, process.execPath);
        lastRemoteRuntime = sanitizedTunnelRuntime(runtime);
        await audit.write({
          tool: 'remote_connect',
          outcome: runtime.connected ? 'allowed' : 'error',
          detail: `state=${runtime.state}; running=${runtime.processRunning}; healthy=${runtime.healthy}; ready=${runtime.ready}`,
        });
        return {
          ok: true,
          connected: runtime.connected,
          message: runtime.connected ? 'Remote Connection connected and verified' : 'Tunnel runtime started but is not ready yet',
          runtime: lastRemoteRuntime,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await audit.write({ tool: 'remote_connect', outcome: 'error', detail: message });
        return { ok: false, error: 'REMOTE_CONNECT_FAILED', message };
      }
    } catch (error) {
      return { ok: false, error: 'REMOTE_CONNECT_FAILED', message: error instanceof Error ? error.message : String(error) };
    } finally {
      remoteOperationInFlight = false;
    }
  });

  ipcMain.handle(DESKTOP_IPC.remoteStop, async () => {
    if (remoteOperationInFlight) return { ok: false, error: 'REMOTE_BUSY', message: 'Remote Connection กำลังทำรายการอื่นอยู่' };
    remoteOperationInFlight = true;
    try {
      const { config, workspace } = await canonicalRemoteWorkspace();
      const audit = new AuditLog(config.dataDir);
      if (!(await confirmRemoteAction('stop'))) return { ok: false, cancelled: true };

      try {
        const runtime = await stopTunnelRuntime(workspace);
        lastRemoteRuntime = sanitizedTunnelRuntime(runtime);
        const stopped = runtime.processRunning === false && runtime.state === 'stopped';
        await audit.write({
          tool: 'remote_stop',
          outcome: stopped ? 'allowed' : 'error',
          detail: `state=${runtime.state}; running=${runtime.processRunning}; healthy=${runtime.healthy}; ready=${runtime.ready}`,
        });
        return {
          ok: stopped,
          message: stopped ? 'Remote Connection stopped and verified' : 'Stop command completed but runtime still reports running',
          runtime: lastRemoteRuntime,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await audit.write({ tool: 'remote_stop', outcome: 'error', detail: message });
        return { ok: false, error: 'REMOTE_STOP_FAILED', message };
      }
    } catch (error) {
      return { ok: false, error: 'REMOTE_STOP_FAILED', message: error instanceof Error ? error.message : String(error) };
    } finally {
      remoteOperationInFlight = false;
    }
  });

  ipcMain.handle(DESKTOP_IPC.openDataDir, async () => {
    const config = loadConfig();
    await mkdir(config.dataDir, { recursive: true });
    const result = await shell.openPath(config.dataDir);
    return { ok: result === '', error: result || null };
  });

  ipcMain.handle(DESKTOP_IPC.restart, () => {
    app.relaunch();
    app.exit(0);
  });
}

async function writeSmokeMarker(payload: Record<string, unknown>): Promise<void> {
  const config = loadConfig();
  await ensureAwhDataDirectoryActive(config.dataDir);
  await mkdir(config.dataDir, { recursive: true });
  await writeFile(
    join(config.dataDir, 'desktop-smoke.json'),
    `${JSON.stringify({ ts: new Date().toISOString(), pid: process.pid, argv: process.argv, ...payload }, null, 2)}\n`,
    'utf8',
  );
}

async function runSmokeTest(win: BrowserWindow): Promise<void> {
  const timeout = setTimeout(() => {
    void (async () => {
      await writeSmokeMarker({ ok: false, stage: 'failed', error: 'timeout' }).catch(() => undefined);
      console.error('ART_AGENT_DESKTOP_SMOKE_TIMEOUT');
      quitting = true;
      app.exit(1);
    })();
  }, 20_000);

  try {
    await writeSmokeMarker({ ok: false, stage: 'renderer-check' });
    const result = await win.webContents.executeJavaScript(`(async () => {
      const apiReady = typeof window.artAgent?.getOverview === 'function';
      const requiredDom = ['home-command-form', 'home-command-input', 'desktop-work-thread', 'desktop-work-input', 'desktop-work-form', 'desktop-work-submit', 'desktop-work-project', 'desktop-work-status', 'project-list', 'desktop-task-list', 'artifact-list', 'enrollment-state'].every((id) => Boolean(document.getElementById(id)));
      const uiPaths = Object.fromEntries(['overview', 'projects', 'autopilot', 'tasks', 'artifacts', 'memory'].map((section) => {
        document.querySelector('.nav[data-section="' + section + '"]')?.click();
        return [section, document.getElementById('section-' + section)?.classList.contains('active') === true];
      }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
      const cmdKReady = document.activeElement?.id === 'desktop-work-input' && document.getElementById('section-autopilot')?.classList.contains('active') === true;
      document.querySelector('.nav[data-section="overview"]')?.click();
      const overview = apiReady ? await window.artAgent.getOverview() : null;
      return {
        apiReady,
        requiredDom,
        uiPaths,
        cmdKReady,
        title: document.title,
        overviewName: overview?.name ?? null,
        overviewVersion: overview?.version ?? null,
        workspaceValue: document.getElementById('workspace')?.textContent ?? null,
      };
    })()`, true) as Record<string, unknown>;

    if (
      result.apiReady !== true ||
      result.requiredDom !== true ||
      Object.values(result.uiPaths ?? {}).some((value) => value !== true) ||
      result.cmdKReady !== true ||
      result.title !== `${PRODUCT.desktopName} — ${PRODUCT.productName}` ||
      result.overviewName !== PRODUCT.productName ||
      result.overviewVersion !== VERSION
    ) {
      throw new Error(`Desktop smoke validation failed: ${JSON.stringify(result)}`);
    }
    await writeSmokeMarker({ ok: true, stage: 'passed', ...result });
    console.error(`ART_AGENT_DESKTOP_SMOKE_OK ${JSON.stringify(result)}`);
    clearTimeout(timeout);
    quitting = true;
    app.exit(0);
  } catch (error) {
    clearTimeout(timeout);
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    await writeSmokeMarker({ ok: false, stage: 'failed', error: message }).catch(() => undefined);
    console.error(`ART_AGENT_DESKTOP_SMOKE_FAILED ${message}`);
    quitting = true;
    app.exit(1);
  }
}

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* Keep the tray process alive on Windows. */ });

const smokeMarkerReady = SMOKE_TEST
  ? writeSmokeMarker({ ok: false, stage: 'module-loaded' }).catch((error) => {
      console.error(`ART_AGENT_DESKTOP_SMOKE_MARKER_FAILED ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    })
  : Promise.resolve();

async function startAfterReady(): Promise<void> {
  await smokeMarkerReady;
  registerIpc();
  startWorkerLoop();

  if (SMOKE_TEST) {
    try {
      await writeSmokeMarker({ ok: false, stage: 'main-ready' });
      mainWindow = await createWindow(false);
      await writeSmokeMarker({ ok: false, stage: 'window-loaded' });
      await runSmokeTest(mainWindow);
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      await writeSmokeMarker({ ok: false, stage: 'failed', error: message }).catch(() => undefined);
      console.error(`ART_AGENT_DESKTOP_SMOKE_BOOT_FAILED ${message}`);
      quitting = true;
      app.exit(1);
    }
    return;
  }

  mainWindow = await createWindow(true);
  tray = createTray();
  app.on('activate', () => {
    void (async () => {
      if (!mainWindow) mainWindow = await createWindow();
      mainWindow.show();
    })();
  });
}

if (SQUIRREL_STARTUP) {
  quitting = true;
  app.quit();
} else {
  void app.whenReady().then(startAfterReady).catch(async (error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    if (SMOKE_TEST) await writeSmokeMarker({ ok: false, stage: 'failed', error: message }).catch(() => undefined);
    console.error(`ART_AGENT_DESKTOP_START_FAILED ${message}`);
    quitting = true;
    app.exit(1);
  });
}
