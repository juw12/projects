'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('airizDesktop', {
  platform: 'win32',
  getAppInfo: () => ipcRenderer.invoke('airiz:app-info'),
  getUpdateState: () => ipcRenderer.invoke('airiz:update-state'),
  checkForUpdates: () => ipcRenderer.invoke('airiz:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('airiz:update-download'),
  installUpdate: () => ipcRenderer.invoke('airiz:update-install'),
  onUpdateState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('airiz:update-state', listener);
    return () => ipcRenderer.removeListener('airiz:update-state', listener);
  },
  onShowUpdates: callback => {
    const listener = () => callback();
    ipcRenderer.on('airiz:show-updates', listener);
    return () => ipcRenderer.removeListener('airiz:show-updates', listener);
  },
  chooseSerialPort: portId => ipcRenderer.invoke('airiz:serial-choice', portId),
  onSerialPorts: callback => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required');
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('airiz:serial-ports', listener);
    return () => ipcRenderer.removeListener('airiz:serial-ports', listener);
  }
});
