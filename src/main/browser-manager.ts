import { RpcError } from '../shared/rpc-error';
import { getElementBoundingBox } from './page-forms';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { BrowserData } from './browser-data';

export type { ExpectCondition } from './browser-base';
import type { MediaMode } from './media-filter';

/** Public browser runtime used by the app, MCP bridge and data jobs. Each layer lives in its own file:
 * base -> navigation -> page -> automation -> data -> manager. */
export class BrowserManager extends BrowserData {
  /**
   * Lite mode for every profile: pages and their JavaScript still run (comments, threads,
   * search results load) but images, video, audio and web fonts are not downloaded.
   * The active page is reloaded so the change is visible at once.
   */
  async setMediaMode(mode: MediaMode, options: { reload?: boolean } = {}, signal?: AbortSignal): Promise<{ mode: MediaMode; blockedRequests: number; reloaded: boolean }> {
    this.sessions.media.setMode(mode);
    const tab = this.active();
    const reloaded = options.reload !== false && Boolean(tab.state.url && tab.view);
    // Hard reload: images still in Chromium's memory cache never reach webRequest, so a
    // normal reload would keep showing them.
    if (reloaded) await this.reloadTab({ hard: true }, signal);
    this.emit();
    return { mode, blockedRequests: this.sessions.media.blockedCount(), reloaded };
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
