'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ringcx', {
  onData: (callback) => ipcRenderer.on('ringcx-data', (_event, payload) => callback(payload)),
  onError: (callback) => ipcRenderer.on('ringcx-error', (_event, message) => callback(message)),
  onConfigMissing: (callback) => ipcRenderer.on('ringcx-config-missing', () => callback()),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  isConfigComplete: () => ipcRenderer.invoke('config:isComplete'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
});
