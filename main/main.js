'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog, nativeTheme } = require('electron');
const path = require('path');
const os = require('os');

const keys = require('./services/keys');
const storage = require('./services/storage');
const connect = require('./services/connect');
const sshConfig = require('./services/sshConfig');
const terminal = require('./services/terminal');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#161618' : '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => {
    terminal.killAll();
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  storage.init(app.getPath('userData'));
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => terminal.killAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function registerIpc() {
  // ---- Keys ----
  ipcMain.handle('keys:scan', () => keys.scanKeys());
  ipcMain.handle('keys:create', (_e, opts) => keys.createKey(opts));
  ipcMain.handle('keys:rename', (_e, opts) => keys.renameKey(opts));
  ipcMain.handle('keys:delete', (_e, name) => keys.deleteKey(name));
  ipcMain.handle('keys:reveal', (_e, name) => shell.showItemInFolder(keys.keyPath(name)));
  ipcMain.handle('keys:openSshFolder', () => shell.openPath(keys.sshDir));

  // ---- SSH config / aliases ----
  ipcMain.handle('sshconfig:list', () => sshConfig.listHosts());
  ipcMain.handle('sshconfig:get', (_e, name) => sshConfig.getHost(name));
  ipcMain.handle('sshconfig:save', (_e, record) => sshConfig.saveHost(record));
  ipcMain.handle('sshconfig:delete', (_e, name) => sshConfig.deleteHost(name));
  ipcMain.handle('sshconfig:reveal', () => shell.showItemInFolder(sshConfig.configPath()));
  ipcMain.handle('sshconfig:open', () => shell.openPath(sshConfig.configPath()));
  ipcMain.handle('sshconfig:command', (_e, alias) => connect.buildAliasCommand(alias));
  ipcMain.handle('sshconfig:connect', async (_e, alias) => {
    const cmd = connect.buildAliasCommand(alias);
    await connect.runCommand(cmd);
    return cmd;
  });

  // ---- Storage / data ----
  ipcMain.handle('data:getState', () => storage.getState());
  ipcMain.handle('data:get', () => storage.getData());
  ipcMain.handle('data:unlock', (_e, password) => storage.unlock(password));
  ipcMain.handle('data:lock', () => storage.lock());
  ipcMain.handle('data:setMasterPassword', (_e, payload) => storage.setMasterPassword(payload));
  ipcMain.handle('data:save', (_e, data) => storage.save(data));
  ipcMain.handle('data:openDir', () => shell.openPath(storage.dataDir));

  ipcMain.handle('data:exportBackup', async () => {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Куда сохранить резервную копию?',
      defaultPath: path.join(os.homedir(), 'Downloads', 'ssh-control-backup.json')
    });
    if (res.canceled) return null;
    return storage.exportBackup(res.filePath);
  });

  ipcMain.handle('data:changeDir', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Выберите папку для хранения данных'
    });
    if (res.canceled) return null;
    return storage.changeDir(res.filePaths[0]);
  });

  // ---- Connect ----
  ipcMain.handle('connect:command', (_e, server) => connect.buildCommand(server));
  ipcMain.handle('connect:run', (_e, server) => connect.run(server));

  // ---- Terminal ----
  terminal.setEventSink((channel, ...args) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
  });
  ipcMain.handle('term:create', (_e, payload) => terminal.createSession(payload));
  ipcMain.handle('term:write', (_e, id, data) => terminal.write(id, data));
  ipcMain.handle('term:resize', (_e, id, cols, rows) => terminal.resize(id, cols, rows));
  ipcMain.handle('term:kill', (_e, id) => terminal.kill(id));

  // ---- Misc ----
  ipcMain.handle('app:home', () => os.homedir());
}
