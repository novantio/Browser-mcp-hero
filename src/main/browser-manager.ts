import { RpcError, assertPageAction } from '../shared/rpc-error';
import { clickPageElement, fillPageInput, hoverPageElement, selectPageOption, setCheckboxState } from './page-actions';
import { observePage } from './page-observer';
import { inspectPageForms, fillPageForm, findPageElements, getPageFocusedElement, getElementBoundingBox, captureFormCheckpoint, restoreFormCheckpoint } from './page-forms';
import { detectPageChallenge } from './challenge-detector';
import { SelectorHealer } from './data/selector-healer';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readSafePage } from './page-snapshot';
import { randomUUID } from 'node:crypto';
import { BrowserWindow, WebContentsView, nativeImage } from 'electron';
import { ProfileManager } from './profile-manager';
import { SessionManager } from './session-manager';
import type { CertificatePrompt } from './session-manager';
import { alternateScheme, isPopupWindow, isWebUrl, resolveAddress } from '../shared/navigation';
import type { BrowserCommand, BrowserState, BrowserTab, ViewBounds } from '../shared/types';
import type { ExtractionSpec, Json } from '../shared/data-contracts';
import { convert, setPath } from './data/processing';
import { NetworkIntelligence } from './data/network-intelligence';
import { ConsoleMonitor } from './console-monitor';
import { STEALTH_SCRIPT } from './stealth';
import { htmlToMarkdown } from './html-to-markdown';
import { execWithTimeout } from './page-exec';

export interface ExpectCondition { selector?: string; text?: string; url?: string; timeoutMs?: number }
interface TabEntry { state: BrowserTab; view: WebContentsView | null; profileId: string }

export class BrowserManager {
  private readonly tabs = new Map<string, TabEntry>();
  private readonly popups = new Map<string, Set<BrowserWindow>>();
  private activeTabId = '';
  private bounds: ViewBounds = { x: 0, y: 124, width: 900, height: 600 };
  private readonly activeTabs = new Map<string, string>();
  private disposed = false;
  private readonly consoleMonitor = new ConsoleMonitor();
  private network: NetworkIntelligence = new NetworkIntelligence();
  private readonly healer = new SelectorHealer();
  private readonly checkpoints = new Map<string, { url: string; timestamp: number; fields: any[] }>();

  constructor(private readonly window: BrowserWindow, private readonly publish: (state: BrowserState) => void,
      private readonly profiles: ProfileManager, private readonly sessions: SessionManager) {
    this.sessions.onCertificatePrompt(prompt => this.handleCertificatePrompt(prompt));
    this.newTab();
  }

  private handleCertificatePrompt(prompt: CertificatePrompt): void {
    // Attach the warning to the tab that is loading this host, not blindly to the active tab.
    const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } };
    const candidates = [...this.tabs.values()].filter(entry => hostOf(entry.state.url) === prompt.host);
    const tab = candidates.find(entry => entry.state.id === this.activeTabId) ?? candidates[0] ?? this.tabs.get(this.activeTabId);
    if (!tab) { this.sessions.cancelPendingCertificate(prompt.requestId); return; }
    if (tab.state.certificateWarning) this.sessions.cancelPendingCertificate(tab.state.certificateWarning.requestId);
    tab.state.certificateWarning = { requestId: prompt.requestId, host: prompt.host, url: prompt.url };
    tab.state.loading = false;
    tab.state.error = null;
    this.emit();
  }

  /** Applies the user's certificate decision for the active tab and reloads when allowed. */
  respondToCertificatePrompt(allow: boolean): void {
    const tab = this.active();
    const warning = tab.state.certificateWarning;
    if (!warning) return;
    tab.state.certificateWarning = null;
    const resolved = this.sessions.resolveCertificate(warning.requestId, allow);
    if (resolved && allow) {
      const target = this.tabs.get(this.activeTabId);
      if (target) {
        const view = target.view ?? this.createView(target);
        void this.loadWithSchemeFallback(target, view.webContents, warning.url).catch(() => {});
      }
    } else {
      this.emit();
    }
  }

  private run(contents: Electron.WebContents, code: string, timeoutMs = 10000): Promise<any> {
    return execWithTimeout(contents, code, timeoutMs);
  }

  private clearCertificateWarning(tab: TabEntry): void {
    const warning = tab.state.certificateWarning;
    if (!warning) return;
    tab.state.certificateWarning = null;
    this.sessions.cancelPendingCertificate(warning.requestId);
  }

  getSessions(): SessionManager {
    return this.sessions;
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
      activeTabId: this.activeTabId,
      profiles: this.profiles.listProfiles().map(p => ({
        ...p,
        loggedInServices: this.sessions.getCachedLoggedInServices(p.id),
        socialAccounts: this.sessions.getCachedSocialLogins(p.id),
      })),
      activeProfileId: this.profiles.activeProfileId,
      persistent: true,
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
      navigateOnDragDrop: false, spellcheck: true, backgroundThrottling: false,
    } });
    tab.view = view;
    this.window.contentView.addChildView(view);
    view.setBackgroundColor('#ffffff');
    const contents = view.webContents;
    // Attach stealth anti-bot evasion
    if (!contents.debugger.isAttached()) {
      try { contents.debugger.attach('1.3'); } catch {}
    }
    if (contents.debugger.isAttached()) {
      void contents.debugger.sendCommand('Page.enable').catch(() => {});
      void contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: STEALTH_SCRIPT,
      }).catch(() => {});
    }
    const injectStealth = () => {
      if (!contents.isDestroyed()) {
        contents.executeJavaScript(STEALTH_SCRIPT).catch(() => {});
      }
    };
    contents.on('dom-ready', injectStealth);

    this.consoleMonitor.attach(tab.state.id, contents);
    this.network.attach(contents);
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
      this.clearCertificateWarning(tab);
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

  async navigateToUrl(input: string, signal?: AbortSignal): Promise<string> {
    const url = resolveAddress(input);
    const tab = this.active();
    const view = tab.view ?? this.createView(tab);

    const finalUrl = await this.loadWithSchemeFallback(tab, view.webContents, url, signal);
    if (!tab.state.certificateWarning) await this.waitForPageReady(view.webContents, signal);
    return finalUrl;
  }

  /**
   * Loads a URL and, if the main frame fails to load (e.g. an https:// URL on a
   * plain-HTTP server, or vice versa), retries once with the opposite scheme so
   * hosts that don't match the guessed scheme are still reachable.
   */
  private async loadWithSchemeFallback(
    tab: TabEntry,
    contents: Electron.WebContents,
    url: string,
    signal?: AbortSignal
  ): Promise<string> {
    let attemptUrl = url;
    // A new navigation supersedes any unanswered certificate warning on this tab.
    this.clearCertificateWarning(tab);
    for (let attempt = 0; attempt < 2; attempt++) {
      tab.state.url = attemptUrl;
      try { tab.state.title = new URL(attemptUrl).hostname; } catch { /* keep prior title */ }
      tab.state.error = null;
      tab.state.loading = true;
      // Only the host we intend to load may raise a certificate approval prompt.
      this.sessions.expectMainFrameHost(tab.profileId, new URL(attemptUrl).hostname);
      this.layout();
      this.emit();

      const outcome = await this.loadAttempt(tab, contents, attemptUrl, signal);
      if (outcome !== 'failed') return attemptUrl;

      const alternate = alternateScheme(attemptUrl);
      if (!alternate || signal?.aborted) return attemptUrl;
      attemptUrl = alternate;
    }
    return attemptUrl;
  }

  /**
   * Resolves 'failed' when the main frame reports a load failure (excluding
   * ERR_ABORTED), or 'settled' on success / when a certificate warning pauses the
   * load so the caller can return promptly instead of waiting for the timeout.
   */
  private loadAttempt(tab: TabEntry, contents: Electron.WebContents, url: string, signal?: AbortSignal): Promise<'failed' | 'settled'> {
    return new Promise<'failed' | 'settled'>(resolve => {
      let settled = false;
      const onFail = (_event: Electron.Event, code: number, _description: string, _validatedUrl: string, isMainFrame: boolean) => {
        if (!isMainFrame || code === -3) return;
        finish('failed');
      };
      const finish = (outcome: 'failed' | 'settled') => {
        if (settled) return;
        settled = true;
        contents.off('did-fail-load', onFail);
        clearInterval(poll);
        resolve(outcome);
      };
      const poll = setInterval(() => {
        if (tab.state.certificateWarning || signal?.aborted) finish('settled');
      }, 100);
      contents.on('did-fail-load', onFail);
      contents.loadURL(url).then(() => finish('settled')).catch(() => finish('settled'));
      delay(15000, undefined, { signal }).then(() => finish('settled')).catch(() => finish('settled'));
    });
  }

  async waitForPageReady(contents: Electron.WebContents, signal?: AbortSignal): Promise<void> {
    if (contents.isDestroyed() || contents.isCrashed()) return;
    const start = Date.now();
    while (Date.now() - start < 4000) {
      signal?.throwIfAborted();
      if (contents.isDestroyed()) return;
      try {
        const readyState = await this.run(contents, 'document.readyState', 1500).catch(() => null);
        if (readyState === 'interactive' || readyState === 'complete') {
          await delay(100, undefined, { signal }).catch(() => {});
          return;
        }
      } catch {}
      await delay(100, undefined, { signal }).catch(() => {});
    }
  }

  private navigate(input: string): void {
    const url = resolveAddress(input);
    const tab = this.active();
    const view = tab.view ?? this.createView(tab);
    // Load asynchronously so stop, tab switching and further navigation stay responsive.
    void this.loadWithSchemeFallback(tab, view.webContents, url).catch(() => { /* did-fail-load renders a safe error. */ });
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
      case 'certificate-response': this.respondToCertificatePrompt(command.allow); return;
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

  /**
   * Reloads the active tab. `hard` bypasses the cache; `force` recovers a tab whose
   * renderer is hung or crashed by killing the renderer process and loading the URL again.
   */
  async reloadTab(options: { hard?: boolean; force?: boolean } = {}, signal?: AbortSignal): Promise<{ ok: true; url: string; recovered: boolean }> {
    const tab = this.active();
    const view = tab.view ?? this.createView(tab);
    const contents = view.webContents;
    const url = tab.state.url || contents.getURL();
    tab.state.error = null;
    this.clearCertificateWarning(tab);
    let recovered = false;
    if (options.force || contents.isCrashed()) {
      if (!contents.isCrashed()) {
        const gone = new Promise<void>(resolve => contents.once('render-process-gone', () => resolve()));
        contents.forcefullyCrashRenderer();
        await Promise.race([gone, delay(3000)]);
      }
      recovered = true;
      if (url && isWebUrl(url)) await this.loadWithSchemeFallback(tab, contents, url, signal);
      else contents.reload();
    } else if (options.hard) {
      contents.reloadIgnoringCache();
    } else {
      contents.reload();
    }
    this.layout();
    if (!tab.state.certificateWarning) await this.waitForPageReady(contents, signal);
    return { ok: true, url: tab.state.url || url, recovered };
  }

  /**
   * Lynx-style text reader. `fetch` downloads the URL with the task profile's cookies and
   * converts the raw HTML without running page JavaScript, so heavy or hung pages can
   * still be read. `live` converts the active tab's current DOM (useful for SPAs) and
   * falls back to `fetch` when the page does not respond.
   */
  async readText(options: { url?: string; source?: 'auto' | 'fetch' | 'live'; maxLength?: number; mainOnly?: boolean; includeLinks?: boolean } = {}, signal?: AbortSignal): Promise<{
    url: string; title: string; status?: number; source: 'fetch' | 'live'; markdown: string; links: number; truncated: boolean;
  }> {
    const tab = this.active();
    const target = options.url ? resolveAddress(options.url) : tab.state.url;
    if (!target || !isWebUrl(target)) throw new RpcError('INVALID_INPUT', 'Berikan url http(s), atau buka halaman terlebih dahulu.');
    const convertOptions = { baseUrl: target, maxLength: options.maxLength, mainOnly: options.mainOnly, includeLinks: options.includeLinks };
    const wantLive = options.source === 'live' || (options.source !== 'fetch' && !options.url);
    if (wantLive && tab.view && !tab.view.webContents.isDestroyed()) {
      try {
        const contents = tab.view.webContents;
        const html = String(await this.run(contents, 'document.documentElement ? document.documentElement.outerHTML : ""', 4000));
        return { url: contents.getURL() || target, source: 'live', ...htmlToMarkdown(html, { ...convertOptions, baseUrl: contents.getURL() || target }) };
      } catch (error) {
        if (options.source === 'live') throw error;
        // Page is busy or crashed: read the same URL without its JavaScript instead.
      }
    }

    const response = await this.sessions.getSession(tab.profileId).fetch(target, {
      redirect: 'follow',
      headers: { Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
      signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]),
    }).catch(() => { throw new RpcError('FETCH_FAILED', 'Halaman tidak dapat diunduh. Periksa alamat dan koneksi.'); });
    const contentType = response.headers.get('content-type') || '';
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > 8_000_000) throw new RpcError('OUTPUT_LIMIT', 'Halaman terlalu besar untuk dibaca sebagai teks.');
    const charset = /charset=([^;\s]+)/i.exec(contentType)?.[1]
      || /<meta[^>]+charset=["']?([a-z0-9_-]+)/i.exec(buffer.subarray(0, 4096).toString('latin1'))?.[1] || 'utf-8';
    let body: string;
    try { body = new TextDecoder(charset.toLowerCase()).decode(buffer); } catch { body = buffer.toString('utf8'); }
    const finalUrl = response.url || target;
    if (!/html|xml/i.test(contentType) && !/^\s*</.test(body)) {
      const maxLength = Math.min(Math.max(options.maxLength ?? 20000, 200), 200000);
      return { url: finalUrl, title: '', status: response.status, source: 'fetch', markdown: body.slice(0, maxLength), links: 0, truncated: body.length > maxLength };
    }
    return { url: finalUrl, status: response.status, source: 'fetch', ...htmlToMarkdown(body, { ...convertOptions, baseUrl: finalUrl }) };
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

  async captureScreenshot(options?: {
    elementId?: number;
    selector?: string;
    region?: { x: number; y: number; width: number; height: number };
  }): Promise<string> {
    const isHeadless = Boolean((this.window as any)?.isHeadlessMode);
    if (!isHeadless && (!this.window.isVisible() || this.window.isMinimized())) {
      throw new RpcError('SCREENSHOT_UNAVAILABLE', 'Screenshot tidak tersedia karena jendela tertutup, diminimalkan, atau disembunyikan.');
    }
    const tab = this.active();
    if (tab.state.error) {
      throw new RpcError('SCREENSHOT_NOT_READY', 'Halaman mengalami kesalahan muat.');
    }
    const contents = this.getActiveWebContents();
    if (contents.isDestroyed() || contents.isCrashed()) {
      throw new RpcError('SCREENSHOT_UNAVAILABLE', 'Tampilan halaman tidak tersedia.');
    }

    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new RpcError('SCREENSHOT_NOT_READY', 'Pengambilan screenshot melebihi batas waktu.')), 5000);
    });

    try {
      const capturePromise = (async () => {
        try {
          const img = await contents.capturePage();
          const sz = img.getSize();
          if (sz.width > 0 && sz.height > 0) return img;
          return await this.captureWithCdp(contents);
        } catch (err) {
          const msg = String(err && (err as any).message ? (err as any).message : err);
          if (msg.includes('UnknownVizError') || msg.includes('surface') || msg.includes('render') || msg.includes('failed')) {
            return await this.captureWithCdp(contents);
          }
          throw new RpcError('SCREENSHOT_NOT_READY', 'Gagal mengambil gambar tampilan halaman.');
        }
      })();
      let image = await Promise.race([capturePromise, timeoutPromise]);
      const size = image.getSize();
      if (!size.width || !size.height) {
        throw new RpcError('SCREENSHOT_NOT_READY', 'Hasil screenshot kosong.');
      }

      if (options?.region) {
        const reg = options.region;
        const x = Math.min(Math.max(0, reg.x), size.width - 1);
        const y = Math.min(Math.max(0, reg.y), size.height - 1);
        const w = Math.min(Math.max(1, reg.width), size.width - x);
        const h = Math.min(Math.max(1, reg.height), size.height - y);
        image = image.crop({ x, y, width: w, height: h });
      } else if (options?.elementId !== undefined || options?.selector) {
        const box = (await this.run(contents, 
          '(' + getElementBoundingBox.toString() + ')(' + JSON.stringify({ elementId: options.elementId, selector: options.selector }) + ')'
        )) as { x: number; y: number; width: number; height: number } | null;

        if (!box || box.width <= 0 || box.height <= 0) {
          throw new RpcError('ELEMENT_NOT_FOUND', 'Elemen untuk target screenshot tidak ditemukan atau tersembunyi.');
        }
        const x = Math.min(Math.max(0, box.x), size.width - 1);
        const y = Math.min(Math.max(0, box.y), size.height - 1);
        const w = Math.min(Math.max(1, box.width), size.width - x);
        const h = Math.min(Math.max(1, box.height), size.height - y);
        image = image.crop({ x, y, width: w, height: h });
      }

      return image.toPNG().toString('base64');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async captureWithCdp(contents: Electron.WebContents): Promise<Electron.NativeImage> {
    if (!contents.debugger.isAttached()) {
      try { contents.debugger.attach('1.3'); } catch {}
    }
    if (!contents.debugger.isAttached()) {
      throw new RpcError('SCREENSHOT_UNAVAILABLE', 'Screenshot tidak tersedia karena permukaan render dan debugger CDP tidak aktif.');
    }
    try {
      const result = (await contents.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        fromSurface: false,
        captureBeyondViewport: false,
      })) as { data?: string };

      if (!result?.data) {
        throw new RpcError('SCREENSHOT_NOT_READY', 'Hasil screenshot CDP kosong.');
      }
      return nativeImage.createFromBuffer(Buffer.from(result.data, 'base64'));
    } catch (err: any) {
      if (err instanceof RpcError) throw err;
      throw new RpcError('SCREENSHOT_UNAVAILABLE', 'Screenshot tidak tersedia: ' + (err?.message || 'CDP render gagal.'));
    }
  }

  async verifyCondition(contents: Electron.WebContents, expect: ExpectCondition, signal?: AbortSignal): Promise<boolean> {
    const timeout = Math.min(Math.max(expect.timeoutMs ?? 5000, 100), 30000);
    const start = Date.now();
    while (Date.now() - start < timeout) {
      signal?.throwIfAborted();
      if (contents.isDestroyed() || contents.isCrashed()) return false;

      let urlMatched = true;
      if (expect.url) {
        const currentUrl = contents.getURL() || '';
        urlMatched = currentUrl.includes(expect.url);
      }

      if (urlMatched && !expect.selector && !expect.text) {
        return true;
      }

      if (urlMatched) {
        const domMatched = await this.run(contents, `
          (() => {
            if (${JSON.stringify(expect.selector || '')}) {
              if (!document.querySelector(${JSON.stringify(expect.selector || '')})) return false;
            }
            if (${JSON.stringify(expect.text || '')}) {
              const bodyText = (document.body ? (document.body.innerText || document.body.textContent || '') : '').trim().toLowerCase();
              const expected = ${JSON.stringify(expect.text || '')}.trim().toLowerCase();
              if (!bodyText.includes(expected)) return false;
            }
            return true;
          })()
        `).catch(() => false);

        if (domMatched) return true;
      }

      await delay(100, undefined, { signal });
    }
    return false;
  }

  async observe(options: { maxLength?: number; format?: 'text' | 'json' | 'both' } = {}): Promise<Omit<ReturnType<typeof observePage>, 'elements'> & { elements?: ReturnType<typeof observePage>['elements'] }> {
    const contents = this.getActiveWebContents();
    const challenge = await detectPageChallenge(contents);
    const result = (await this.run(contents,
      '(' + observePage.toString() + ')(' + JSON.stringify({ maxLength: options.maxLength }) + ')'
    )) as Omit<ReturnType<typeof observePage>, 'elements'> & { elements?: ReturnType<typeof observePage>['elements'] };
    // The outline in `text` already carries every element; sending both doubles the tokens.
    const format = options.format ?? 'text';
    if (format === 'text') delete result.elements;
    if (format === 'json') result.text = result.text.split('\n').slice(0, 4).join('\n');

    if (challenge.detected && result && typeof result.text === 'string') {
      const banner = `[⚠️ SECURITY CHALLENGE / CAPTCHA TERDETEKSI: ${challenge.provider || 'bot challenge'} (${challenge.details || ''}). JANGAN mengklik elemen captcha secara acak! Panggil tool 'browser_request_human_intervention' sekarang agar pengguna manusia dapat menyelesaikan verifikasi ini di browser.]\n\n`;
      result.text = banner + result.text;
    }
    return result;
  }



  async click(target: { elementId?: number; selector?: string; text?: string; expect?: ExpectCondition; autoHeal?: boolean }, signal?: AbortSignal): Promise<{ ok: true; status?: 'verified' | 'unverified'; detail?: string; healed?: boolean }> {
    const contents = this.getActiveWebContents();
    signal?.throwIfAborted();

    let result: string | null = null;
    const deadline = Date.now() + 2000;
    while (true) {
      signal?.throwIfAborted();
      result = await this.run(contents, 
        '(' + clickPageElement.toString() + ')(' + JSON.stringify(target) + ')'
      );
      if (!result) break;
      if (result === 'ELEMENT_NOT_FOUND' || result === 'ELEMENT_NOT_INTERACTABLE') {
        if (Date.now() >= deadline) break;
        await delay(100, undefined, { signal }).catch(() => {});
        continue;
      }
      break;
    }

    let wasHealed = false;
    if (result === 'ELEMENT_NOT_FOUND' && target.selector && target.autoHeal !== false) {
      const healed = await this.healer.heal(contents, target.selector);
      if (healed && healed.confidence >= 0.6 && healed.resolvedSelector !== target.selector) {
        result = await this.run(contents, 
          '(' + clickPageElement.toString() + ')(' + JSON.stringify({ selector: healed.resolvedSelector }) + ')'
        );
        if (!result) wasHealed = true;
      }
    }

    assertPageAction(result);

    if (target.expect) {
      const verified = await this.verifyCondition(contents, target.expect, signal);
      if (verified) return { ok: true, status: 'verified', healed: wasHealed || undefined };
      return { ok: true, status: 'unverified', detail: 'Kondisi verifikasi yang diharapkan belum terpenuhi dalam batas waktu.', healed: wasHealed || undefined };
    }
    return { ok: true, healed: wasHealed || undefined };
  }

  async type(target: string | { elementId?: number; selector?: string; autoHeal?: boolean }, text: string, options: { clear?: boolean; pressEnter?: boolean; expect?: ExpectCondition } = {}, signal?: AbortSignal): Promise<{ ok: true; status?: 'verified' | 'unverified'; detail?: string; healed?: boolean }> {
    const contents = this.getActiveWebContents();
    signal?.throwIfAborted();

    let result: string | null = null;
    const deadline = Date.now() + 2000;
    while (true) {
      signal?.throwIfAborted();
      result = await this.run(contents, 
        '(' + fillPageInput.toString() + ')(' + JSON.stringify(target) + ',' + JSON.stringify(text) + ',' + Boolean(options.clear) + ')');
      if (!result) break;
      if (result === 'ELEMENT_NOT_FOUND' || result === 'ELEMENT_NOT_INTERACTABLE') {
        if (Date.now() >= deadline) break;
        await delay(100, undefined, { signal }).catch(() => {});
        continue;
      }
      break;
    }

    let wasHealed = false;
    const targetSelector = typeof target === 'string' ? target : target.selector;
    const autoHeal = typeof target === 'object' ? target.autoHeal !== false : true;

    if (result === 'ELEMENT_NOT_FOUND' && targetSelector && autoHeal) {
      const healed = await this.healer.heal(contents, targetSelector);
      if (healed && healed.confidence >= 0.6 && healed.resolvedSelector !== targetSelector) {
        result = await this.run(contents, 
          '(' + fillPageInput.toString() + ')(' + JSON.stringify({ selector: healed.resolvedSelector }) + ',' + JSON.stringify(text) + ',' + Boolean(options.clear) + ')');
        if (!result) wasHealed = true;
      }
    }

    assertPageAction(result);
    if (options.pressEnter) {
      signal?.throwIfAborted();
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      contents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    }
    if (options.expect) {
      const verified = await this.verifyCondition(contents, options.expect, signal);
      if (verified) return { ok: true, status: 'verified', healed: wasHealed || undefined };
      return { ok: true, status: 'unverified', detail: 'Kondisi verifikasi yang diharapkan belum terpenuhi dalam batas waktu.', healed: wasHealed || undefined };
    }
    return { ok: true, healed: wasHealed || undefined };
  }

  async selectOption(target: { elementId?: number; selector?: string }, option: { value?: string; text?: string; index?: number; expect?: ExpectCondition }, signal?: AbortSignal): Promise<{ ok: true; status?: 'verified' | 'unverified'; detail?: string }> {
    const contents = this.getActiveWebContents();
    signal?.throwIfAborted();
    const result = await this.run(contents, 
      '(' + selectPageOption.toString() + ')(' + JSON.stringify(target) + ',' + JSON.stringify(option) + ')'
    );
    assertPageAction(result);
    if (option.expect) {
      const verified = await this.verifyCondition(contents, option.expect, signal);
      if (verified) return { ok: true, status: 'verified' };
      return { ok: true, status: 'unverified', detail: 'Kondisi verifikasi yang diharapkan belum terpenuhi dalam batas waktu.' };
    }
    return { ok: true };
  }

  async setCheckbox(target: { elementId?: number; selector?: string }, checked = true, options: { expect?: ExpectCondition } = {}, signal?: AbortSignal): Promise<{ ok: true; status?: 'verified' | 'unverified'; detail?: string }> {
    const contents = this.getActiveWebContents();
    signal?.throwIfAborted();
    const result = await this.run(contents, 
      '(' + setCheckboxState.toString() + ')(' + JSON.stringify(target) + ',' + Boolean(checked) + ')'
    );
    assertPageAction(result);
    if (options.expect) {
      const verified = await this.verifyCondition(contents, options.expect, signal);
      if (verified) return { ok: true, status: 'verified' };
      return { ok: true, status: 'unverified', detail: 'Kondisi verifikasi yang diharapkan belum terpenuhi dalam batas waktu.' };
    }
    return { ok: true };
  }

  async hover(target: { elementId?: number; selector?: string; text?: string }, signal?: AbortSignal): Promise<void> {
    const contents = this.getActiveWebContents();
    signal?.throwIfAborted();
    const result = await this.run(contents, 
      '(' + hoverPageElement.toString() + ')(' + JSON.stringify(target) + ')'
    );
    assertPageAction(result);
  }

  async pressKey(key: string, signal?: AbortSignal): Promise<void> {
    const contents = this.getActiveWebContents();
    signal?.throwIfAborted();
    contents.sendInputEvent({ type: 'keyDown', keyCode: key });
    contents.sendInputEvent({ type: 'keyUp', keyCode: key });
  }

  async getDOM(options: { format?: 'text' | 'html' | 'outline'; maxLength?: number } = {}): Promise<string> {
    const result = await this.run(this.getActiveWebContents(), 
      '(' + readSafePage.toString() + ')(' + JSON.stringify({ ...options, maxLength: Math.min(Math.max(options.maxLength ?? 30000, 1), 100000) }) + ')');
    return String(result || '');
  }

  async extract(selector: string, maxItems = 50): Promise<Array<{ text: string; tag: string; attributes: Record<string, string> }>> {
    return this.run(this.getActiveWebContents(), 
      '(' + readSafePage.toString() + ')(' + JSON.stringify({ selector, maxItems: Math.min(Math.max(maxItems, 1), 200) }) + ')');
  }

  async inspectForm(options: { formSelector?: string; formElementId?: number } = {}): Promise<ReturnType<typeof inspectPageForms>> {
    const contents = this.getActiveWebContents();
    const result = await this.run(contents, 
      '(' + inspectPageForms.toString() + ')(' + JSON.stringify(options) + ')'
    );
    return result as ReturnType<typeof inspectPageForms>;
  }

  async fillForm(options: {
    formSelector?: string;
    formElementId?: number;
    fields: Record<string, string | number | boolean>;
    submit?: boolean;
    validate?: boolean;
  }, signal?: AbortSignal): Promise<ReturnType<typeof fillPageForm>> {
    const contents = this.getActiveWebContents();
    signal?.throwIfAborted();
    const result = await this.run(contents, 
      '(' + fillPageForm.toString() + ')(' + JSON.stringify(options) + ')'
    );
    return result as ReturnType<typeof fillPageForm>;
  }

  async findElement(options: {
    query: string;
    role?: string;
    tag?: string;
    maxResults?: number;
  }): Promise<ReturnType<typeof findPageElements>> {
    const contents = this.getActiveWebContents();
    const result = await this.run(contents, 
      '(' + findPageElements.toString() + ')(' + JSON.stringify(options) + ')'
    );
    return result as ReturnType<typeof findPageElements>;
  }

  async getState(): Promise<{
    activeTab: BrowserTab | null;
    tabs: BrowserTab[];
    activeProfile: { id: string; name: string; isLocked: boolean };
    taskStatus: string;
    focusedElement: { elementId?: number; tag: string; role?: string; name?: string; id?: string } | null;
    network: { inflightCount: number };
    console: { errorCount: number; warnCount: number };
  }> {
    const tabSnap = this.snapshot();
    const activeTab = tabSnap.tabs.find(t => t.id === this.activeTabId) || null;
    const activeProfile = {
      id: this.profiles.activeProfileId,
      name: this.profiles.getProfile(this.profiles.activeProfileId)?.name || 'Default',
      isLocked: this.profiles.isLocked(this.profiles.activeProfileId),
    };

    let focusedElement: { elementId?: number; tag: string; role?: string; name?: string; id?: string } | null = null;
    try {
      const contents = this.getActiveWebContents();
      if (!contents.isDestroyed() && !contents.isCrashed()) {
        focusedElement = (await this.run(contents, 
          '(' + getPageFocusedElement.toString() + ')()'
        )) as typeof focusedElement;
      }
    } catch {}

    const consoleLogs = this.consoleMonitor.getLogs({ tabId: this.activeTabId });
    const inflightCount = this.network.getInflightCount();

    return {
      activeTab,
      tabs: tabSnap.tabs,
      activeProfile,
      taskStatus: this.profiles.isLocked(this.profiles.activeProfileId) ? 'RUNNING' : 'IDLE',
      focusedElement,
      network: { inflightCount },
      console: {
        errorCount: consoleLogs.summary.errorCount,
        warnCount: consoleLogs.summary.warnCount,
      },
    };
  }

  async healSelector(selector: string, previousTag?: string, contextSnippet?: string) {
    const contents = this.getActiveWebContents();
    return await this.healer.heal(contents, selector, previousTag, contextSnippet);
  }

  async detectChallenge() {
    const contents = this.getActiveWebContents();
    return await detectPageChallenge(contents);
  }

  async uploadFile(target: { elementId?: number; selector?: string }, filePaths: string[] | string): Promise<{ ok: true; fileCount: number; files: string[] }> {
    const pathsArray = Array.isArray(filePaths) ? filePaths : [filePaths];
    const resolvedPaths = pathsArray.map(p => path.resolve(p));
    for (const p of resolvedPaths) {
      if (!existsSync(p)) {
        throw new RpcError('FILE_NOT_FOUND', `File tidak ditemukan di disk host: ${path.basename(p)}`);
      }
    }

    const contents = this.getActiveWebContents();
    let selector = target.selector || '';
    if (target.elementId !== undefined) {
      selector = `[data-hero-id="${target.elementId}"]`;
    }
    if (!selector) {
      selector = 'input[type="file"]';
    }

    if (!contents.debugger.isAttached()) {
      try { contents.debugger.attach('1.3'); } catch {}
    }

    const expr = `document.querySelector(${JSON.stringify(selector)})`;
    const evalRes = (await contents.debugger.sendCommand('Runtime.evaluate', { expression: expr })) as any;
    if (!evalRes || !evalRes.result || evalRes.result.subtype === 'null' || !evalRes.result.objectId) {
      throw new RpcError('ELEMENT_NOT_FOUND', 'Elemen input[type=file] tidak ditemukan pada halaman.');
    }

    await contents.debugger.sendCommand('DOM.setFileInputFiles', {
      files: resolvedPaths,
      objectId: evalRes.result.objectId,
    });

    await this.run(contents, `
      (() => {
        const el = ${expr};
        if (el) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);

    return {
      ok: true,
      fileCount: resolvedPaths.length,
      files: resolvedPaths.map(p => path.basename(p)),
    };
  }

  async waitForDownload(options: { timeoutMs?: number; fileNamePattern?: string } = {}, signal?: AbortSignal) {
    return await this.sessions.getDownloadManager().waitForDownload(options, signal);
  }

  async createCheckpoint(name?: string): Promise<{ ok: true; name: string; url: string; fieldsCount: number; timestamp: number }> {
    const cpName = name || `checkpoint-${Date.now()}`;
    const contents = this.getActiveWebContents();
    const snap = (await this.run(contents, 
      '(' + captureFormCheckpoint.toString() + ')()'
    )) as { url: string; fields: any[] };

    this.checkpoints.set(cpName, {
      url: snap.url,
      timestamp: Date.now(),
      fields: snap.fields,
    });

    return {
      ok: true,
      name: cpName,
      url: snap.url,
      fieldsCount: snap.fields.length,
      timestamp: Date.now(),
    };
  }

  async rollbackCheckpoint(name: string, signal?: AbortSignal): Promise<{ ok: true; name: string; url: string; restoredCount: number }> {
    const cp = this.checkpoints.get(name);
    if (!cp) {
      throw new RpcError('CHECKPOINT_NOT_FOUND', `Checkpoint dengan nama "${name}" tidak ditemukan.`);
    }

    const contents = this.getActiveWebContents();
    const currentUrl = contents.getURL();
    if (currentUrl !== cp.url) {
      this.execute({ action: 'navigate', input: cp.url });
      await this.waitFor({ ms: 500 }, signal);
    }

    signal?.throwIfAborted();
    const res = (await this.run(contents, 
      '(' + restoreFormCheckpoint.toString() + ')(' + JSON.stringify({ fields: cp.fields }) + ')'
    )) as { restoredCount: number };

    return {
      ok: true,
      name,
      url: cp.url,
      restoredCount: res.restoredCount,
    };
  }

  async act(options: {
    intent: 'click' | 'type' | 'select' | 'check' | 'submit' | 'hover';
    target: string;
    text?: string;
    value?: string;
    checked?: boolean;
    expect?: ExpectCondition;
    autoHeal?: boolean;
    autoChallengeIntervention?: boolean;
  }, signal?: AbortSignal): Promise<{
    ok: boolean;
    intent: string;
    targetResolved?: { elementId?: number; name: string; role: string; selector?: string };
    healed?: boolean;
    verified?: boolean;
    challengeDetected?: boolean;
    message: string;
  }> {
    const contents = this.getActiveWebContents();

    const challenge = await detectPageChallenge(contents);
    if (challenge.detected) {
      return {
        ok: false,
        intent: options.intent,
        challengeDetected: true,
        message: `Tantangan bot terdeteksi (${challenge.provider || 'unknown'}: ${challenge.details || ''}). Selesaikan tantangan keamanan atau panggil browser_request_human_intervention terlebih dahulu.`,
      };
    }


    let resolvedElementId: number | undefined;
    let resolvedSelector: string | undefined;
    let resolvedName = '';
    let resolvedRole = '';
    let wasHealed = false;

    const idMatch = options.target.match(/^\[?(\d+)\]?$/);
    if (idMatch) {
      resolvedElementId = parseInt(idMatch[1]!, 10);
    } else {
      const existsDirectly = await this.run(contents, `
        (() => {
          try {
            const el = document.querySelector(${JSON.stringify(options.target)});
            return Boolean(el);
          } catch { return false; }
        })()
      `).catch(() => false);

      if (existsDirectly) {
        resolvedSelector = options.target;
      } else {
        const findRes = await this.findElement({ query: options.target, maxResults: 5 });
        if (findRes.elements.length > 0) {
          const best = findRes.elements[0]!;
          // Never guess between equally good matches: acting on the wrong "Add"/"Delete"
          // button and reporting success is worse than asking the agent to pick.
          const ties = findRes.elements.filter(el => best.score - el.score < 0.05);
          if (ties.length > 1) {
            const list = ties.map(el => `[${el.elementId}] ${el.role} "${el.name}"${el.context ? ` (dekat: ${el.context.slice(0, 60)})` : ''}`).join('; ');
            throw new RpcError('ELEMENT_AMBIGUOUS', `Target "${options.target}" cocok dengan ${ties.length} elemen: ${list}. Ulangi dengan target berupa elementId (mis. "${ties[0]!.elementId}") atau deskripsi yang lebih spesifik.`);
          }
          resolvedElementId = best.elementId;
          resolvedName = best.name;
          resolvedRole = best.role;
          resolvedSelector = best.selector;
        } else if (options.autoHeal !== false) {
          const healed = await this.healer.heal(contents, options.target);
          if (healed && healed.confidence >= 0.6 && healed.resolvedSelector !== options.target) {
            resolvedSelector = healed.resolvedSelector;
            wasHealed = true;
          }
        }
      }
    }

    if (resolvedElementId === undefined && !resolvedSelector) {
      throw new RpcError('ELEMENT_NOT_FOUND', `Target "${options.target}" tidak ditemukan di halaman.`);
    }

    const actionTarget = resolvedElementId !== undefined ? { elementId: resolvedElementId } : { selector: resolvedSelector! };

    let actionResult: any;
    switch (options.intent) {
      case 'click':
        actionResult = await this.click({ ...actionTarget, expect: options.expect }, signal);
        break;
      case 'type':
        actionResult = await this.type(actionTarget, options.text || '', { expect: options.expect }, signal);
        break;
      case 'select':
        actionResult = await this.selectOption(actionTarget, { text: options.value, value: options.value, expect: options.expect }, signal);
        break;
      case 'check':
        actionResult = await this.setCheckbox(actionTarget, options.checked !== undefined ? options.checked : true, { expect: options.expect }, signal);
        break;
      case 'hover':
        await this.hover(actionTarget, signal);
        actionResult = { ok: true, status: 'verified' };
        break;
      case 'submit':
        await this.run(contents, `
          (() => {
            const target = ${resolvedElementId !== undefined ? `document.querySelector('[data-hero-id="${resolvedElementId}"]')` : `document.querySelector(${JSON.stringify(resolvedSelector)})`};
            if (target) {
              const form = target.closest('form') || target;
              if (form instanceof HTMLFormElement) {
                if (typeof form.requestSubmit === 'function') form.requestSubmit();
                else form.submit();
              } else if (typeof target.click === 'function') {
                target.click();
              }
            }
          })()
        `);
        if (options.expect) {
          const verified = await this.verifyCondition(contents, options.expect, signal);
          actionResult = { ok: true, status: verified ? 'verified' : 'unverified' };
        } else {
          actionResult = { ok: true };
        }
        break;
      default:
        throw new RpcError('INVALID_INPUT', `Intent "${options.intent}" tidak dikenali.`);
    }

    return {
      ok: true,
      intent: options.intent,
      targetResolved: {
        elementId: resolvedElementId,
        name: resolvedName || options.target,
        role: resolvedRole || options.intent,
        selector: resolvedSelector,
      },
      healed: wasHealed || undefined,
      verified: actionResult?.status === 'verified',
      message: `Aksi ${options.intent} berhasil dieksekusi pada target "${options.target}".`,
    };
  }

  getConsoleLogs(options: {
    tabId?: string;
    level?: 'info' | 'warn' | 'error' | 'debug' | 'all';
    limit?: number;
    clear?: boolean;
  } = {}) {
    const tabId = options.tabId || this.activeTabId;
    return this.consoleMonitor.getLogs({ ...options, tabId });
  }

  getNetworkActivity(options: {
    filter?: string;
    onlyFailed?: boolean;
    limit?: number;
  } = {}) {
    return this.network.getActivity(options);
  }

  getNetwork(): NetworkIntelligence {
    return this.network;
  }

  async waitFor(options: {
    ms?: number;
    selector?: string;
    text?: string;
    state?: 'visible' | 'hidden' | 'attached' | 'detached';
    networkIdle?: boolean;
    expression?: string;
    timeoutMs?: number;
  }, signal?: AbortSignal): Promise<boolean> {
    if (options.ms && options.ms > 0) {
      await delay(Math.min(options.ms!, 60_000), undefined, { signal });
      return true;
    }
    const timeout = Math.min(Math.max(options.timeoutMs ?? 10_000, 500), 60_000);

    if (options.networkIdle) {
      return await this.network.waitForIdle({ idleTimeMs: 500, timeoutMs: timeout }, signal);
    }

    const contents = this.getActiveWebContents();
    const start = Date.now();
    const state = options.state || 'visible';

    while (Date.now() - start < timeout) {
      signal?.throwIfAborted();
      if (contents.isDestroyed() || contents.isCrashed()) {
        throw new RpcError('PAGE_CRASHED', 'Halaman browser mengalami crash.');
      }

      const conditionMet = await this.run(contents, `
        (() => {
          if (${JSON.stringify(options.expression || '')}) {
            try {
              return Boolean(eval(${JSON.stringify(options.expression)}));
            } catch {
              return false;
            }
          }

          if (${JSON.stringify(options.selector || '')}) {
            const el = document.querySelector(${JSON.stringify(options.selector || '')});
            const state = ${JSON.stringify(state)};
            if (state === 'attached') return Boolean(el);
            if (state === 'detached') return !el;

            if (!el) {
              return state === 'hidden';
            }

            const style = window.getComputedStyle(el);
            const isBodyOrHtml = el === document.body || el === document.documentElement;
            const hasSize = isBodyOrHtml || (el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0);
            const isVisible = style.display !== 'none' &&
                              style.visibility !== 'hidden' &&
                              style.visibility !== 'collapse' &&
                              style.opacity !== '0' &&
                              hasSize;

            if (state === 'visible') return isVisible;
            if (state === 'hidden') return !isVisible;
            return false;
          }

          if (${JSON.stringify(options.text || '')}) {
            return Boolean(document.body && (document.body.innerText || document.body.textContent || '').includes(${JSON.stringify(options.text || '')}));
          }

          return true;
        })()
      `).catch(() => false);

      if (conditionMet) return true;
      await delay(100, undefined, { signal });
    }
    throw new RpcError('TIMEOUT', 'Kondisi yang ditunggu belum terpenuhi.');
  }

  async scroll(options: { direction?: 'up' | 'down' | 'top' | 'bottom'; amount?: number }): Promise<void> {
    const contents = this.getActiveWebContents();
    const dir = options.direction || 'down';
    const amount = options.amount || 500;
    await this.run(contents, `
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
    const rawRows = await this.run(contents, `
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
              try { el = row.querySelector(field.selector); } catch {}
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
    const links = await this.run(contents, `
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
    if (contents.isDestroyed() || contents.isCrashed()) {
      throw new RpcError('PAGE_CRASHED', 'Halaman tidak dapat mengeksekusi skrip karena telah ditutup atau crash.');
    }

    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new RpcError('TIMEOUT', 'Batas waktu eksekusi skrip habis.')), timeoutMs);
    });

    const executeViaCdp = async (): Promise<unknown> => {
      if (!contents.debugger.isAttached()) {
        try { contents.debugger.attach('1.3'); } catch {}
      }
      if (contents.debugger.isAttached()) {
        const res = (await contents.debugger.sendCommand('Runtime.evaluate', {
          expression: script,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
          generatePreview: false,
          replMode: true,
        })) as {
          result?: { type?: string; value?: unknown; subtype?: string; description?: string };
          exceptionDetails?: {
            text?: string;
            exception?: { type?: string; subtype?: string; className?: string; description?: string; value?: unknown };
            lineNumber?: number;
          };
        };

        if (res.exceptionDetails) {
          const className = res.exceptionDetails.exception?.className || '';
          const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text || '';
          if (className === 'SyntaxError' || desc.includes('SyntaxError') || desc.includes('Unexpected token')) {
            throw new RpcError('SCRIPT_SYNTAX_ERROR', 'Sintaks JavaScript tidak valid. Perbaiki skrip sebelum mencoba lagi.');
          }
          throw new RpcError('SCRIPT_EXECUTION_FAILED', 'Eksekusi skrip halaman gagal. Periksa logika skrip dan keadaan halaman.');
        }

        if (res.result) {
          if (res.result.type === 'undefined') return null;
          return res.result.value !== undefined ? res.result.value : null;
        }
      }

      // Fallback: evaluate via contents.executeJavaScript
      return await contents.executeJavaScript(script, true);
    };

    try {
      const result = await Promise.race([executeViaCdp(), timeoutPromise]);
      return result === undefined ? null : result;
    } catch (err) {
      if (err instanceof RpcError) throw err;
      const message = String(err && (err as any).message ? (err as any).message : err);
      if (message.includes('SyntaxError') || message.includes('Unexpected token')) {
        throw new RpcError('SCRIPT_SYNTAX_ERROR', 'Sintaks JavaScript tidak valid. Perbaiki skrip sebelum mencoba lagi.');
      }
      if (message.includes('TIMEOUT') || message.includes('Batas waktu') || message.includes('timed out')) {
        throw new RpcError('TIMEOUT', 'Batas waktu eksekusi skrip habis.');
      }
      throw new RpcError('SCRIPT_EXECUTION_FAILED', 'Eksekusi skrip halaman gagal. Periksa logika skrip dan keadaan halaman.');
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

  async getCookies(options: { url?: string; name?: string; domain?: string } = {}): Promise<{
    cookies: Array<{
      name: string;
      value: string;
      domain?: string;
      path?: string;
      secure?: boolean;
      httpOnly?: boolean;
      sameSite?: string;
      expirationDate?: number;
    }>;
    count: number;
  }> {
    const contents = this.getActiveWebContents();
    const filter: Electron.CookiesGetFilter = {};
    if (options.url) filter.url = options.url;
    else if (contents.getURL()) filter.url = contents.getURL();
    if (options.name) filter.name = options.name;
    if (options.domain) filter.domain = options.domain;

    const rawCookies = await contents.session.cookies.get(filter);
    const cookies = rawCookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      expirationDate: c.expirationDate,
    }));
    return { cookies, count: cookies.length };
  }

  async setCookie(options: {
    url?: string;
    name: string;
    value: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
    expirationDate?: number;
  }): Promise<{ ok: true; name: string; domain?: string }> {
    const contents = this.getActiveWebContents();
    const targetUrl = options.url || contents.getURL();
    if (!targetUrl || !targetUrl.startsWith('http')) {
      throw new RpcError('INVALID_INPUT', 'URL valid (http/https) diperlukan untuk menyetel cookie.');
    }
    const details: Electron.CookiesSetDetails = {
      url: targetUrl,
      name: options.name,
      value: options.value,
      domain: options.domain,
      path: options.path || '/',
      secure: options.secure,
      httpOnly: options.httpOnly,
      sameSite: options.sameSite,
      expirationDate: options.expirationDate,
    };
    try {
      await contents.session.cookies.set(details);
      await contents.session.cookies.flushStore();
      return { ok: true, name: options.name, domain: options.domain };
    } catch (err) {
      throw new RpcError('ACTION_FAILED', `Gagal menyetel cookie "${options.name}": ${(err as any)?.message || String(err)}`);
    }
  }

  async getStorage(options: { type?: 'local' | 'session'; key?: string } = {}): Promise<{
    type: 'local' | 'session';
    entries: Record<string, string>;
    count: number;
  }> {
    const contents = this.getActiveWebContents();
    const storageType = options.type === 'session' ? 'sessionStorage' : 'localStorage';
    const result = (await this.run(contents, `
      (() => {
        try {
          const store = window[${JSON.stringify(storageType)}];
          if (!store) return { entries: {}, count: 0 };
          const keyFilter = ${JSON.stringify(options.key || '')};
          const entries = {};
          if (keyFilter) {
            const val = store.getItem(keyFilter);
            if (val !== null) entries[keyFilter] = val;
          } else {
            for (let i = 0; i < store.length; i++) {
              const k = store.key(i);
              if (k !== null) entries[k] = store.getItem(k) ?? '';
            }
          }
          return { entries, count: Object.keys(entries).length };
        } catch {
          return { entries: {}, count: 0 };
        }
      })()
    `)) as { entries: Record<string, string>; count: number };
    return { type: options.type === 'session' ? 'session' : 'local', entries: result.entries, count: result.count };
  }

  async setStorage(options: {
    type?: 'local' | 'session';
    action?: 'set' | 'remove' | 'clear';
    key?: string;
    value?: string;
  }): Promise<{ ok: true; action: 'set' | 'remove' | 'clear'; type: 'local' | 'session' }> {
    const contents = this.getActiveWebContents();
    const storageType = options.type === 'session' ? 'sessionStorage' : 'localStorage';
    const action = options.action || 'set';
    if (action === 'set' && !options.key) {
      throw new RpcError('INVALID_INPUT', 'Parameter "key" diperlukan untuk aksi set.');
    }
    if (action === 'remove' && !options.key) {
      throw new RpcError('INVALID_INPUT', 'Parameter "key" diperlukan untuk aksi remove.');
    }

    await this.run(contents, `
      (() => {
        const store = window[${JSON.stringify(storageType)}];
        if (!store) throw new Error("Storage tidak tersedia pada halaman ini.");
        const act = ${JSON.stringify(action)};
        const key = ${JSON.stringify(options.key || '')};
        const val = ${JSON.stringify(options.value !== undefined ? options.value : '')};
        if (act === 'set') store.setItem(key, val);
        else if (act === 'remove') store.removeItem(key);
        else if (act === 'clear') store.clear();
      })()
    `).catch(err => {
      throw new RpcError('ACTION_FAILED', `Gagal memodifikasi ${storageType}: ${(err as any)?.message || String(err)}`);
    });

    return { ok: true, action, type: options.type === 'session' ? 'session' : 'local' };
  }

  async dragAndDrop(options: {
    from: { elementId?: number; selector?: string; x?: number; y?: number };
    to: { elementId?: number; selector?: string; x?: number; y?: number };
    steps?: number;
  }, signal?: AbortSignal): Promise<{ ok: true; from: { x: number; y: number }; to: { x: number; y: number } }> {
    const contents = this.getActiveWebContents();
    signal?.throwIfAborted();

    const resolveCoords = async (point: { elementId?: number; selector?: string; x?: number; y?: number }): Promise<{ x: number; y: number }> => {
      if (point.x !== undefined && point.y !== undefined) {
        return { x: point.x, y: point.y };
      }
      const box = (await this.run(contents, 
        '(' + getElementBoundingBox.toString() + ')(' + JSON.stringify({ elementId: point.elementId, selector: point.selector }) + ')'
      )) as { x: number; y: number; width: number; height: number } | null;
      if (!box || box.width <= 0 || box.height <= 0) {
        throw new RpcError('ELEMENT_NOT_FOUND', `Elemen drag/drop tidak ditemukan atau tidak memiliki dimensi.`);
      }
      return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    };

    const start = await resolveCoords(options.from);
    const end = await resolveCoords(options.to);
    const steps = Math.min(Math.max(options.steps || 10, 2), 100);

    if (!contents.debugger.isAttached()) {
      try { contents.debugger.attach('1.3'); } catch {}
    }

    if (contents.debugger.isAttached()) {
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: start.x, y: start.y,
      });
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: start.x, y: start.y, button: 'left', clickCount: 1,
      });
      for (let i = 1; i <= steps; i++) {
        signal?.throwIfAborted();
        const curX = Math.round(start.x + (end.x - start.x) * (i / steps));
        const curY = Math.round(start.y + (end.y - start.y) * (i / steps));
        await contents.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: curX, y: curY, button: 'left', buttons: 1,
        });
        await delay(20, undefined, { signal });
      }
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: end.x, y: end.y, button: 'left',
      });
    } else {
      await this.run(contents, `
        (() => {
          const fromEl = document.elementFromPoint(${start.x}, ${start.y}) || document.body;
          const toEl = document.elementFromPoint(${end.x}, ${end.y}) || document.body;
          fromEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: ${start.x}, clientY: ${start.y}, buttons: 1 }));
          fromEl.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: ${end.x}, clientY: ${end.y}, buttons: 1 }));
          toEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: ${end.x}, clientY: ${end.y} }));
        })()
      `);
    }

    return { ok: true, from: start, to: end };
  }
}
