import { RpcError, assertPageAction } from '../shared/rpc-error';
import { clickPageElement, fillPageInput, hoverPageElement, selectPageOption, setCheckboxState } from './page-actions';
import { observePage } from './page-observer';
import { inspectPageForms, fillPageForm, findPageElements, getElementBoundingBox } from './page-forms';
import { detectPageChallenge } from './challenge-detector';
import { setTimeout as delay } from 'node:timers/promises';
import { readSafePage } from './page-snapshot';
import { nativeImage } from 'electron';
import { BrowserNavigation } from './browser-navigation';
import type { ExpectCondition } from './browser-base';

/** Screenshots, expectations, semantic observe and element-level page actions. */
export abstract class BrowserPage extends BrowserNavigation {
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

  protected async captureWithCdp(contents: Electron.WebContents): Promise<Electron.NativeImage> {
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
}
