import { RpcError } from '../shared/rpc-error';
import { getPageFocusedElement, captureFormCheckpoint, restoreFormCheckpoint } from './page-forms';
import { detectPageChallenge } from './challenge-detector';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { BrowserTab } from '../shared/types';
import { BrowserPage } from './browser-page';
import type { ExpectCondition } from './browser-base';

/** High-level act(), uploads/downloads, checkpoints, healing and challenge detection. */
export abstract class BrowserAutomation extends BrowserPage {
  abstract waitFor(options: { ms?: number; selector?: string; text?: string; state?: 'visible' | 'hidden' | 'attached' | 'detached'; networkIdle?: boolean; expression?: string; timeoutMs?: number }, signal?: AbortSignal): Promise<boolean>;

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
}
