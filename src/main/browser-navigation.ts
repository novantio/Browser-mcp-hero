import { RpcError } from '../shared/rpc-error';
import { setTimeout as delay } from 'node:timers/promises';
import { WebContentsView } from 'electron';
import { alternateScheme, isPopupWindow, isWebUrl, resolveAddress } from '../shared/navigation';
import { STEALTH_SCRIPT } from './stealth';
import { htmlToMarkdown } from './html-to-markdown';
import { detectPageChallenge } from './challenge-detector';
import { BrowserBase } from './browser-base';
import type { TabEntry } from './browser-base';

/** Tab views, navigation with scheme fallback, reload/recovery and the lynx-style text reader. */
export abstract class BrowserNavigation extends BrowserBase {
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

  protected createView(tab: TabEntry): WebContentsView {
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
  protected async loadWithSchemeFallback(
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
  protected loadAttempt(tab: TabEntry, contents: Electron.WebContents, url: string, signal?: AbortSignal): Promise<'failed' | 'settled'> {
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

  protected navigate(input: string): void {
    const url = resolveAddress(input);
    const tab = this.active();
    const view = tab.view ?? this.createView(tab);
    // Load asynchronously so stop, tab switching and further navigation stay responsive.
    void this.loadWithSchemeFallback(tab, view.webContents, url).catch(() => { /* did-fail-load renders a safe error. */ });
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
    url: string; title: string; status?: number; source: 'fetch' | 'live'; markdown: string; links: number; truncated: boolean; hint?: string; challenge?: string;
  }> {
    const tab = this.active();
    const target = options.url ? resolveAddress(options.url) : tab.state.url;
    if (!target || !isWebUrl(target)) throw new RpcError('INVALID_INPUT', 'Berikan url http(s), atau buka halaman terlebih dahulu.');
    const convertOptions = { baseUrl: target, maxLength: options.maxLength, mainOnly: options.mainOnly, includeLinks: options.includeLinks };
    const wantLive = options.source === 'live' || (options.source !== 'fetch' && !options.url);
    if (wantLive && tab.view && !tab.view.webContents.isDestroyed()) {
      try {
        const contents = tab.view.webContents;
        // Bot/AI-detection walls (TikTok puzzles, Cloudflare, reCAPTCHA): retrying makes the
        // site more suspicious, so tell the agent to stop and hand over to the human.
        const challenge = await detectPageChallenge(contents);
        const html = String(await this.run(contents, 'document.documentElement ? document.documentElement.outerHTML : ""', 4000));
        return {
          url: contents.getURL() || target, source: 'live', ...htmlToMarkdown(html, { ...convertOptions, baseUrl: contents.getURL() || target }),
          ...(challenge.detected ? {
            challenge: challenge.provider || 'unknown',
            hint: 'Halaman menampilkan verifikasi/deteksi bot. JANGAN mengulang atau memuat ulang: panggil browser_request_human_intervention agar manusia menyelesaikannya, lalu lanjutkan perlahan.',
          } : {}),
        };
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
    const page = htmlToMarkdown(body, { ...convertOptions, baseUrl: finalUrl });
    // Single-page apps (TikTok, Threads, X, Instagram) ship an empty shell without JavaScript.
    const hint = page.markdown.replace(/\n---\nTautan:[\s\S]*$/, '').trim().length < 300
      ? 'Isi halaman ini dibuat oleh JavaScript. Pakai browser_set_media_mode { mode: "lite" }, browser_navigate ke URL ini, lalu browser_read_text { source: "live" }.'
      : undefined;
    return { url: finalUrl, status: response.status, source: 'fetch', ...page, ...(hint ? { hint } : {}) };
  }
}
