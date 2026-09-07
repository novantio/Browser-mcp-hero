import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserManager } from './browser-manager';
import { ProfileManager } from './profile-manager';
import { SessionManager } from './session-manager';
import { parseBounds, parseCommand } from '../shared/navigation';
import type { BrowserCommand, CommandResult } from '../shared/types';

// Separate the persistent release from the still-running Milestone 1 shell.
// An explicit --user-data-dir is respected for isolated test runs.
app.setName('Hero Browser');
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', path.join(app.getPath('appData'), 'Hero Browser Profiles'));
}
app.setPath('sessionData', app.getPath('userData'));
let mainWindow: BrowserWindow | null = null;
let manager: BrowserManager | null = null;
let profiles: ProfileManager;
let sessions: SessionManager;
let commandBusy = false;
const rendererPath = path.join(__dirname, '../ui/renderer/index.html');
const rendererUrl = pathToFileURL(rendererPath).href;

function requireTrustedSender(event: Electron.IpcMainInvokeEvent): BrowserManager {
  if (!mainWindow || !manager || event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame || event.senderFrame.url !== rendererUrl) {
    throw new Error('Akses browser ditolak.');
  }
  return manager;
}

async function handleCommand(browser: BrowserManager, command: BrowserCommand): Promise<void> {
  if (command.action === 'create-profile') { browser.createProfile(command.name); return; }
  if (command.action === 'switch-profile') { browser.switchProfile(command.profileId); return; }
  if (command.action === 'save-session') { await sessions.flush(); return; }
  if (command.action === 'delete-profile') {
    profiles.assertDeletable(command.profileId);
    const profile = profiles.requireProfile(command.profileId);
    const result = await dialog.showMessageBox(mainWindow!, {
      type: 'warning', title: 'Hapus profil', message: 'Hapus profil “' + profile.name + '”?',
      detail: 'Semua tab, login, cookie, dan data situs di profil ini akan dihapus dari perangkat. Profil lain tetap tersedia.',
      buttons: ['Batal', 'Hapus profil'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (result.response === 1) await browser.deleteProfile(command.profileId);
    return;
  }
  browser.execute(command);
}

ipcMain.handle('browser:state', event => requireTrustedSender(event).snapshot());
ipcMain.handle('browser:command', async (event, value: unknown): Promise<CommandResult> => {
  let ownsCommand = false;
  try {
    const browser = requireTrustedSender(event);
    const command = parseCommand(value);
    if (commandBusy) throw new Error('Tunggu hingga perubahan profil selesai.');
    commandBusy = true;
    ownsCommand = true;
    await handleCommand(browser, command);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Perintah gagal.' };
  } finally { if (ownsCommand) commandBusy = false; }
});
ipcMain.handle('browser:bounds', (event, value: unknown) => requireTrustedSender(event).setBounds(parseBounds(value)));

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440, height: 940, minWidth: 900, minHeight: 620,
    title: 'Hero Browser — Profil persisten', backgroundColor: '#111a2b', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  mainWindow = window;
  const browser = new BrowserManager(window, state => {
    if (!window.isDestroyed()) window.webContents.send('browser:state-changed', state);
  }, profiles, sessions);
  manager = browser;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.on('resize', () => browser.layout());
  let savedForClose = false;
  let closing = false;
  window.on('close', event => {
    if (savedForClose) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    void sessions.flush().then(() => {
      savedForClose = true;
      window.close();
    }).catch(() => {
      closing = false;
      app.focus();
      dialog.showErrorBox('Sesi belum tersimpan', 'Data sesi gagal disimpan. Periksa ruang disk dan izin folder, lalu coba tutup kembali.');
    });
  });
  window.on('closed', () => { browser.dispose(); manager = null; mainWindow = null; });
  window.once('ready-to-show', () => window.show());
  await window.loadFile(rendererPath);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  });
  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    profiles = new ProfileManager(app.getPath('userData'));
    sessions = new SessionManager(profiles);
    await createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
  }).catch(error => {
    dialog.showErrorBox('Hero tidak dapat dibuka', error instanceof Error ? error.message : 'Terjadi kesalahan saat membuka profil.');
    app.exit(1);
  });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
