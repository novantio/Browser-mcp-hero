import { randomUUID } from 'node:crypto';
import { BrowserWindow, WebContentsView, session } from 'electron';
import { isWebUrl, resolveAddress } from '../shared/navigation';
import type { BrowserCommand, BrowserState, BrowserTab, ViewBounds } from '../shared/types';

interface TabEntry { state: BrowserTab; view: WebContentsView | null }

export class BrowserManager {
  private readonly tabs = new Map<string, TabEntry>();
  private activeTabId = '';
  private bounds: ViewBounds = { x: 0, y: 124, width: 900, height: 600 };
  private readonly browserSession = session.fromPartition('hero-milestone-one');
  private disposed = false;

  constructor(private readonly window: BrowserWindow, private readonly publish: (state: BrowserState) => void) {
    this.browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    this.browserSession.setPermissionCheckHandler(() => false);
    this.browserSession.on('will-download', event => event.preventDefault());
    this.newTab();
  }

  snapshot(): BrowserState {
    return { tabs: [...this.tabs.values()].map(tab => ({ ...tab.state })), activeTabId: this.activeTabId };
  }

  private emit(): void {
    if (!this.disposed) this.publish(this.snapshot());
  }

  private active(): TabEntry {
    const tab = this.tabs.get(this.activeTabId);
    if (!tab) throw new Error('Tab tidak ditemukan.');
    return tab;
  }

  newTab(): void {
    if (this.tabs.size >= 30) throw new Error('Maksimal 30 tab. Tutup satu tab terlebih dahulu.');
    const id = randomUUID();
    this.tabs.set(id, { state: { id, title: 'Tab baru', url: '', loading: false, canGoBack: false, canGoForward: false, error: null }, view: null });
    this.activeTabId = id;
    this.layout();
    this.emit();
  }

  private createView(tab: TabEntry): WebContentsView {
    const view = new WebContentsView({ webPreferences: {
      session: this.browserSession, nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
      navigateOnDragDrop: false, spellcheck: true,
    } });
    tab.view = view;
    this.window.contentView.addChildView(view);
    view.setBackgroundColor('#ffffff');
    const contents = view.webContents;
    const update = () => {
      if (this.disposed || contents.isDestroyed() || !this.tabs.has(tab.state.id)) return;
      tab.state.loading = contents.isLoading();
      tab.state.canGoBack = contents.navigationHistory.canGoBack();
      tab.state.canGoForward = contents.navigationHistory.canGoForward();
      this.emit();
    };
    contents.on('did-start-loading', update);
    contents.on('did-stop-loading', update);
    contents.on('page-title-updated', (_event, title) => {
      tab.state.title = title.slice(0, 200) || 'Tanpa judul';
      update();
    });
    contents.on('did-start-navigation', (_event, url, _inPlace, isMainFrame) => {
      if (!isMainFrame || !isWebUrl(url)) return;
      tab.state.url = url;
      tab.state.error = null;
      this.layout();
      update();
    });
    contents.on('did-navigate', (_event, url) => { tab.state.url = url; update(); });
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) { tab.state.url = url; update(); }
    });
    contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      tab.state.error = `Halaman tidak dapat dimuat (kode ${code}). Periksa alamat dan koneksi, lalu coba lagi.`;
      tab.state.loading = false;
      this.layout();
      this.emit();
    });
    contents.on('render-process-gone', () => {
      tab.state.error = 'Halaman berhenti merespons. Muat ulang untuk melanjutkan.';
      tab.state.loading = false;
      this.layout();
      this.emit();
    });
    const guard = (event: Electron.Event, url: string) => {
      if (!isWebUrl(url)) event.preventDefault();
    };
    contents.on('will-navigate', guard);
    contents.on('will-redirect', guard);
    contents.on('will-frame-navigate', event => {
      if (!isWebUrl(event.url) && event.url !== 'about:blank') event.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url) && this.tabs.size < 30) {
        this.newTab();
        this.navigate(url);
      }
      return { action: 'deny' };
    });
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.alt && ['ArrowLeft', 'ArrowRight'].includes(input.key)) {
        event.preventDefault();
        this.execute({ action: input.key === 'ArrowLeft' ? 'back' : 'forward' });
        return;
      }
      if (!(input.control || input.meta)) return;
      const key = input.key.toLowerCase();
      if (['l', 't', 'w', 'r'].includes(key)) {
        event.preventDefault();
        if (key === 'l') this.focusAddress();
        if (key === 't' && this.tabs.size < 30) { this.newTab(); this.focusAddress(); }
        if (key === 'w') this.closeTab(tab.state.id);
        if (key === 'r') this.execute({ action: 'reload' });
      }
    });
    this.layout();
    return view;
  }

  private navigate(input: string): void {
    const url = resolveAddress(input);
    const tab = this.active();
    tab.state.url = url;
    tab.state.title = new URL(url).hostname;
    tab.state.error = null;
    tab.state.loading = true;
    const view = tab.view ?? this.createView(tab);
    this.layout();
    this.emit();
    // Load asynchronously so stop, tab switching and further navigation stay responsive.
    void view.webContents.loadURL(url).catch(() => { /* did-fail-load renders a safe error. */ });
  }

  private closeTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) throw new Error('Tab tidak ditemukan.');
    const ids = [...this.tabs.keys()];
    const index = ids.indexOf(id);
    this.tabs.delete(id);
    if (tab.view) {
      this.window.contentView.removeChildView(tab.view);
      tab.view.webContents.close();
    }
    if (!this.tabs.size) { this.newTab(); return; }
    if (this.activeTabId === id) this.activeTabId = ids[index + 1] ?? ids[index - 1] ?? [...this.tabs.keys()][0]!;
    this.layout();
    this.emit();
  }

  execute(command: BrowserCommand): void {
    switch (command.action) {
      case 'new-tab': this.newTab(); this.focusAddress(); return;
      case 'close-tab': this.closeTab(command.tabId); return;
      case 'switch-tab':
        if (!this.tabs.has(command.tabId)) throw new Error('Tab tidak ditemukan.');
        this.activeTabId = command.tabId;
        this.layout(); this.emit(); return;
      case 'navigate': this.navigate(command.input); return;
      case 'home': this.newTab(); this.focusAddress(); return;
    }
    const tab = this.active();
    const contents = tab.view?.webContents;
    if (!contents) return;
    if (command.action === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
    if (command.action === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
    if (command.action === 'reload') {
      tab.state.error = null;
      this.layout();
      contents.reload();
    }
    if (command.action === 'stop') contents.stop();
  }

  setBounds(bounds: ViewBounds): void { this.bounds = bounds; this.layout(); }

  layout(): void {
    const [width = 0, height = 0] = this.window.getContentSize();
    const x = Math.min(this.bounds.x, width);
    const y = Math.min(this.bounds.y, height);
    for (const [id, tab] of this.tabs) {
      if (!tab.view) continue;
      tab.view.setBounds({ x, y, width: Math.max(0, Math.min(this.bounds.width, width - x)), height: Math.max(0, Math.min(this.bounds.height, height - y)) });
      tab.view.setVisible(id === this.activeTabId && !tab.state.error);
    }
  }

  focusAddress(): void {
    this.window.webContents.focus();
    this.window.webContents.send('browser:focus-address');
  }

  dispose(): void {
    this.disposed = true;
    for (const tab of this.tabs.values()) {
      if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    this.tabs.clear();
  }
}
