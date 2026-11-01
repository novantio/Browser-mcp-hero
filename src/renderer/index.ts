import type { ActivityEvent, BrowserAPI, BrowserCommand, BrowserState } from '../shared/types.js';
import { setupDataWorkspace, refreshDataView } from './data-workspace.js';

declare global { interface Window { browser: BrowserAPI } }

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing element: ${id}`);
  return result as T;
}

const address = element<HTMLInputElement>('address');
const surface = element('browser-surface');
const tabs = element('tabs');
let current: BrowserState | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function showError(message: string): void {
  const toast = element('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 6000);
}

function showToast(message: string, durationMs = 3500): void {
  const toast = element('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, durationMs);
}

let profilePending = false;
function updateProfileControls(): void {
  element<HTMLSelectElement>('profile-select').disabled = profilePending;
  element<HTMLInputElement>('profile-name').disabled = profilePending;
  element<HTMLButtonElement>('create-profile').disabled = profilePending;
  element<HTMLButtonElement>('save-session').disabled = profilePending;
  const selected = current?.profiles.find(profile => profile.id === current?.activeProfileId);
  element<HTMLButtonElement>('delete-profile').disabled = profilePending || current?.activeProfileId === 'default' || Boolean(selected?.lockOwner) || Boolean(selected && !selected.sharedWith && selected.sharedProfiles.length > 1);

  element<HTMLButtonElement>('open-google').disabled = profilePending;
  element<HTMLButtonElement>('toggle-share').disabled = profilePending;
  element<HTMLButtonElement>('share-all').disabled = profilePending;
  const candidates = [...document.querySelectorAll<HTMLInputElement>('#share-targets input')];
  for (const checkbox of candidates) checkbox.disabled = profilePending || checkbox.dataset.shared === 'true';
  element<HTMLButtonElement>('apply-share').disabled = profilePending || !candidates.some(input => input.checked && input.dataset.shared !== 'true');
  element<HTMLButtonElement>('stop-sharing').disabled = profilePending || Boolean(selected?.lockOwner);
  element('stop-sharing').hidden = !selected || selected.sharedProfiles.length <= 1;

}
async function command(value: BrowserCommand): Promise<boolean> {
  const changesProfile = ['create-profile', 'switch-profile', 'delete-profile', 'save-session', 'share-session', 'stop-sharing', 'open-google'].includes(value.action);
  if (changesProfile && profilePending) return false;
  if (changesProfile) {
    profilePending = true;
    updateProfileControls();
    element('profile-feedback').hidden = true;
  }
  if (value.action === 'save-session') element('storage-feedback').textContent = 'Menyimpan…';
  try {
    const result = await window.browser.command(value);
    if (!result.ok) {
      if (changesProfile) {
        element('profile-feedback').textContent = result.error;
        element('profile-feedback').hidden = false;
      } else showError(result.error);
    }
    if (value.action === 'save-session') element('storage-feedback').textContent = result.ok ? 'Tersimpan di perangkat' : 'Penyimpanan belum selesai.';
    return result.ok;
  } catch {
    showError('Koneksi ke browser terputus. Buka ulang Hero.');
    return false;
  } finally {
    if (changesProfile) {
      profilePending = false;
      updateProfileControls();
      // Restore the actual selection if a switch or deletion was rejected.
      if (current) element<HTMLSelectElement>('profile-select').value = current.activeProfileId;
    }
  }
}

function reportBounds(): void {
  const rect = surface.getBoundingClientRect();
  void window.browser.setBounds({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }).catch(() => showError('Area browser tidak dapat diperbarui.'));
}

function render(state: BrowserState): void {
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

  const previousId = current?.activeTabId;
  const previousProfileId = current?.activeProfileId;
  current = state;
  const profileSelect = element<HTMLSelectElement>('profile-select');
  const optionKey = state.profiles.map(profile => profile.id + ':' + profile.name + ':' + (profile.loggedInServices || []).join(',')).join('|');
  if (profileSelect.dataset.options !== optionKey) {
    profileSelect.replaceChildren(...state.profiles.map(profile => {
      const option = document.createElement('option');
      option.value = profile.id;
      const services = profile.loggedInServices && profile.loggedInServices.length
        ? ` [${profile.loggedInServices.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(', ')}]`
        : '';
      option.textContent = profile.name + services;
      return option;
    }));
    profileSelect.dataset.options = optionKey;
  }

  profileSelect.value = state.activeProfileId;
  const profile = state.profiles.find(profile => profile.id === state.activeProfileId);
  element('active-profile-name').textContent = profile?.name ?? 'Profil';
  element('profile-control').textContent = profile?.lockOwner ? 'Dikunci tugas AI' : 'Manual';

  const sessionOwner = state.profiles.find(item => item.id === profile?.sessionProfileId);
  element('sharing-status').textContent = profile && profile.sharedProfiles.length > 1
    ? 'Sesi ' + (sessionOwner?.name ?? '') + ' · ' + profile.sharedProfiles.length + ' profil'
    : 'Sesi pribadi';
  element('session-description').textContent = profile && profile.sharedProfiles.length > 1 ? 'Login digunakan bersama' : 'Login dan data terpisah';
  const targets = element('share-targets');
  const targetKey = JSON.stringify([state.activeProfileId, state.profiles.map(p => [p.id, p.name, p.sessionProfileId])]);
  if (targets.dataset.key !== targetKey) {
    targets.replaceChildren(...state.profiles.filter(p => p.id !== state.activeProfileId).map(p => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = p.id;
      checkbox.checked = p.sessionProfileId === profile?.sessionProfileId;
      checkbox.dataset.shared = String(checkbox.checked);
      checkbox.disabled = checkbox.checked;
      checkbox.addEventListener('change', updateProfileControls);
      const text = document.createElement('span');
      text.textContent = p.name;
      label.append(checkbox, text);
      return label;
    }));
    targets.dataset.key = targetKey;
  }
  if (previousProfileId && previousProfileId !== state.activeProfileId) {
    element('share-options').hidden = true;
    element('toggle-share').setAttribute('aria-expanded', 'false');
  }

  updateProfileControls();

  const active = state.tabs.find(tab => tab.id === state.activeTabId);
  if (!active) return;
  // Keep existing tab buttons while loading events arrive, preserving focus and clicks.
  const ids = new Set(state.tabs.map(tab => tab.id));
  for (const child of [...tabs.children]) if (!ids.has((child as HTMLElement).dataset.id ?? '')) child.remove();
  for (const tab of state.tabs) {
    let item = [...tabs.children].find(child => (child as HTMLElement).dataset.id === tab.id) as HTMLElement | undefined;
    if (!item) {
      item = document.createElement('div');
      item.className = 'tab';
      item.dataset.id = tab.id;
      const select = document.createElement('button');
      select.className = 'tab-select';
      select.role = 'tab';
      const glyph = document.createElement('span');
      glyph.className = 'tab-glyph';
      glyph.setAttribute('aria-hidden', 'true');
      const title = document.createElement('span');
      title.className = 'tab-title';
      select.append(glyph, title);
      select.addEventListener('click', () => { void command({ action: 'switch-tab', tabId: tab.id }); });
      const close = document.createElement('button');
      close.className = 'tab-close';
      close.textContent = '×';
      close.addEventListener('click', () => { void command({ action: 'close-tab', tabId: tab.id }); });
      item.append(select, close);
      tabs.append(item);
    }
    const selected = tab.id === state.activeTabId;
    item.classList.toggle('active', selected);
    const select = item.querySelector<HTMLButtonElement>('.tab-select')!;
    select.setAttribute('aria-selected', String(selected));
    select.title = tab.title;
    item.querySelector('.tab-title')!.textContent = tab.title;
    item.querySelector('.tab-glyph')!.textContent = tab.loading ? '◌' : tab.url ? '◉' : '⌂';
    item.querySelector('.tab-close')!.setAttribute('aria-label', `Tutup ${tab.title}`);
    if (selected && previousId !== state.activeTabId) item.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  if (document.activeElement !== address || previousId !== state.activeTabId) address.value = active.url;
  element<HTMLButtonElement>('back').disabled = !active.canGoBack;
  element<HTMLButtonElement>('forward').disabled = !active.canGoForward;
  element<HTMLButtonElement>('reload').disabled = !active.url;
  element('reload').textContent = active.loading ? '×' : '↻';
  element('reload').setAttribute('aria-label', active.loading ? 'Hentikan pemuatan' : 'Muat ulang');
  element('welcome').hidden = Boolean(active.url);
  const certWarning = active.certificateWarning ?? null;
  element('cert-warning').hidden = !certWarning;
  if (certWarning) element('cert-host').textContent = certWarning.host;
  element('page-error').hidden = !active.error || Boolean(certWarning);
  element('page-error-message').textContent = active.error ?? '';
  element('loading-line').hidden = !active.loading;
  element('tab-count').textContent = String(state.tabs.length);
  element('page-status').textContent = certWarning ? 'Sertifikat tidak valid' : active.error ? 'Halaman gagal dimuat' : active.loading ? 'Memuat halaman…' : active.url || 'Tab baru';
  element('address-icon').textContent = active.url.startsWith('https:') ? '◇' : active.url ? 'ⓘ' : '⌕';
  reportBounds();
}

element('new-tab').addEventListener('click', () => { void command({ action: 'new-tab' }); });
element('back').addEventListener('click', () => { void command({ action: 'back' }); });
element('forward').addEventListener('click', () => { void command({ action: 'forward' }); });
element('reload').addEventListener('click', () => {
  const active = current?.tabs.find(tab => tab.id === current?.activeTabId);
  void command({ action: active?.loading ? 'stop' : 'reload' });
});
element('retry').addEventListener('click', () => { void command({ action: 'reload' }); });
element('cert-proceed').addEventListener('click', () => { void command({ action: 'certificate-response', allow: true }); });
element('cert-safe').addEventListener('click', () => { void command({ action: 'certificate-response', allow: false }); });
element('address-form').addEventListener('submit', event => {
  event.preventDefault();
  address.blur();
  void command({ action: 'navigate', input: address.value });
});
element('search-form').addEventListener('submit', event => {
  event.preventDefault();
  void command({ action: 'navigate', input: element<HTMLInputElement>('search').value });
});
document.querySelectorAll<HTMLButtonElement>('[data-url]').forEach(button => {
  button.addEventListener('click', () => { void command({ action: 'navigate', input: button.dataset.url! }); });
});
element('toggle-panel').addEventListener('click', () => {
  const panel = element('side-panel');
  panel.hidden = !panel.hidden;
  element('toggle-panel').setAttribute('aria-expanded', String(!panel.hidden));
  reportBounds();
});
function focusAddress(): void { address.focus(); address.select(); }
address.addEventListener('focus', () => address.select());
document.addEventListener('keydown', event => {
  const modifier = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (modifier && ['l', 't', 'w', 'r'].includes(key)) {
    event.preventDefault();
    if (key === 'l') focusAddress();
    if (key === 't') void command({ action: 'new-tab' });
    if (key === 'w' && current) void command({ action: 'close-tab', tabId: current.activeTabId });
    if (key === 'r') void command({ action: 'reload' });
  }
  if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    void command({ action: event.key === 'ArrowLeft' ? 'back' : 'forward' });
  }
});

element('profile-select').addEventListener('change', () => {
  element('storage-feedback').textContent = 'Data situs disimpan di perangkat.';
  void command({ action: 'switch-profile', profileId: element<HTMLSelectElement>('profile-select').value });
});
element('profile-form').addEventListener('submit', event => {
  event.preventDefault();
  void command({ action: 'create-profile', name: element<HTMLInputElement>('profile-name').value }).then(ok => {
    if (ok) element<HTMLInputElement>('profile-name').value = '';
  });
});
element('delete-profile').addEventListener('click', () => {
  if (current) void command({ action: 'delete-profile', profileId: current.activeProfileId });
});
element('save-session').addEventListener('click', () => { void command({ action: 'save-session' }); });

element('open-google').addEventListener('click', () => { void command({ action: 'open-google' }); });
element('toggle-share').addEventListener('click', () => {
  const options = element('share-options');
  options.hidden = !options.hidden;
  element('toggle-share').setAttribute('aria-expanded', String(!options.hidden));
});
element('share-all').addEventListener('click', () => {
  document.querySelectorAll<HTMLInputElement>('#share-targets input').forEach(input => { if (!input.disabled) input.checked = true; });
  updateProfileControls();
});
element('apply-share').addEventListener('click', () => {
  const targetIds = [...document.querySelectorAll<HTMLInputElement>('#share-targets input')].filter(input => input.checked && !input.disabled).map(input => input.value);
  void command({ action: 'share-session', targetIds });
});
element('stop-sharing').addEventListener('click', () => { void command({ action: 'stop-sharing' }); });

let activeInterventionTaskId: string | null = null;
const banner = document.getElementById('intervention-banner') as HTMLDivElement | null;
const bannerTitle = document.getElementById('intervention-title') as HTMLElement | null;
const bannerMessage = document.getElementById('intervention-message') as HTMLElement | null;
const bannerButton = document.getElementById('intervention-resume') as HTMLButtonElement | null;

if (banner && bannerButton) {
  bannerButton.addEventListener('click', () => {
    if (activeInterventionTaskId) {
      void command({ action: 'resume-human-intervention', taskId: activeInterventionTaskId });
    }
  });

  window.browser.onHumanIntervention(req => {
    if (req) {
      activeInterventionTaskId = req.taskId;
      const isCaptcha = (req.reason || '').toLowerCase().includes('captcha') || (req.message || '').toLowerCase().includes('captcha');
      const icon = banner.querySelector('.intervention-icon') as HTMLElement | null;
      if (icon) icon.textContent = isCaptcha ? '🧩' : '🤖';
      if (bannerTitle) bannerTitle.textContent = req.reason || 'Tindakan Manusia Diperlukan';
      if (bannerMessage) bannerMessage.textContent = req.message || 'Selesaikan tindakan di browser lalu klik tombol lanjutkan.';
      banner.hidden = false;
    } else {
      activeInterventionTaskId = null;
      banner.hidden = true;
    }
    reportBounds();
  });

}

new ResizeObserver(reportBounds).observe(surface);
window.browser.onState(render);
window.browser.onFocusAddress(focusAddress);

let activityCount = 0;
const activityList = document.getElementById('activity-list');
const activityCounter = document.getElementById('activity-counter');

function formatActionTag(action: string): string {
  if (action === 'tabs.navigate') return 'NAV';
  if (action === 'tabs.new') return 'TAB+';
  if (action === 'tabs.close') return 'TAB-';
  if (action === 'automation.click') return 'CLICK';
  if (action === 'automation.type') return 'TYPE';
  if (action === 'automation.getDOM') return 'DOM';
  if (action === 'automation.extract') return 'EXTRACT';
  if (action === 'automation.screenshot') return 'SHOT';
  if (action === 'tasks.requestIntervention') return 'HUMAN';
  if (action === 'tasks.resumeIntervention') return 'RESUME';
  return action.split('.').pop()?.toUpperCase() || 'ACT';
}

if (activityList && window.browser.onActivity) {
  window.browser.onActivity((event: ActivityEvent) => {
    activityCount++;
    if (activityCounter) activityCounter.textContent = `${activityCount} aksi`;
    const emptyEl = activityList.querySelector('.activity-empty');
    if (emptyEl) emptyEl.remove();

    const item = document.createElement('div');
    item.className = `activity-item status-${event.status}`;

    const top = document.createElement('div');
    top.className = 'activity-item-top';

    const tag = document.createElement('span');
    tag.className = 'activity-tag';
    tag.textContent = formatActionTag(event.action);

    const time = document.createElement('span');
    time.className = 'activity-time';
    const date = new Date(event.timestamp);
    time.textContent = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;

    top.append(tag, time);

    const summary = document.createElement('div');
    summary.className = 'activity-summary';
    summary.textContent = event.summary;

    item.append(top, summary);
    activityList.prepend(item);

    while (activityList.children.length > 25) {
      activityList.lastElementChild?.remove();
    }
  });
}

setupDataWorkspace();
setupMcpConfigModal();
void window.browser.getState().then(state => {
  if (!current) render(state);
  void refreshDataView();
}).catch(() => showError('Browser tidak dapat dimulai. Buka ulang aplikasi.'));

function setupMcpConfigModal(): void {
  const modal = element('mcp-modal');
  const codeDisplay = element('mcp-code-display');

  const btnOpenMenu = document.getElementById('btn-mcp-menu') as HTMLElement | null;
  const btnOpenSide = document.getElementById('btn-open-mcp-modal') as HTMLElement | null;
  const btnClose = document.getElementById('close-mcp-modal') as HTMLElement | null;
  const btnDone = document.getElementById('btn-done-mcp-modal') as HTMLElement | null;
  const codeFilename = document.getElementById('mcp-config-filename') as HTMLElement | null;
  const configLocation = document.getElementById('mcp-config-location') as HTMLElement | null;
  const btnCopy = document.getElementById('btn-copy-mcp-config') as HTMLButtonElement | null;
  const copyText = document.getElementById('copy-text') as HTMLElement | null;
  const copyIcon = document.getElementById('copy-icon') as HTMLElement | null;

  const tabClaude = document.getElementById('tab-client-claude') as HTMLElement | null;
  const tabAntigravity = document.getElementById('tab-client-antigravity') as HTMLElement | null;
  const tabCli = document.getElementById('tab-client-cli') as HTMLElement | null;

  type ClientMode = 'claude' | 'antigravity' | 'cli';
  let activeMode: ClientMode = 'claude';
  let mcpConfigData: any = null;

  const defaultClaude = {
    mcpServers: {
      'hero-browser': {
        command: 'node',
        args: ['D:/project/node/2026/Browser-mcp-hero/dist/mcp/index.js'],
      },
    },
  };

  const defaultAntigravity = {
    'hero-browser': {
      command: 'node',
      args: ['D:/project/node/2026/Browser-mcp-hero/dist/mcp/index.js'],
    },
  };

  function updateDisplay(): void {
    if (!codeDisplay) return;
    if (activeMode === 'claude') {
      const cfg = mcpConfigData?.claudeDesktopConfig || defaultClaude;
      codeDisplay.textContent = JSON.stringify(cfg, null, 2);
      if (codeFilename) codeFilename.textContent = 'claude_desktop_config.json / .cursor/mcp.json';
      if (configLocation) configLocation.textContent = '%APPDATA%\\Claude\\claude_desktop_config.json  |  .cursor/mcp.json';
    } else if (activeMode === 'antigravity') {
      const cfg = mcpConfigData?.geminiAntigravityConfig || defaultAntigravity;
      codeDisplay.textContent = JSON.stringify(cfg, null, 2);
      if (codeFilename) codeFilename.textContent = 'mcp_config.json (Antigravity IDE / Gemini CLI)';
      if (configLocation) configLocation.textContent = '~/.gemini/antigravity-ide/mcp_config.json';
    } else {
      const script = mcpConfigData?.mcpScriptPath || 'D:/project/node/2026/Browser-mcp-hero/dist/mcp/index.js';
      codeDisplay.textContent = `node "${script}"`;
      if (codeFilename) codeFilename.textContent = 'Command CLI';
      if (configLocation) configLocation.textContent = 'Jalankan langsung di terminal atau subproses AI Agent';
    }

    tabClaude?.classList.toggle('active', activeMode === 'claude');
    tabAntigravity?.classList.toggle('active', activeMode === 'antigravity');
    tabCli?.classList.toggle('active', activeMode === 'cli');
  }

  async function openModal(): Promise<void> {
    try {
      if (window.browser.getMcpConfig) {
        mcpConfigData = await window.browser.getMcpConfig();
      }
    } catch {}
    updateDisplay();
    modal.hidden = false;
  }

  function closeModal(): void {
    modal.hidden = true;
  }

  btnOpenMenu?.addEventListener('click', openModal);
  btnOpenSide?.addEventListener('click', openModal);
  btnClose?.addEventListener('click', closeModal);
  btnDone?.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) {
      closeModal();
    }
  });

  if (window.browser.onOpenMcpModal) {
    window.browser.onOpenMcpModal(() => {
      void openModal();
    });
  }

  tabClaude?.addEventListener('click', () => {
    activeMode = 'claude';
    updateDisplay();
  });
  tabAntigravity?.addEventListener('click', () => {
    activeMode = 'antigravity';
    updateDisplay();
  });
  tabCli?.addEventListener('click', () => {
    activeMode = 'cli';
    updateDisplay();
  });

  btnCopy?.addEventListener('click', async () => {
    const textToCopy = codeDisplay.textContent || '';
    try {
      if (window.browser.copyToClipboard) {
        await window.browser.copyToClipboard(textToCopy);
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(textToCopy);
      }
    } catch {
      try {
        await navigator.clipboard.writeText(textToCopy);
      } catch {}
    }

    if (btnCopy && copyText && copyIcon) {
      btnCopy.classList.add('copied');
      copyText.textContent = 'Tersalin!';
      copyIcon.textContent = '✓';
      showToast('Konfigurasi MCP berhasil disalin ke clipboard!');
      setTimeout(() => {
        btnCopy.classList.remove('copied');
        copyText.textContent = 'Salin JSON';
        copyIcon.textContent = '📋';
      }, 2500);
    }
  });
}


element('engine-check').addEventListener('click', () => {
  void window.browser.engineCommand('check').then(engineUpdate => { if (current) render({ ...current, engineUpdate }); }).catch(() => showError('Pembaruan belum dapat diperiksa.'));
});
element('engine-auto').addEventListener('change', () => {
  const action = element<HTMLInputElement>('engine-auto').checked ? 'enable' : 'disable';
  void window.browser.engineCommand(action).then(engineUpdate => { if (current) render({ ...current, engineUpdate }); }).catch(() => showError('Pengaturan pembaruan belum tersimpan.'));
});
