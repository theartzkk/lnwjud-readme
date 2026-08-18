import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import { join } from 'node:path';
import { AuditLog } from '../audit.js';
import { listCheckpoints } from '../changes.js';
import { codexStatus } from '../codex.js';
import { loadConfig } from '../config.js';
import { gitStatus } from '../git.js';
import { canonicalWorkspace } from '../security.js';
import { loadStoredSettings, saveStoredSettings } from '../settings.js';
import { DESKTOP_IPC, DESKTOP_WEB_PREFERENCES } from './security.js';

const VERSION = '0.3.0';
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

async function runtimeOverview() {
  const config = loadConfig();
  const workspace = await canonicalWorkspace(config.workspace);
  const audit = new AuditLog(config.dataDir);
  const git = await gitStatus(workspace).catch((error: unknown) => ({ code: -1, stdout: '', stderr: error instanceof Error ? error.message : String(error) }));
  const codex = await codexStatus(workspace);
  const checkpoints = await listCheckpoints(config.dataDir, 8);
  const auditEntries = await audit.tail(20);
  return {
    name: 'Art Agent',
    version: VERSION,
    workspace,
    dataDir: config.dataDir,
    permissions: {
      write: config.allowWrite,
      execute: config.allowExec,
      codex: config.allowCodex,
    },
    git: {
      ok: git.code === 0,
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
      workspaceReady: true,
      remoteTunnelEnabled: false,
    },
  };
}

function createWindow(): BrowserWindow {
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

  void win.loadFile(join(app.getAppPath(), 'desktop', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
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
    const options = {
      title: 'เลือกโฟลเดอร์โปรเจกต์สำหรับ Art Agent',
      properties: ['openDirectory'] as const,
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
    const result = await shell.openPath(config.dataDir);
    return { ok: result === '', error: result || null };
  });

  ipcMain.handle(DESKTOP_IPC.restart, () => {
    app.relaunch();
    app.exit(0);
  });
}

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* Keep the tray process alive on Windows. */ });

await app.whenReady();
registerIpc();
mainWindow = createWindow();
tray = createTray();

app.on('activate', () => {
  if (!mainWindow) mainWindow = createWindow();
  mainWindow.show();
});
