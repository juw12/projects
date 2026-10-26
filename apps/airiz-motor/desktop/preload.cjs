'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('airizDesktop', {
  platform: 'win32',
  getAppInfo: () => ipcRenderer.invoke('airiz:app-info'),
  chooseSerialPort: portId => ipcRenderer.invoke('airiz:serial-choice', portId),
  onSerialPorts: callback => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required');
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('airiz:serial-ports', listener);
    return () => ipcRenderer.removeListener('airiz:serial-ports', listener);
  }
});
