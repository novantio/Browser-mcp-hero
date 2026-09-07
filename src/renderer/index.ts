import type { BrowserAPI, BrowserCommand, BrowserState } from '../shared/types.js';

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

async function command(value: BrowserCommand): Promise<void> {
  try {
    const result = await window.browser.command(value);
    if (!result.ok) showError(result.error);
  } catch { showError('Koneksi ke browser terputus. Buka ulang Hero.'); }
}

function reportBounds(): void {
  const rect = surface.getBoundingClientRect();
  void window.browser.setBounds({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }).catch(() => showError('Area browser tidak dapat diperbarui.'));
}

function render(state: BrowserState): void {
  const previousId = current?.activeTabId;
  current = state;
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
  element('page-error').hidden = !active.error;
  element('page-error-message').textContent = active.error ?? '';
  element('loading-line').hidden = !active.loading;
  element('tab-count').textContent = String(state.tabs.length);
  element('page-status').textContent = active.error ? 'Halaman gagal dimuat' : active.loading ? 'Memuat halaman…' : active.url || 'Tab baru';
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
new ResizeObserver(reportBounds).observe(surface);
window.browser.onState(render);
window.browser.onFocusAddress(focusAddress);
void window.browser.getState().then(state => { if (!current) render(state); }).catch(() => showError('Browser tidak dapat dimulai. Buka ulang aplikasi.'));
