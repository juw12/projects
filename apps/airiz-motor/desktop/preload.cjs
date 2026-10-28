'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('airizDesktop', {
  platform: 'win32',
  getAppInfo: () => ipcRenderer.invoke('airiz:app-info'),
  getUpdateState: () => ipcRenderer.invoke('airiz:update-state'),
  checkForUpdates: () => ipcRenderer.invoke('airiz:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('airiz:update-download'),
  installUpdate: () => ipcRenderer.invoke('airiz:update-install'),
  cancelScheduledUpdate: () => ipcRenderer.invoke('airiz:update-cancel-schedule'),
  takePendingReconnect: () => ipcRenderer.invoke('airiz:take-pending-reconnect'),
  chooseBluetoothDevice: id => ipcRenderer.invoke('airiz:bluetooth-choice', id),
  onBluetoothDevices: callback => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required');
    const listener = (_event, devices) => callback(devices);
    ipcRenderer.on('airiz:bluetooth-devices', listener);
    return () => ipcRenderer.removeListener('airiz:bluetooth-devices', listener);
  },
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
  postToTeams: (workflowUrl, body) => ipcRenderer.invoke('airiz:teams-post', String(workflowUrl), String(body)),
  // Ziris PTB invite opened with airiz-console://join… (website "Open in the AIRIZ Windows app").
  takeTeamInvite: () => ipcRenderer.invoke('airiz:take-team-invite'),
  onTeamInvite: callback => {
    const listener = () => callback();
    ipcRenderer.on('airiz:team-invite-ready', listener);
    return () => ipcRenderer.removeListener('airiz:team-invite-ready', listener);
  },
  onSerialPorts: callback => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required');
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('airiz:serial-ports', listener);
    return () => ipcRenderer.removeListener('airiz:serial-ports', listener);
  }
});
