const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = Object.freeze({
  overview: 'art-agent:overview',
  chooseWorkspace: 'art-agent:choose-workspace',
  setPermissions: 'art-agent:set-permissions',
  restart: 'art-agent:restart',
  openDataDir: 'art-agent:open-data-dir',
});

contextBridge.exposeInMainWorld('artAgent', Object.freeze({
  getOverview: () => ipcRenderer.invoke(CHANNELS.overview),
  chooseWorkspace: () => ipcRenderer.invoke(CHANNELS.chooseWorkspace),
  setPermissions: (permissions) => ipcRenderer.invoke(CHANNELS.setPermissions, {
    write: permissions?.write === true,
    execute: permissions?.execute === true,
    codex: permissions?.codex === true,
  }),
  restart: () => ipcRenderer.invoke(CHANNELS.restart),
  openDataDir: () => ipcRenderer.invoke(CHANNELS.openDataDir),
}));
