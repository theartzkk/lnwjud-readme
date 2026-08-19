const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = Object.freeze({
  overview: 'art-agent:overview',
  projects: 'art-agent:projects',
  projectContext: 'art-agent:project-context',
  registerProject: 'art-agent:register-project',
  initializeProject: 'art-agent:initialize-project',
  initializeProjectMemory: 'art-agent:initialize-project-memory',
  selectProject: 'art-agent:select-project',
  locateProject: 'art-agent:locate-project',
  chooseWorkspace: 'art-agent:choose-workspace',
  setPermissions: 'art-agent:set-permissions',
  remoteConnect: 'art-agent:remote-connect',
  remoteStop: 'art-agent:remote-stop',
  restart: 'art-agent:restart',
  openDataDir: 'art-agent:open-data-dir',
});

contextBridge.exposeInMainWorld('artAgent', Object.freeze({
  getOverview: () => ipcRenderer.invoke(CHANNELS.overview),
  getProjects: () => ipcRenderer.invoke(CHANNELS.projects),
  getProjectContext: (projectId) => ipcRenderer.invoke(CHANNELS.projectContext, typeof projectId === 'string' ? projectId.slice(0, 64) : ''),
  registerProject: () => ipcRenderer.invoke(CHANNELS.registerProject),
  initializeProject: () => ipcRenderer.invoke(CHANNELS.initializeProject),
  initializeProjectMemory: (projectId) => ipcRenderer.invoke(CHANNELS.initializeProjectMemory, typeof projectId === 'string' ? projectId.slice(0, 64) : ''),
  selectProject: (projectId) => ipcRenderer.invoke(CHANNELS.selectProject, typeof projectId === 'string' ? projectId.slice(0, 64) : ''),
  locateProject: (projectId) => ipcRenderer.invoke(CHANNELS.locateProject, typeof projectId === 'string' ? projectId.slice(0, 64) : ''),
  chooseWorkspace: () => ipcRenderer.invoke(CHANNELS.chooseWorkspace),
  setPermissions: (permissions) => ipcRenderer.invoke(CHANNELS.setPermissions, {
    write: permissions?.write === true,
    execute: permissions?.execute === true,
    codex: permissions?.codex === true,
  }),
  remoteConnect: () => ipcRenderer.invoke(CHANNELS.remoteConnect),
  remoteStop: () => ipcRenderer.invoke(CHANNELS.remoteStop),
  restart: () => ipcRenderer.invoke(CHANNELS.restart),
  openDataDir: () => ipcRenderer.invoke(CHANNELS.openDataDir),
}));
