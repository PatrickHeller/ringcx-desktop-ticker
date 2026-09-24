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
};

let mainWindow = null;
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
    mainWindow?.webContents.send('ringcx-config-missing');
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
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 220,
    minHeight: 160,
    title: 'RingCX Ticker',
    backgroundColor: '#0b0f16',
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
}

ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:save', (_event, cfg) => {
  const merged = { ...loadConfig(), ...cfg };
  saveConfig(merged);
  writeJsonFile(TOKEN_CACHE_PATH, {});
  startPolling();
  return merged;
});
ipcMain.handle('config:isComplete', () => isConfigComplete(loadConfig()));

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  stopPolling();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
