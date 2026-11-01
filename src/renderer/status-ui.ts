import type { BrowserState } from '../shared/types.js';
import { app } from './app-state.js';
import { element, showError } from './dom.js';

/** Engine updater card and AI runtime status (MCP connection, recent tasks). */
export function renderStatus(state: BrowserState): void {
  if (state.engineUpdate) {
    const engine = state.engineUpdate;
    element('engine-versions').textContent = 'Chromium ' + engine.currentChromium + ' · Electron ' + engine.currentElectron;
    element<HTMLInputElement>('engine-auto').checked = engine.enabled;
    element<HTMLInputElement>('engine-auto').disabled = engine.status === 'unsupported';
    element('engine-update-message').textContent = engine.message + (engine.readyElectron ? ' Electron ' + engine.readyElectron + '.' : '');
    const busy = ['checking', 'downloading', 'verifying'].includes(engine.status);
    element<HTMLButtonElement>('engine-check').disabled = busy || engine.status === 'unsupported';
    const progress = element<HTMLProgressElement>('engine-update-progress');
    progress.hidden = !busy;
    if (engine.progress === null) progress.removeAttribute('value'); else progress.value = engine.progress;
  }

  const ready = state.mcpStatus === 'ready';
  element('mcp-status-badge').textContent = ready ? 'MCP AKTIF' : state.mcpStatus === 'failed' ? 'KONEKSI GAGAL' : 'MENGHUBUNGKAN';
  element('mcp-status-badge').classList.toggle('active', ready);
  element('runtime-title').textContent = ready ? 'Siap menerima tugas' : state.mcpStatus === 'failed' ? 'Buka ulang untuk mencoba koneksi' : 'Menyiapkan koneksi AI';
  const taskList = element('task-list');
  taskList.replaceChildren();
  const labels: Record<string, string> = { RUNNING: 'Berjalan', PAUSED: 'Dijeda', WAITING_FOR_HUMAN: 'Menunggu kamu', RESUMING: 'Melanjutkan', COMPLETED: 'Selesai', FAILED: 'Gagal', CANCELLED: 'Dibatalkan' };
  for (const task of [...(state.tasks || [])].reverse().slice(0, 10)) {
    const item = document.createElement('div');
    item.className = 'task-item';
    item.dataset.taskId = task.id;
    const name = state.profiles.find(profile => profile.id === task.profileId)?.name || task.profileId;
    item.textContent = name + ' · ' + (labels[task.status] || task.status);
    item.title = task.id;
    taskList.append(item);
  }
}

export function setupEngineControls(render: (state: BrowserState) => void): void {
  element('engine-check').addEventListener('click', () => {
    void window.browser.engineCommand('check').then(engineUpdate => { if (app.current) render({ ...app.current, engineUpdate }); }).catch(() => showError('Pembaruan belum dapat diperiksa.'));
  });
  element('engine-auto').addEventListener('change', () => {
    const action = element<HTMLInputElement>('engine-auto').checked ? 'enable' : 'disable';
    void window.browser.engineCommand(action).then(engineUpdate => { if (app.current) render({ ...app.current, engineUpdate }); }).catch(() => showError('Pengaturan pembaruan belum tersimpan.'));
  });
}
