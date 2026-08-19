export const DESKTOP_WEB_PREFERENCES = Object.freeze({
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webviewTag: false,
});

export const DESKTOP_IPC = Object.freeze({
  overview: 'art-agent:overview',
  chooseWorkspace: 'art-agent:choose-workspace',
  setPermissions: 'art-agent:set-permissions',
  remoteConnect: 'art-agent:remote-connect',
  remoteStop: 'art-agent:remote-stop',
  restart: 'art-agent:restart',
  openDataDir: 'art-agent:open-data-dir',
});
