export const DESKTOP_WEB_PREFERENCES = Object.freeze({
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webviewTag: false,
});

export const DESKTOP_IPC = Object.freeze({
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
