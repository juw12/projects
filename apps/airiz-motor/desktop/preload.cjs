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
  readTeamsWorkflowClipboard: () => ipcRenderer.invoke('airiz:teams-workflow-clipboard'),
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
  },
  // 1.9.0: keep the PC awake while sharing; sleep / wake-up notices for the share.
  setKeepAwake: flag => ipcRenderer.invoke('airiz:keep-awake', flag === true),
  setSharing: flag => ipcRenderer.invoke('airiz:sharing', flag === true),
  requestAttention: flag => ipcRenderer.invoke('airiz:attention', flag === true),
  setLidAwake: flag => ipcRenderer.invoke('airiz:lid-awake', flag === true),
  getPowerStatus: () => ipcRenderer.invoke('airiz:power-status'),
  onPowerChange: callback => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required');
    const listener = (_event, state) => callback(String(state));
    ipcRenderer.on('airiz:power', listener);
    return () => ipcRenderer.removeListener('airiz:power', listener);
  }
});
