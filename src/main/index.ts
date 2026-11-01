import { app, BrowserWindow, dialog, ipcMain, clipboard } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserManager } from './browser-manager';
import { EngineUpdater } from './engine-updater';
import { engineDirectory } from './engine-selection';
import { latestStable, prepareEngine } from './engine-download';
import { ProfileManager } from './profile-manager';
import { SessionManager } from './session-manager';
import { TaskManager } from './task-manager';
import { McpBridge } from './mcp-bridge';
import { AuditLogger } from './audit-logger';
import { DataStore } from './data/store';
import { DataAnalysis } from './data/analysis';
import { JobRunner } from './data/job-runner';
import { InteractionRecorder } from './data/recorder';
import { parseBounds, parseCommand } from '../shared/navigation';
import type { CommandResult } from '../shared/types';
import { setupApplicationMenu } from './app-menu';
import { handleCommand } from './ui-commands';
import { registerDataIpc } from './data-ipc';
import { restartApp } from './app-restart';

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
let tasks: TaskManager;
let auditLogger: AuditLogger;
let bridge: McpBridge | null = null;
let bridgePort: number | null = null;
let store: DataStore;
let analysis: DataAnalysis;
let jobRunner: JobRunner;
let recorder: InteractionRecorder;
let engineUpdater: EngineUpdater;
let commandBusy = false;
let mcpStatus: "starting" | "ready" | "failed" = "starting";

const runtimeState = (browser: BrowserManager) => ({
  ...browser.snapshot(),
  tasks: tasks.listTasks(),
  mcpStatus,
  engineUpdate: engineUpdater?.snapshot(),
  dataOverview: jobRunner ? jobRunner.overview() : undefined,
});
function publishRuntime(): void {
  if (manager && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("browser:state-changed", runtimeState(manager));
}
const rendererPath = path.join(__dirname, '../ui/renderer/index.html');
const rendererUrl = pathToFileURL(rendererPath).href;

function requireTrustedSender(event: Electron.IpcMainInvokeEvent): BrowserManager {
  if (!mainWindow || !manager || event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame ||
      event.senderFrame.url.toLowerCase() !== rendererUrl.toLowerCase()) {
    throw new Error('Akses browser ditolak.');
  }
  return manager;
}

ipcMain.handle('browser:engine-command', (event, action: unknown) => {
  requireTrustedSender(event);
  if (!engineUpdater || !['check', 'enable', 'disable'].includes(String(action))) throw new Error('Perintah pembaruan tidak valid.');
  if (action === 'check') { void engineUpdater.check(); return engineUpdater.snapshot(); }
  return engineUpdater.setEnabled(action === 'enable');
});

ipcMain.handle('browser:state', event => runtimeState(requireTrustedSender(event)));
ipcMain.handle('browser:command', async (event, value: unknown): Promise<CommandResult> => {
  let ownsCommand = false;
  try {
    const browser = requireTrustedSender(event);
    const command = parseCommand(value);
    if (commandBusy) throw new Error('Tunggu hingga perubahan profil selesai.');
    commandBusy = true;
    ownsCommand = true;
    await handleCommand({ window: mainWindow!, profiles, sessions, tasks }, browser, command);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Perintah gagal.' };
  } finally { if (ownsCommand) commandBusy = false; }
});
ipcMain.handle('browser:bounds', (event, value: unknown) => requireTrustedSender(event).setBounds(parseBounds(value)));
ipcMain.handle('browser:get-mcp-config', event => {
  requireTrustedSender(event);
  const mcpScriptPath = path.resolve(__dirname, '../mcp/index.js').replace(/\\/g, '/');
  const projectDir = path.resolve(__dirname, '../..').replace(/\\/g, '/');
  return {
    mcpScriptPath,
    projectDir,
    claudeDesktopConfig: {
      mcpServers: {
        'hero-browser': {
          command: 'node',
          args: [mcpScriptPath],
        },
      },
    },
    geminiAntigravityConfig: {
      'hero-browser': {
        command: 'node',
        args: [mcpScriptPath],
      },
    },
    cliCommand: `node "${mcpScriptPath}"`,
    bridgePort: bridgePort ?? undefined,
  };
});
ipcMain.handle('browser:copy-clipboard', (event, text: unknown) => {
  requireTrustedSender(event);
  if (typeof text === 'string') {
    clipboard.writeText(text);
    return true;
  }
  return false;
});

registerDataIpc({
  trust: requireTrustedSender, jobRunner: () => jobRunner, analysis: () => analysis, store: () => store, recorder: () => recorder,
});

async function createWindow(): Promise<void> {
  const isHeadless = app.commandLine.hasSwitch('headless') || process.argv.includes('--headless') || process.argv.includes('--quiet');
  const window = new BrowserWindow({
    width: 1440, height: 940, minWidth: 900, minHeight: 620,
    title: 'Hero Browser — Profil persisten', backgroundColor: '#111a2b', show: false, autoHideMenuBar: true,
    skipTaskbar: isHeadless,
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false },
  });
  (window as any).isHeadlessMode = isHeadless;
  mainWindow = window;
  const browser = new BrowserManager(window, state => {
    if (!window.isDestroyed()) window.webContents.send('browser:state-changed', { ...state, tasks: tasks.listTasks(), mcpStatus, engineUpdate: engineUpdater?.snapshot() });
  }, profiles, sessions);
  manager = browser;
  tasks.setInterventionListener(req => {
    if (!window.isDestroyed()) {
      if (req) {
        if (!window.isVisible()) window.show();
        if (window.isMinimized()) window.restore();
        window.setAlwaysOnTop(true, 'screen-saver');
        window.focus();
        window.moveTop();
        window.flashFrame(true);
      } else {
        window.setAlwaysOnTop(false);
      }
      window.webContents.send('browser:human-intervention', req);
    }
  });
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
  window.on('closed', () => {
    engineUpdater?.stop();
    browser.dispose();
    bridge?.stop();
    bridge = null;
    tasks.dispose();
    jobRunner?.stopScheduler();
    try { store?.close(); } catch {}
    manager = null;
    mainWindow = null;
  });
  window.once('ready-to-show', () => {
    if (!isHeadless) {
      window.show();
      window.focus();
    }
  });
  await window.loadFile(rendererPath);
  if (!isHeadless && !window.isVisible()) {
    window.show();
    window.focus();
  }
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
    const engineRoot = engineDirectory();
    engineUpdater = new EngineUpdater({
      directory: engineRoot, currentElectron: process.versions.electron, currentChromium: process.versions.chrome,
      supported: !app.isPackaged && process.platform === 'win32' && ['x64', 'arm64'].includes(process.arch),
      disabledByEnvironment: process.env.HERO_ENGINE_UPDATES === '0',
      latest: latestStable,
      prepare: (version, signal, progress) => prepareEngine(version, engineRoot, path.join(app.getAppPath(), 'scripts/engine-smoke.cjs'), signal, progress),
      publish: publishRuntime,
    });
    profiles = new ProfileManager(app.getPath('userData'));
    sessions = new SessionManager(profiles);
    tasks = new TaskManager(profiles);
    tasks.setChangeListener(publishRuntime);
    auditLogger = new AuditLogger(app.getPath('userData'));
    auditLogger.setActivityListener(event => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('browser:activity', event);
      }
    });
    await createWindow();
    engineUpdater.start();
    if (mainWindow) setupApplicationMenu(mainWindow, { manager: () => manager, engineUpdater: () => engineUpdater });
    store = new DataStore(app.getPath('userData'));
    analysis = new DataAnalysis(store);
    jobRunner = new JobRunner(store, manager!, tasks, profiles);
    recorder = new InteractionRecorder(store, manager!, profiles, jobRunner);
    jobRunner.setChangeListener(publishRuntime);
    bridge = new McpBridge({
      userDataDir: app.getPath('userData'),
      browser: manager!,
      profiles,
      tasks,
      sessions,
      auditLogger,
      engineUpdater,
      store,
      jobRunner,
      analysis,
      recorder,
      restartApp,
    });

    void bridge.start().then(res => {
      bridgePort = res.port;
      mcpStatus = 'ready';
      publishRuntime();
    }).catch(() => {
      mcpStatus = 'failed';
      publishRuntime();
    });
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
  }).catch(error => {
    dialog.showErrorBox('Hero tidak dapat dibuka', error instanceof Error ? error.message : 'Terjadi kesalahan saat membuka profil.');
    app.exit(1);
  });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
