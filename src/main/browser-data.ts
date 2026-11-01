import { RpcError, assertPageAction } from '../shared/rpc-error';
import { scrollPageArea } from './page-scroll';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { ExtractionSpec, Json } from '../shared/data-contracts';
import { convert, setPath } from './data/processing';
import { NetworkIntelligence } from './data/network-intelligence';
import { BrowserAutomation } from './browser-automation';

/** Console/network diagnostics, waiting, scrolling and structured extraction. */
export abstract class BrowserData extends BrowserAutomation {
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

  /**
   * Scrolls the page, or with elementId/selector/text the nearest scrollable container
   * around that element (e.g. a TikTok comment panel that scrolls separately).
   */
  async scroll(options: { direction?: 'up' | 'down' | 'top' | 'bottom'; amount?: number; elementId?: number; selector?: string; text?: string }):
    Promise<{ ok: true; target: 'page' | 'element'; before: number; after: number; max: number; atStart: boolean; atEnd: boolean }> {
    const result = await this.run(this.getActiveWebContents(), '(' + scrollPageArea.toString() + ')(' + JSON.stringify(options) + ')') as ReturnType<typeof scrollPageArea>;
    if ('error' in result) {
      if (result.error === 'ELEMENT_NOT_FOUND') throw new RpcError('ELEMENT_NOT_FOUND', 'Elemen target scroll tidak ditemukan. Pakai teks yang terlihat di dalam panel (mis. "466 comments") atau elementId dari browser_observe.');
      assertPageAction(result.error);
    }
    return { ok: true, ...(result as Exclude<typeof result, { error: string }>) };
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
}
