'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Keys
  scanKeys: () => ipcRenderer.invoke('keys:scan'),
  createKey: (opts) => ipcRenderer.invoke('keys:create', opts),
  renameKey: (opts) => ipcRenderer.invoke('keys:rename', opts),
  deleteKey: (name) => ipcRenderer.invoke('keys:delete', name),
  revealKey: (name) => ipcRenderer.invoke('keys:reveal', name),
  openSshFolder: () => ipcRenderer.invoke('keys:openSshFolder'),

  // Data / storage
  getState: () => ipcRenderer.invoke('data:getState'),
  getData: () => ipcRenderer.invoke('data:get'),
  unlock: (password) => ipcRenderer.invoke('data:unlock', password),
  lock: () => ipcRenderer.invoke('data:lock'),
  setMasterPassword: (payload) => ipcRenderer.invoke('data:setMasterPassword', payload),
  save: (data) => ipcRenderer.invoke('data:save', data),
  openDataDir: () => ipcRenderer.invoke('data:openDir'),
  exportBackup: () => ipcRenderer.invoke('data:exportBackup'),
  changeDataDir: () => ipcRenderer.invoke('data:changeDir'),

  // Connect
  buildCommand: (server) => ipcRenderer.invoke('connect:command', server),
  connect: (server) => ipcRenderer.invoke('connect:run', server),

  // Misc
  getHome: () => ipcRenderer.invoke('app:home'),

  platform: process.platform
});
