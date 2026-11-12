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

  // Aliases / SSH config
  listHosts: () => ipcRenderer.invoke('sshconfig:list'),
  getHost: (name) => ipcRenderer.invoke('sshconfig:get', name),
  saveHost: (record) => ipcRenderer.invoke('sshconfig:save', record),
  deleteHost: (name) => ipcRenderer.invoke('sshconfig:delete', name),
  revealConfig: () => ipcRenderer.invoke('sshconfig:reveal'),
  openConfig: () => ipcRenderer.invoke('sshconfig:open'),
  aliasCommand: (alias) => ipcRenderer.invoke('sshconfig:command', alias),
  connectAlias: (alias) => ipcRenderer.invoke('sshconfig:connect', alias),

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

  // Terminal
  createTerminal: (payload) => ipcRenderer.invoke('term:create', payload),
  writeTerminal: (id, data) => ipcRenderer.invoke('term:write', id, data),
  resizeTerminal: (id, cols, rows) => ipcRenderer.invoke('term:resize', id, cols, rows),
  killTerminal: (id) => ipcRenderer.invoke('term:kill', id),
  onTermData: (cb) => { ipcRenderer.on('term:data', (_e, id, data) => cb(id, data)); },
  onTermExit: (cb) => { ipcRenderer.on('term:exit', (_e, id, code) => cb(id, code)); },

  // Misc
  getHome: () => ipcRenderer.invoke('app:home'),

  platform: process.platform
});
