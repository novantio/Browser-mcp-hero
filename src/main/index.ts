import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserManager } from './browser-manager';
import { parseBounds, parseCommand } from '../shared/navigation';
import type { CommandResult } from '../shared/types';

app.setName('Hero Browser');
let mainWindow: BrowserWindow | null = null;
let manager: BrowserManager | null = null;
const rendererPath = path.join(__dirname, '../ui/renderer/index.html');
const rendererUrl = pathToFileURL(rendererPath).href;

function requireTrustedSender(event: Electron.IpcMainInvokeEvent): BrowserManager {
  if (!mainWindow || !manager || event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame || event.senderFrame.url !== rendererUrl) {
    throw new Error('Akses browser ditolak.');
  }
  return manager;
}

ipcMain.handle('browser:state', event => requireTrustedSender(event).snapshot());
ipcMain.handle('browser:command', (event, value: unknown): CommandResult => {
  try { requireTrustedSender(event).execute(parseCommand(value)); return { ok: true }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Perintah gagal.' }; }
});
ipcMain.handle('browser:bounds', (event, value: unknown) => requireTrustedSender(event).setBounds(parseBounds(value)));

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440, height: 940, minWidth: 900, minHeight: 620,
    title: 'Hero Browser', backgroundColor: '#111a2b', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  mainWindow = window;
  const browser = new BrowserManager(window, state => {
    if (!window.isDestroyed()) window.webContents.send('browser:state-changed', state);
  });
  manager = browser;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.on('resize', () => browser.layout());
  window.on('closed', () => { browser.dispose(); manager = null; mainWindow = null; });
  window.once('ready-to-show', () => window.show());
  await window.loadFile(rendererPath);
}

void app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
}).catch(error => { console.error('Application startup failed:', error); app.exit(1); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
