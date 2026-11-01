import type { BrowserState } from '../shared/types.js';
import { app, command, reportBounds } from './app-state.js';
import { element } from './dom.js';

const address = (): HTMLInputElement => element<HTMLInputElement>('address');

/** Tab strip, toolbar buttons and page status for the active tab. */
export function renderTabs(state: BrowserState, previousId: string | undefined): void {
  const tabs = element('tabs');
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
  if (document.activeElement !== address() || previousId !== state.activeTabId) address().value = active.url;
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

export function focusAddress(): void { address().focus(); address().select(); }

export function setupNavigation(onPanelShortcut: () => void): void {
  element('new-tab').addEventListener('click', () => { void command({ action: 'new-tab' }); });
  element('back').addEventListener('click', () => { void command({ action: 'back' }); });
  element('forward').addEventListener('click', () => { void command({ action: 'forward' }); });
  element('reload').addEventListener('click', () => {
    const active = app.current?.tabs.find(tab => tab.id === app.current?.activeTabId);
    void command({ action: active?.loading ? 'stop' : 'reload' });
  });
  element('retry').addEventListener('click', () => { void command({ action: 'reload' }); });
  element('cert-proceed').addEventListener('click', () => { void command({ action: 'certificate-response', allow: true }); });
  element('cert-safe').addEventListener('click', () => { void command({ action: 'certificate-response', allow: false }); });
  element('address-form').addEventListener('submit', event => {
    event.preventDefault();
    address().blur();
    void command({ action: 'navigate', input: address().value });
  });
  element('search-form').addEventListener('submit', event => {
    event.preventDefault();
    void command({ action: 'navigate', input: element<HTMLInputElement>('search').value });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-url]').forEach(button => {
    button.addEventListener('click', () => { void command({ action: 'navigate', input: button.dataset.url! }); });
  });
  address().addEventListener('focus', () => address().select());
  // Only fires while the app UI has focus; the menu accelerators cover a focused web page.
  document.addEventListener('keydown', event => {
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (modifier && event.shiftKey && key === 'b') { event.preventDefault(); onPanelShortcut(); return; }
    if (modifier && ['l', 't', 'w', 'r'].includes(key)) {
      event.preventDefault();
      if (key === 'l') focusAddress();
      if (key === 't') void command({ action: 'new-tab' });
      if (key === 'w' && app.current) void command({ action: 'close-tab', tabId: app.current.activeTabId });
      if (key === 'r') void command({ action: 'reload' });
    }
    if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      void command({ action: event.key === 'ArrowLeft' ? 'back' : 'forward' });
    }
  });
}
