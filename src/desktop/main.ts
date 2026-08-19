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
import { loadConfig } from '../config.js';
import { gitStatus } from '../git.js';
import { canonicalWorkspace } from '../security.js';
import { loadStoredSettings, saveStoredSettings } from '../settings.js';
import { DESKTOP_IPC, DESKTOP_WEB_PREFERENCES } from './security.js';
import { ART_AGENT_VERSION } from '../version.js';

const VERSION = ART_AGENT_VERSION;
const SMOKE_TEST = process.argv.includes('--smoke-test') || process.env.ART_AGENT_SMOKE_TEST === '1';
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

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
    process.env.ART_AGENT_WORKSPACE?.trim() ||
    loadStoredSettings(dataDir).defaultWorkspace?.trim(),
  );
}

async function runtimeOverview() {
  const config = loadConfig();
  const audit = new AuditLog(config.dataDir);
  const checkpoints = await listCheckpoints(config.dataDir, 8);
  const auditEntries = await audit.tail(20);
  const workspaceConfigured = hasExplicitWorkspace(config.dataDir);

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

  return {
    name: 'Art Agent',
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
      remoteTunnelEnabled: false,
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
    title: 'Art Agent Control Center',
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
  item.setToolTip('Art Agent Control Center');
  item.setContextMenu(Menu.buildFromTemplate([
    { label: 'เปิด Art Agent', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: 'ออก', click: () => { quitting = true; app.quit(); } },
  ]));
  item.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
  return item;
}

function registerIpc(): void {
  ipcMain.handle(DESKTOP_IPC.overview, async () => runtimeOverview());

  ipcMain.handle(DESKTOP_IPC.chooseWorkspace, async () => {
    const options: OpenDialogOptions = {
      title: 'เลือกโฟลเดอร์โปรเจกต์สำหรับ Art Agent',
      properties: ['openDirectory'],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    const selected = result.filePaths[0];
    if (result.canceled || !selected) return { changed: false };
    const canonical = await canonicalWorkspace(selected);
    const config = loadConfig();
    const stored = loadStoredSettings(config.dataDir);
    await saveStoredSettings(config.dataDir, { ...stored, defaultWorkspace: canonical });
    return { changed: true, workspace: canonical, restartRequired: true };
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
      const requiredDom = ['workspace', 'git-output', 'perm-write', 'doctor-runtime'].every((id) => Boolean(document.getElementById(id)));
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
      result.title !== 'Art Agent Control Center' ||
      result.overviewName !== 'Art Agent' ||
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
