import { RpcError } from '../shared/rpc-error';
import { setTimeout as delay } from 'node:timers/promises';
import { readSafePage } from './page-snapshot';
import { randomUUID } from 'node:crypto';
import { BrowserWindow, WebContentsView } from 'electron';
import { ProfileManager } from './profile-manager';
import { SessionManager } from './session-manager';
import { isPopupWindow, isWebUrl, resolveAddress } from '../shared/navigation';
import type { BrowserCommand, BrowserState, BrowserTab, ViewBounds } from '../shared/types';
import type { ExtractionSpec, Json } from '../shared/data-contracts';
import { convert, setPath } from './data/processing';
import type { NetworkIntelligence } from './data/network-intelligence';

interface TabEntry { state: BrowserTab; view: WebContentsView | null; profileId: string }

export class BrowserManager {
  private readonly tabs = new Map<string, TabEntry>();
  private readonly popups = new Map<string, Set<BrowserWindow>>();
  private activeTabId = '';
  private bounds: ViewBounds = { x: 0, y: 124, width: 900, height: 600 };
  private readonly activeTabs = new Map<string, string>();
  private disposed = false;
  private network: NetworkIntelligence | null = null;

  constructor(private readonly window: BrowserWindow, private readonly publish: (state: BrowserState) => void,
      private readonly profiles: ProfileManager, private readonly sessions: SessionManager) {
    this.newTab();
  }

  setNetworkIntelligence(net: NetworkIntelligence): void {
    this.network = net;
    for (const tab of this.tabs.values()) {
      if (tab.view && !tab.view.webContents.isDestroyed()) {
        this.network.attach(tab.view.webContents);
      }
    }
  }

  snapshot(): BrowserState {
    return {
      tabs: [...this.tabs.values()].filter(tab => tab.profileId === this.profiles.activeProfileId).map(tab => ({ ...tab.state })),
      activeTabId: this.activeTabId, profiles: this.profiles.listProfiles(), activeProfileId: this.profiles.activeProfileId, persistent: true,
    };
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
    this.tabs.set(id, { state: { id, title: 'Tab baru', url: '', loading: false, canGoBack: false, canGoForward: false, error: null }, view: null, profileId: this.profiles.activeProfileId });
    this.activeTabId = id;
    this.activeTabs.set(this.profiles.activeProfileId, id);
    this.layout();
    this.emit();
  }

  private createView(tab: TabEntry): WebContentsView {
    const view = new WebContentsView({ webPreferences: {
      session: this.sessions.getSession(tab.profileId), nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
      navigateOnDragDrop: false, spellcheck: true,
    } });
    tab.view = view;
    this.window.contentView.addChildView(view);
    view.setBackgroundColor('#ffffff');
    const contents = view.webContents;
    if (this.network) {
      this.network.attach(contents);
    }
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
    contents.setWindowOpenHandler(details => {
      if (tab.profileId !== this.profiles.activeProfileId) return { action: 'deny' };

      if (isPopupWindow(details)) {
        const isSafeUrl = !details.url || details.url === 'about:blank' || isWebUrl(details.url);
        if (!isSafeUrl) return { action: 'deny' };

        const hasDimensions = Boolean(details.features && /(?:width|height)=/i.test(details.features));
        const overrideBrowserWindowOptions: Electron.BrowserWindowConstructorOptions = {
          parent: this.window,
          modal: false,
          autoHideMenuBar: true,
          backgroundColor: '#ffffff',
          webPreferences: {
            session: this.sessions.getSession(tab.profileId),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            spellcheck: true,
          },
        };
        if (!hasDimensions) {
          overrideBrowserWindowOptions.width = 520;
          overrideBrowserWindowOptions.height = 680;
        }

        return {
          action: 'allow',
          overrideBrowserWindowOptions,
        };
      }

      if (isWebUrl(details.url) && this.tabs.size < 30) {
        this.newTab();
        this.navigate(details.url);
      }
      return { action: 'deny' };
    });

    contents.on('did-create-window', (childWindow) => {
      let tabPopups = this.popups.get(tab.state.id);
      if (!tabPopups) {
        tabPopups = new Set();
        this.popups.set(tab.state.id, tabPopups);
      }
      tabPopups.add(childWindow);
      childWindow.once('closed', () => {
        tabPopups?.delete(childWindow);
      });

      childWindow.setMenu(null);

      const popupGuard = (event: Electron.Event, url: string) => {
        if (!isWebUrl(url)) event.preventDefault();
      };
      childWindow.webContents.on('will-navigate', popupGuard);
      childWindow.webContents.on('will-redirect', popupGuard);
      childWindow.webContents.on('will-frame-navigate', event => {
        if (!isWebUrl(event.url) && event.url !== 'about:blank') event.preventDefault();
      });
      childWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isWebUrl(url) && this.tabs.size < 30 && tab.profileId === this.profiles.activeProfileId) {
          this.newTab();
          this.navigate(url);
        }
        return { action: 'deny' };
      });
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
    if (!tab || tab.profileId !== this.profiles.activeProfileId) throw new Error('Tab tidak ditemukan di profil aktif.');
    const ids = [...this.tabs.values()].filter(entry => entry.profileId === tab.profileId).map(entry => entry.state.id);
    const index = ids.indexOf(id);
    this.tabs.delete(id);
    const popups = this.popups.get(id);
    if (popups) {
      for (const popup of popups) {
        if (!popup.isDestroyed()) popup.close();
      }
      this.popups.delete(id);
    }
    if (tab.view) {
      this.window.contentView.removeChildView(tab.view);
      tab.view.webContents.close();
    }
    if (ids.length === 1) { this.newTab(); return; }
    if (this.activeTabId === id) this.activeTabId = ids[index + 1] ?? ids[index - 1]!;
    this.activeTabs.set(this.profiles.activeProfileId, this.activeTabId);
    this.layout();
    this.emit();
  }

  execute(command: BrowserCommand): void {
    switch (command.action) {
      case 'new-tab': this.newTab(); this.focusAddress(); return;
      case 'close-tab': this.closeTab(command.tabId); return;
      case 'switch-tab':
        if (this.tabs.get(command.tabId)?.profileId !== this.profiles.activeProfileId) throw new Error('Tab tidak ditemukan di profil aktif.');
        this.activeTabId = command.tabId;
        this.activeTabs.set(this.profiles.activeProfileId, command.tabId);
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

  createProfile(name: string): void {
    if (this.tabs.size >= 30) throw new Error('Tutup satu tab sebelum membuat profil.');
    const profile = this.profiles.createProfile(name);
    this.switchProfile(profile.id);
  }

  switchProfile(id: string): void {
    if (id === this.profiles.activeProfileId) return;
    if (!this.activeTabs.has(id) && this.tabs.size >= 30) throw new Error('Tutup satu tab sebelum membuka profil lain.');
    this.profiles.switchProfile(id);
    this.updatePopupVisibility();
    const active = this.activeTabs.get(id);
    if (!active) { this.newTab(); return; }
    this.activeTabId = active;
    this.layout();
    this.emit();
  }

  private updatePopupVisibility(): void {
    for (const [tabId, popupSet] of this.popups) {
      const tab = this.tabs.get(tabId);
      const isCurrent = tab && tab.profileId === this.profiles.activeProfileId;
      for (const popup of popupSet) {
        if (!popup.isDestroyed()) {
          if (isCurrent) {
            if (!popup.isVisible()) popup.show();
          } else {
            if (popup.isVisible()) popup.hide();
          }
        }
      }
    }
  }

  async deleteProfile(id: string): Promise<void> {
    this.profiles.assertDeletable(id);
    for (const [tabId, tab] of this.tabs) {
      if (tab.profileId !== id) continue;
      this.tabs.delete(tabId);
      const popups = this.popups.get(tabId);
      if (popups) {
        for (const popup of popups) {
          if (!popup.isDestroyed()) popup.close();
        }
        this.popups.delete(tabId);
      }
      if (tab.view) {
        this.window.contentView.removeChildView(tab.view);
        tab.view.webContents.close();
      }
    }
    this.activeTabs.delete(id);
    // Keep valid visible state even if clearing or metadata persistence fails.
    if (this.profiles.activeProfileId === id) this.switchProfile('default');
    await this.sessions.clearProfile(id);
    this.profiles.deleteProfile(id);
    this.emit();
  }

  async changeSharedSession(change: () => string[]): Promise<void> {
    await this.sessions.flush();
    const changed = new Set(change());
    for (const [id, tab] of this.tabs) {
      if (!changed.has(tab.profileId)) continue;
      this.tabs.delete(id);
      const popups = this.popups.get(id);
      if (popups) {
        for (const popup of popups) {
          if (!popup.isDestroyed()) popup.close();
        }
        this.popups.delete(id);
      }
      if (tab.view) {
        this.window.contentView.removeChildView(tab.view);
        tab.view.webContents.close();
      }
    }
    for (const id of changed) this.activeTabs.delete(id);
    if (changed.has(this.profiles.activeProfileId)) this.newTab();
    else { this.layout(); this.emit(); }
  }

  setBounds(bounds: ViewBounds): void { this.bounds = bounds; this.layout(); }

  layout(): void {
    const [width = 0, height = 0] = this.window.getContentSize();
    const x = Math.min(this.bounds.x, width);
    const y = Math.min(this.bounds.y, height);
    for (const [id, tab] of this.tabs) {
      if (!tab.view) continue;
      tab.view.setBounds({ x, y, width: Math.max(0, Math.min(this.bounds.width, width - x)), height: Math.max(0, Math.min(this.bounds.height, height - y)) });
      tab.view.setVisible(id === this.activeTabId && tab.profileId === this.profiles.activeProfileId && !tab.state.error);
    }
  }

  focusAddress(): void {
    this.window.webContents.focus();
    this.window.webContents.send('browser:focus-address');
  }

  dispose(): void {
    this.disposed = true;
    for (const popupSet of this.popups.values()) {
      for (const popup of popupSet) {
        if (!popup.isDestroyed()) popup.close();
      }
    }
    this.popups.clear();
    for (const tab of this.tabs.values()) {
      if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    this.tabs.clear();
  }

  getActiveWebContents(): Electron.WebContents {
    const tab = this.active();
    if (!tab.view) {
      this.createView(tab);
    }
    return tab.view!.webContents;
  }

  async captureScreenshot(): Promise<string> {
    const contents = this.getActiveWebContents();
    const image = await contents.capturePage();
    return image.toPNG().toString('base64');
  }

  async click(target: { selector?: string; text?: string }): Promise<void> {
    const contents = this.getActiveWebContents();
    const result = await contents.executeJavaScript(`
      (() => {
        let el = null;
        if (${JSON.stringify(target.selector || '')}) {
          el = document.querySelector(${JSON.stringify(target.selector || '')});
        } else if (${JSON.stringify(target.text || '')}) {
          const targetText = ${JSON.stringify(target.text || '')}.trim().toLowerCase();
          const candidates = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"], span, p, h1, h2, h3, h4, h5, h6, div'));
          el = candidates.find(c => (c.innerText || c.textContent || '').trim().toLowerCase().includes(targetText));
        }
        if (!el) return { found: false };
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        el.click();
        return { found: true };
      })()
    `);
    if (!result || !result.found) {
      throw new RpcError('ELEMENT_NOT_FOUND', 'Elemen untuk diklik tidak ditemukan.');
    }
  }

  async type(selector: string, text: string, options: { clear?: boolean; pressEnter?: boolean } = {}, signal?: AbortSignal): Promise<void> {
    const contents = this.getActiveWebContents();
    const result = await contents.executeJavaScript(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { found: false };
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        el.focus();
        if (${Boolean(options.clear)}) {
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        el.value = (el.value || '') + ${JSON.stringify(text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { found: true };
      })()
    `);
    if (!result || !result.found) {
      throw new RpcError('ELEMENT_NOT_FOUND', 'Kolom input tidak ditemukan.');
    }
    if (options.pressEnter) {
      signal?.throwIfAborted();
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      contents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    }
  }

  async pressKey(key: string, signal?: AbortSignal): Promise<void> {
    const contents = this.getActiveWebContents();
    signal?.throwIfAborted();
    contents.sendInputEvent({ type: 'keyDown', keyCode: key });
    contents.sendInputEvent({ type: 'keyUp', keyCode: key });
  }

  async getDOM(options: { format?: 'text' | 'html' | 'outline'; maxLength?: number } = {}): Promise<string> {
    const result = await this.getActiveWebContents().executeJavaScript(
      '(' + readSafePage.toString() + ')(' + JSON.stringify({ ...options, maxLength: Math.min(Math.max(options.maxLength ?? 30000, 1), 100000) }) + ')');
    return String(result || '');
  }

  async extract(selector: string, maxItems = 50): Promise<Array<{ text: string; tag: string; attributes: Record<string, string> }>> {
    return this.getActiveWebContents().executeJavaScript(
      '(' + readSafePage.toString() + ')(' + JSON.stringify({ selector, maxItems: Math.min(Math.max(maxItems, 1), 200) }) + ')');
  }

  async waitFor(options: { ms?: number; selector?: string; text?: string; timeoutMs?: number }, signal?: AbortSignal): Promise<boolean> {
    if (options.ms && options.ms > 0) {
      await delay(Math.min(options.ms!, 60_000), undefined, { signal });
      return true;
    }
    const timeout = Math.min(Math.max(options.timeoutMs ?? 10_000, 500), 60_000);
    const contents = this.getActiveWebContents();
    const start = Date.now();

    while (Date.now() - start < timeout) {
      signal?.throwIfAborted();
      const found = await contents.executeJavaScript(`
        (() => {
          if (${JSON.stringify(options.selector || '')}) {
            return Boolean(document.querySelector(${JSON.stringify(options.selector || '')}));
          }
          if (${JSON.stringify(options.text || '')}) {
            return Boolean(document.body && document.body.innerText.includes(${JSON.stringify(options.text || '')}));
          }
          return true;
        })()
      `).catch(() => false);
      if (found) return true;
      await delay(200, undefined, { signal });
    }
    throw new RpcError('TIMEOUT', 'Kondisi yang ditunggu belum terpenuhi.');
  }

  async scroll(options: { direction?: 'up' | 'down' | 'top' | 'bottom'; amount?: number }): Promise<void> {
    const contents = this.getActiveWebContents();
    const dir = options.direction || 'down';
    const amount = options.amount || 500;
    await contents.executeJavaScript(`
      (() => {
        if (${JSON.stringify(dir)} === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
        else if (${JSON.stringify(dir)} === 'bottom') window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        else if (${JSON.stringify(dir)} === 'up') window.scrollBy({ top: -${amount}, behavior: 'smooth' });
        else window.scrollBy({ top: ${amount}, behavior: 'smooth' });
      })()
    `);
  }

  async extractSchema(schema: ExtractionSpec): Promise<Record<string, Json>[]> {
    const contents = this.getActiveWebContents();
    const currentUrl = contents.getURL() || 'http://localhost';
    const rawRows = await contents.executeJavaScript(`
      (() => {
        const rowSelector = ${JSON.stringify(schema.rowSelector)};
        const fields = ${JSON.stringify(schema.fields)};
        const maxItems = ${Math.min(schema.maxItems, 200)};
        let rowElements = [];
        try {
          rowElements = Array.from(document.querySelectorAll(rowSelector)).slice(0, maxItems);
        } catch {
          rowElements = [];
        }
        return rowElements.map(row => {
          const item = {};
          for (const field of fields) {
            let el = null;
            if (field.selector && field.selector.trim()) {
              try { el = row.querySelector(field.selector) || document.querySelector(field.selector); } catch {}
            } else {
              el = row;
            }
            if (!el) {
              item[field.path] = null;
              continue;
            }
            if (field.attribute) {
              item[field.path] = el.getAttribute(field.attribute);
            } else {
              item[field.path] = (el.innerText || el.textContent || '').trim();
            }
          }
          return item;
        });
      })()
    `) as Record<string, string | null>[];

    const results: Record<string, Json>[] = [];
    for (const raw of rawRows) {
      const rowObj: Record<string, Json> = {};
      for (const field of schema.fields) {
        const rawVal = raw[field.path] ?? null;
        const parsed = convert(rawVal, field, currentUrl);
        setPath(rowObj, field.path, parsed);
      }
      results.push(rowObj);
    }
    return results;
  }

  async discoverLinks(keyword = '', limit = 50): Promise<Array<{ url: string; text: string; title: string }>> {
    const contents = this.getActiveWebContents();
    const links = await contents.executeJavaScript(`
      (() => {
        const kw = ${JSON.stringify(keyword.toLowerCase().trim())};
        const lim = ${Math.min(Math.max(limit, 1), 200)};
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        const results = [];
        const seen = new Set();
        for (const a of anchors) {
          const href = a.href;
          if (!href || (!href.startsWith('http://') && !href.startsWith('https://'))) continue;
          const text = (a.innerText || a.textContent || '').trim();
          const title = a.title || '';
          if (kw) {
            const match = href.toLowerCase().includes(kw) || text.toLowerCase().includes(kw) || title.toLowerCase().includes(kw);
            if (!match) continue;
          }
          if (seen.has(href)) continue;
          seen.add(href);
          results.push({ url: href, text: text.slice(0, 300), title: title.slice(0, 300) });
          if (results.length >= lim) break;
        }
        return results;
      })()
    `) as Array<{ url: string; text: string; title: string }>;
    return links;
  }

  async evaluateSafe(script: string, timeoutMs = 15000): Promise<unknown> {
    const contents = this.getActiveWebContents();
    const evalPromise = contents.executeJavaScript(`
      (() => {
        try {
          return (${script});
        } catch (err) {
          return { error: String(err && err.message ? err.message : err) };
        }
      })()
    `);
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Script evaluation timed out')), timeoutMs);
    });
    try {
      return await Promise.race([evalPromise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  setVisibility(visible: boolean): void {
    if (visible) {
      if (!this.window.isVisible()) this.window.show();
      if (this.window.isMinimized()) this.window.restore();
      this.window.setAlwaysOnTop(true, 'screen-saver');
      this.window.focus();
      this.window.moveTop();
    } else {
      this.window.setAlwaysOnTop(false);
      this.window.hide();
    }
    this.emit();
  }
}
