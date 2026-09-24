'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { RingCXClient } = require('./ringcx-client');

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const TOKEN_CACHE_PATH = path.join(app.getPath('userData'), 'token_cache.json');

const REQUIRED_FIELDS = ['ACCOUNT_ID', 'AGENT_GROUP_ID', 'CLIENT_ID', 'CLIENT_SECRET', 'JWT_ASSERTION'];
const DEFAULT_CONFIG = {
  BASE_URL: 'https://ringcx.ringcentral.com',
  AUTH_URL: 'https://platform.ringcentral.com/restapi/oauth/token',
  ACCOUNT_ID: '',
  AGENT_GROUP_ID: '',
  CLIENT_ID: '',
  CLIENT_SECRET: '',
  JWT_ASSERTION: '',
  POLL_INTERVAL_SECONDS: 15,
  SCROLL_SPEED: 70,
  FONT_SIZE: 15,
  BORDERLESS: false,
  ALWAYS_ON_TOP: false,
  SHOW_QUEUES: true,
  SHOW_AGENTS: true,
};

let mainWindow = null;
let settingsWindow = null;
let pollTimer = null;

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function writeJsonFile(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function loadConfig() {
  return { ...DEFAULT_CONFIG, ...readJsonFile(CONFIG_PATH) };
}

function saveConfig(cfg) {
  writeJsonFile(CONFIG_PATH, cfg);
}

function isConfigComplete(cfg) {
  return REQUIRED_FIELDS.every((key) => String(cfg[key] || '').trim() !== '');
}

const tokenStore = {
  load: () => readJsonFile(TOKEN_CACHE_PATH),
  save: (data) => writeJsonFile(TOKEN_CACHE_PATH, data),
};

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling() {
  stopPolling();
  const cfg = loadConfig();
  if (!isConfigComplete(cfg)) {
    openSettingsWindow();
    return;
  }
  const client = new RingCXClient(cfg, tokenStore);
  const intervalMs = Math.max(5, parseInt(cfg.POLL_INTERVAL_SECONDS, 10) || 15) * 1000;

  const poll = async () => {
    try {
      const data = await client.getAll();
      mainWindow?.webContents.send('ringcx-data', { ...data, lastUpdate: new Date().toISOString() });
    } catch (err) {
      mainWindow?.webContents.send('ringcx-error', err.message || String(err));
    }
  };

  poll();
  pollTimer = setInterval(poll, intervalMs);
}

function createWindow() {
  const cfg = loadConfig();
  const bounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
  const previous = mainWindow;

  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1400,
    height: bounds?.height ?? 220,
    x: bounds?.x,
    y: bounds?.y,
    minHeight: 60,
    title: `RingCX Ticker v${app.getVersion()}`,
    backgroundColor: '#0b0f16',
    frame: !cfg.BORDERLESS,
    alwaysOnTop: !!cfg.ALWAYS_ON_TOP,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    startPolling();
  });

  if (previous && !previous.isDestroyed()) previous.close();
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 500,
    height: 720,
    minWidth: 420,
    minHeight: 500,
    title: `RingCX Ticker v${app.getVersion()} – Einstellungen`,
    backgroundColor: '#0b0f16',
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:save', (_event, cfg) => {
  const previous = loadConfig();
  const merged = { ...previous, ...cfg };
  saveConfig(merged);
  writeJsonFile(TOKEN_CACHE_PATH, {});

  if (Boolean(previous.BORDERLESS) !== Boolean(merged.BORDERLESS)) {
    createWindow();
  } else {
    mainWindow?.setAlwaysOnTop(!!merged.ALWAYS_ON_TOP);
    startPolling();
  }
  mainWindow?.webContents.send('ringcx-config-updated', merged);
  return merged;
});
ipcMain.handle('config:isComplete', () => isConfigComplete(loadConfig()));
ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:setContentHeight', (_event, height) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [width] = mainWindow.getContentSize();
  const targetHeight = Math.max(1, Math.round(height));
  const [, currentHeight] = mainWindow.getContentSize();
  if (Math.abs(currentHeight - targetHeight) < 2) return;
  mainWindow.setContentSize(width, targetHeight);
});
ipcMain.handle('settings:open', () => openSettingsWindow());
ipcMain.handle('settings:close', () => settingsWindow?.close());

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  stopPolling();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
