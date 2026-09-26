const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = Object.freeze({
  enrollmentState: 'art-agent:enrollment-state',
  enrollmentLogin: 'art-agent:enrollment-login',
  workerState: 'art-agent:worker-state',
  openAwhWeb: 'art-agent:open-awh-web',
});

contextBridge.exposeInMainWorld('awhConnect', Object.freeze({
  getEnrollmentState: () => ipcRenderer.invoke(CHANNELS.enrollmentState),
  login: (username, password) => ipcRenderer.invoke(
    CHANNELS.enrollmentLogin,
    typeof username === 'string' ? username.slice(0, 64) : '',
    typeof password === 'string' ? password.slice(0, 512) : '',
  ),
  getWorkerState: () => ipcRenderer.invoke(CHANNELS.workerState),
  openAwhWeb: (target = 'home') => ipcRenderer.invoke(CHANNELS.openAwhWeb, target === 'devices' ? 'devices' : 'home'),
}));
