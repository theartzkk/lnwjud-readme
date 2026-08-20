import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
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
import { readDeviceIdentity } from '../device-identity.js';
import { createProductionCredentialStore, CredentialStoreError } from '../credential-store.js';
import { EnrollmentClient, EnrollmentClientError, readLocalEnrollmentState } from '../enrollment-client.js';
import { ensureAwhDataDirectoryActive } from '../data-migration.js';
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
import { ART_AGENT_VERSION } from '../version.js';
import { PRODUCT } from '../product.js';

const VERSION = ART_AGENT_VERSION;
const SMOKE_TEST = process.argv.includes('--smoke-test') || process.env.ART_AGENT_SMOKE_TEST === '1';
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let remoteOperationInFlight = false;
let lastRemoteRuntime: ReturnType<typeof sanitizedTunnelRuntime> | null = null;
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
  if (error instanceof CredentialStoreError) return { ok: false, error: error.code, message: 'Secure OS credential store is unavailable' };
  if (error instanceof EnrollmentClientError) return { ok: false, error: error.code, message: error.code === 'HUB_NOT_CONFIGURED' ? 'Hub enrollment API is not configured' : 'Enrollment action was rejected' };
  return { ok: false, error: 'ENROLLMENT_FAILED', message: 'Device enrollment is unavailable' };
}

function enrollmentClient(config: ReturnType<typeof loadConfig>): EnrollmentClient {
  if (!config.hubApiBase) throw new EnrollmentClientError('Hub enrollment API is not configured', 'HUB_NOT_CONFIGURED');
  return new EnrollmentClient(config.hubApiBase, config.dataDir, createProductionCredentialStore());
}

async function enrollmentState() {
  const config = loadConfig();
  try {
    const store = createProductionCredentialStore();
    const state = await readLocalEnrollmentState(config.dataDir, store);
    return { ok: true, hubConfigured: Boolean(config.hubApiBase), ...state };
  } catch (error) {
    return { ...enrollmentError(error), hubConfigured: Boolean(config.hubApiBase), enrolled: false, deviceId: null, displayName: null, platform: process.platform, credentialStored: false, expiresAt: null, projectCount: null };
  }
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

async function projectsOverview() {
  const config = loadConfig();
  const configuredWorkspace = hasExplicitWorkspace(config.dataDir)
    ? await canonicalWorkspace(config.workspace).catch(() => null)
    : null;
  const records = await listProjects(config.dataDir);
  const availableById = new Map<string, Set<string>>();
  const entries = await Promise.all(records.map(async (record) => {
    const base = {
      projectId: record.projectId,
      workspacePath: record.workspacePath,
      lastOpenedAt: record.lastOpenedAt,
      lastUsedAt: record.lastUsedAt,
      pinned: record.pinned,
      selected: false,
      name: null as string | null,
      type: null as string | null,
      localAvailable: false,
      state: 'UNAVAILABLE' as 'AVAILABLE' | 'UNAVAILABLE' | 'CONFLICT',
      error: null as string | null,
      memory: null as Record<string, 'present' | 'missing'> | null,
      git: null as { ok: boolean; text: string } | null,
    };
    try {
      const root = await canonicalWorkspace(record.workspacePath);
      const manifest = await readProjectManifest(root);
      if (manifest.projectId !== record.projectId) throw new ProjectRegistryError('Workspace manifest project id does not match the registry', 'PROJECT_ID_MISMATCH');
      const git = await gitStatus(root);
      base.name = manifest.name;
      base.type = manifest.type;
      base.localAvailable = true;
      base.state = 'AVAILABLE';
      base.selected = configuredWorkspace === root;
      base.memory = await projectMemoryStatus(root);
      base.git = { ok: git.code === 0, text: git.code === 0 ? git.stdout : git.stderr };
      const paths = availableById.get(record.projectId) ?? new Set<string>();
      paths.add(root);
      availableById.set(record.projectId, paths);
    } catch (error) {
      const detail = projectError(error);
      base.error = detail.message;
      if (detail.code === 'PROJECT_ID_MISMATCH') base.state = 'CONFLICT';
    }
    return base;
  }));
  for (const entry of entries) {
    if ((availableById.get(entry.projectId)?.size ?? 0) > 1) {
      entry.state = 'CONFLICT';
      entry.error = 'Project ID is available at more than one local workspace';
    }
  }
  return { projects: entries, currentWorkspace: configuredWorkspace };
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
    workspace: workspace ?? (workspaceConfigured ? config.workspace : 'ยังไม่ได้เลือก workspace'),
    dataDir: config.dataDir,
    permissions: {
      write: config.allowWrite,
      execute: config.allowExec,
      codex: config.allowCodex,
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
    return { changed: true, projectId: record.projectId, workspace: record.workspacePath };
  });

  ipcMain.handle(DESKTOP_IPC.initializeProject, async () => {
    const selected = await chooseDirectory(`เริ่มต้นโปรเจกต์ AWH ในโฟลเดอร์ที่เลือก`);
    if (!selected) return { changed: false, cancelled: true };
    const config = loadConfig();
    const manifest = await initializeProject(selected);
    const record = await registerProject(config.dataDir, selected);
    return { changed: true, project: manifest, projectId: record.projectId, workspace: record.workspacePath };
  });

  ipcMain.handle(DESKTOP_IPC.initializeProjectMemory, async (_event, projectId: unknown) => {
    if (typeof projectId !== 'string') throw new ProjectRegistryError('Project id is required', 'PROJECT_ID_INVALID');
    const config = loadConfig();
    const resolved = await resolveRegisteredProject(config.dataDir, projectId);
    const created = await initializeProjectMemory(resolved.workspacePath);
    return { changed: created.length > 0, created };
  });

  ipcMain.handle(DESKTOP_IPC.selectProject, async (_event, projectId: unknown) => {
    if (typeof projectId !== 'string') throw new ProjectRegistryError('Project id is required', 'PROJECT_ID_INVALID');
    const config = loadConfig();
    const record = await openRegisteredProject(config.dataDir, projectId);
    const stored = loadStoredSettings(config.dataDir);
    await saveStoredSettings(config.dataDir, { ...stored, defaultWorkspace: record.workspacePath });
    return { changed: true, restartRequired: true, projectId: record.projectId, workspace: record.workspacePath };
  });

  ipcMain.handle(DESKTOP_IPC.locateProject, async (_event, projectId: unknown) => {
    if (typeof projectId !== 'string') throw new ProjectRegistryError('Project id is required', 'PROJECT_ID_INVALID');
    const selected = await chooseDirectory('ค้นหาโฟลเดอร์ของโปรเจกต์ที่ย้ายแล้ว');
    if (!selected) return { changed: false, cancelled: true };
    const config = loadConfig();
    const manifest = await readProjectManifest(selected);
    if (manifest.projectId !== projectId) throw new ProjectRegistryError('โฟลเดอร์ที่เลือกมี projectId ไม่ตรงกัน', 'PROJECT_ID_MISMATCH');
    const record = await registerProject(config.dataDir, selected);
    const stored = loadStoredSettings(config.dataDir);
    await saveStoredSettings(config.dataDir, { ...stored, defaultWorkspace: record.workspacePath });
    return { changed: true, restartRequired: true, projectId: record.projectId, workspace: record.workspacePath };
  });

  ipcMain.handle(DESKTOP_IPC.chooseWorkspace, async () => {
    const selected = await chooseDirectory(`เลือกโปรเจกต์ที่ลงทะเบียนแล้วสำหรับ ${PRODUCT.desktopName}`);
    if (!selected) return { changed: false, cancelled: true };
    const config = loadConfig();
    const record = await registerProject(config.dataDir, selected);
    const stored = loadStoredSettings(config.dataDir);
    await saveStoredSettings(config.dataDir, { ...stored, defaultWorkspace: record.workspacePath });
    return { changed: true, projectId: record.projectId, workspace: record.workspacePath, restartRequired: true };
  });

  ipcMain.handle(DESKTOP_IPC.setPermissions, async (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid permission payload');
    const value = input as Record<string, unknown>;
    if (typeof value.write !== 'boolean' || typeof value.execute !== 'boolean' || typeof value.codex !== 'boolean') {
      throw new Error('Permission values must be booleans');
    }
    if (value.codex && !value.execute) throw new Error('Codex requires approved execution');
    const config = loadConfig();
    const stored = loadStoredSettings(config.dataDir);
    await saveStoredSettings(config.dataDir, {
      ...stored,
      allowWrite: value.write,
      allowExec: value.execute,
      allowCodex: value.codex,
    });
    return { changed: true, restartRequired: true };
  });

  ipcMain.handle(DESKTOP_IPC.enrollmentState, async () => enrollmentState());
  ipcMain.handle(DESKTOP_IPC.enrollmentPair, async (_event, pairingCode: unknown) => pairDevice(pairingCode));
  ipcMain.handle(DESKTOP_IPC.enrollmentRotate, async () => rotateDevice());
  ipcMain.handle(DESKTOP_IPC.enrollmentRevoke, async () => revokeDevice());

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
      const requiredDom = ['workspace', 'git-output', 'perm-write', 'doctor-runtime', 'remote-state', 'remote-connect', 'remote-stop', 'enrollment-state', 'enrollment-code', 'enrollment-pair'].every((id) => Boolean(document.getElementById(id)));
      const overview = apiReady ? await window.artAgent.getOverview() : null;
      return {
        apiReady,
        requiredDom,
        title: document.title,
        overviewName: overview?.name ?? null,
        overviewVersion: overview?.version ?? null,
        workspaceValue: document.getElementById('workspace')?.textContent ?? null,
      };
    })()`, true) as Record<string, unknown>;

    if (
      result.apiReady !== true ||
      result.requiredDom !== true ||
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
