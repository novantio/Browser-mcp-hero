import { app, BrowserWindow, dialog, ipcMain, Menu, clipboard } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserManager } from './browser-manager';
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
let tasks: TaskManager;
let auditLogger: AuditLogger;
let bridge: McpBridge | null = null;
let bridgePort: number | null = null;
let store: DataStore;
let analysis: DataAnalysis;
let jobRunner: JobRunner;
let recorder: InteractionRecorder;
let commandBusy = false;
let mcpStatus: "starting" | "ready" | "failed" = "starting";

function setupApplicationMenu(window: BrowserWindow): void {
  const mcpScriptPath = path.resolve(__dirname, '../mcp/index.js').replace(/\\/g, '/');
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Hero Browser',
      submenu: [
        {
          label: 'Integrasi MCP & AI Agent...',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => {
            window.webContents.send('browser:open-mcp-modal');
          },
        },
        {
          label: 'Salin Konfigurasi MCP (Claude / Cursor)',
          click: () => {
            const cfg = JSON.stringify({
              mcpServers: {
                'hero-browser': {
                  command: 'node',
                  args: [mcpScriptPath],
                },
              },
            }, null, 2);
            clipboard.writeText(cfg);
            window.webContents.send('browser:activity', {
              id: 'menu-copy-' + Date.now(),
              timestamp: Date.now(),
              action: 'mcp.copyConfig',
              summary: 'Konfigurasi MCP disalin ke clipboard',
              status: 'success',
            });
          },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Keluar Hero Browser' },
      ],
    },
    {
      label: 'Navigasi',
      submenu: [
        { label: 'Tab Baru', accelerator: 'CmdOrCtrl+T', click: () => manager?.newTab() },
        { label: 'Pilih Alamat', accelerator: 'CmdOrCtrl+L', click: () => manager?.focusAddress() },
        { label: 'Muat Ulang', accelerator: 'CmdOrCtrl+R', click: () => manager?.execute({ action: 'reload' }) },
      ],
    },
    {
      label: 'Integrasi AI',
      submenu: [
        {
          label: 'Buka Pengaturan MCP...',
          accelerator: 'F1',
          click: () => {
            window.webContents.send('browser:open-mcp-modal');
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
const runtimeState = (browser: BrowserManager) => ({
  ...browser.snapshot(),
  tasks: tasks.listTasks(),
  mcpStatus,
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

async function handleCommand(browser: BrowserManager, command: BrowserCommand): Promise<void> {

  if (command.action === 'open-google') {
    browser.newTab();
    browser.execute({ action: 'navigate', input: 'https://mail.google.com/' });
    return;
  }
  if (command.action === 'share-session') {
    const plan = profiles.planShareSession(profiles.activeProfileId, command.targetIds);
    const source = profiles.requireProfile(plan.sourceId);
    const names = plan.targetIds.map(id => profiles.requireProfile(id).name).join(', ');
    const result = await dialog.showMessageBox(mainWindow!, {
      type: 'question', title: 'Share sesi', message: 'Gunakan sesi “' + source.name + '” bersama?',
      detail: 'Profil tujuan: ' + names + '.\n\nSemua login situs dan perubahan logout akan digunakan bersama. Tab tujuan ditutup; simpan pekerjaan terlebih dahulu. Sesi pribadi tujuan tetap tersimpan dan bisa dipakai kembali setelah berbagi dihentikan.',
      buttons: ['Batal', 'Share sesi'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (result.response === 1) await browser.changeSharedSession(() => profiles.shareSession(plan.sourceId, plan.targetIds));
    return;
  }
  if (command.action === 'stop-sharing') {
    const changed = profiles.planStopSharing(profiles.activeProfileId);
    if (!changed.length) throw new Error('Profil ini belum berbagi sesi.');
    const names = changed.map(id => profiles.requireProfile(id).name).join(', ');
    const result = await dialog.showMessageBox(mainWindow!, {
      type: 'question', title: 'Hentikan berbagi', message: 'Kembali memakai sesi pribadi?',
      detail: 'Profil: ' + names + '. Tab profil ini akan ditutup. Sesi pribadi sebelumnya akan digunakan kembali; login dari sesi bersama tidak disalin.',
      buttons: ['Batal', 'Hentikan berbagi'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (result.response === 1) await browser.changeSharedSession(() => profiles.stopSharing(profiles.activeProfileId));
    return;
  }

  if (command.action === 'resume-human-intervention') {
    tasks.resumeHumanIntervention(command.taskId);
    return;
  }
  if (command.action === 'create-profile') { browser.createProfile(command.name); return; }
  if (command.action === 'switch-profile') { browser.switchProfile(command.profileId); return; }
  if (command.action === 'save-session') { await sessions.flush(); return; }
  if (command.action === 'delete-profile') {
    profiles.assertDeletable(command.profileId);
    const profile = profiles.requireProfile(command.profileId);
    const result = await dialog.showMessageBox(mainWindow!, {
      type: 'warning', title: 'Hapus profil', message: 'Hapus profil “' + profile.name + '”?',
      detail: profile.sharedWith ? 'Tab dan sesi pribadi profil ini akan dihapus. Sesi bersama milik profil sumber tetap tersedia.' : 'Semua tab, login, cookie, dan data situs di profil ini akan dihapus dari perangkat. Profil lain tetap tersedia.',
      buttons: ['Batal', 'Hapus profil'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (result.response === 1) await browser.deleteProfile(command.profileId);
    return;
  }
  browser.execute(command);
}

ipcMain.handle('browser:state', event => runtimeState(requireTrustedSender(event)));
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

ipcMain.handle('data:overview', event => {
  requireTrustedSender(event);
  return jobRunner?.overview() ?? {};
});
ipcMain.handle('data:jobs', event => {
  requireTrustedSender(event);
  return jobRunner?.listJobs() ?? [];
});
ipcMain.handle('data:datasets', event => {
  requireTrustedSender(event);
  return analysis ? store.list('dataset').map((d: any) => analysis.summary(d)) : [];
});
ipcMain.handle('data:recordings', event => {
  requireTrustedSender(event);
  return recorder?.list() ?? [];
});
ipcMain.handle('data:command', async (event, value: unknown) => {
  requireTrustedSender(event);
  if (!value || typeof value !== 'object') return { ok: false, error: 'Perintah tidak valid.' };
  const { action, payload } = value as { action: string; payload: any };
  try {
    switch (action) {
      case 'job-run': return { ok: true, result: await jobRunner.runJob(String(payload.jobId)) };
      case 'job-pause': return { ok: true, result: jobRunner.pauseJob(String(payload.jobId)) };
      case 'job-resume': return { ok: true, result: await jobRunner.resumeJob(String(payload.jobId)) };
      case 'job-cancel': return { ok: true, result: jobRunner.cancelJob(String(payload.jobId)) };
      case 'job-create': return { ok: true, result: jobRunner.createJob(payload) };
      case 'record-start': return { ok: true, result: await recorder.start(String(payload?.name || 'Sesi')) };
      case 'record-stop': return { ok: true, result: await recorder.stop() };
      case 'record-convert': return { ok: true, result: recorder.convert(String(payload.recordingId), payload.schema, String(payload.name), (payload.intervalMinutes as number | null) ?? null) };
      case 'dataset-build': return { ok: true, result: analysis.build(payload) };
      case 'dataset-export': return { ok: true, result: await analysis.export(String(payload.datasetId), payload.format) };
      case 'search': return { ok: true, result: store.records(payload) };
      case 'network-requests': return { ok: true, result: jobRunner.network.getRequests(payload?.filter, payload?.limit) };
      case 'review-list': return { ok: true, result: jobRunner.reviewQueue.listItems(payload?.status, payload?.limit) };
      case 'review-resolve': return { ok: true, result: jobRunner.reviewQueue.resolveItem(String(payload.reviewId), payload.resolution, payload.editedData) };
      case 'frontier-push': return { ok: true, result: jobRunner.frontier.push(payload.urls, payload.depth, payload.priority) };
      case 'frontier-stats': return { ok: true, result: jobRunner.frontier.getStats() };
      case 'copilot-synthesize': return { ok: true, result: await jobRunner.copilot.synthesize(manager!.getActiveWebContents(), String(payload.targetUrl), payload.goalContract) };
      case 'lineage': return { ok: true, result: store.getLineage(String(payload.recordId)) };
      default: return { ok: false, error: 'Aksi data tidak dikenal.' };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Operasi data gagal.' };
  }
});

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440, height: 940, minWidth: 900, minHeight: 620,
    title: 'Hero Browser — Profil persisten', backgroundColor: '#111a2b', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  mainWindow = window;
  const browser = new BrowserManager(window, state => {
    if (!window.isDestroyed()) window.webContents.send('browser:state-changed', { ...state, tasks: tasks.listTasks(), mcpStatus });
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
    window.show();
    window.focus();
  });
  await window.loadFile(rendererPath);
  if (!window.isVisible()) {
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
    if (mainWindow) setupApplicationMenu(mainWindow);
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
      auditLogger,
      store,
      jobRunner,
      analysis,
      recorder,
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
