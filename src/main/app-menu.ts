import { Menu, clipboard } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'node:path';
import type { BrowserManager } from './browser-manager';
import type { EngineUpdater } from './engine-updater';

/** Application menu. Accelerators here also work while a web page has keyboard focus. */
export function setupApplicationMenu(window: BrowserWindow, deps: { manager: () => BrowserManager | null; engineUpdater: () => EngineUpdater | undefined }): void {
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
        { label: 'Periksa Pembaruan Engine', click: () => { void deps.engineUpdater()?.check(); } },
        { type: 'separator' },
        { role: 'quit', label: 'Keluar Hero Browser' },
      ],
    },
    {
      label: 'Tampilan',
      submenu: [
        { label: 'Tampilkan/Sembunyikan Panel Samping', accelerator: 'CmdOrCtrl+Shift+B', click: () => window.webContents.send('browser:menu-action', 'toggle-panel') },
        { label: 'Kelola Profil…', accelerator: 'CmdOrCtrl+Shift+P', click: () => window.webContents.send('browser:menu-action', 'manage-profiles') },
      ],
    },
    {
      label: 'Navigasi',
      submenu: [
        { label: 'Tab Baru', accelerator: 'CmdOrCtrl+T', click: () => deps.manager()?.newTab() },
        { label: 'Pilih Alamat', accelerator: 'CmdOrCtrl+L', click: () => deps.manager()?.focusAddress() },
        { label: 'Muat Ulang', accelerator: 'CmdOrCtrl+R', click: () => deps.manager()?.execute({ action: 'reload' }) },
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
