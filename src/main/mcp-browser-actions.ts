import { RpcError } from '../shared/rpc-error';
import { redactText } from '../shared/redaction';
import type { BridgeConfig } from './mcp-bridge';

/** Executes one task-scoped browser RPC method against the live BrowserManager. */
export async function runBrowserAction(config: BridgeConfig, method: string, p: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const { browser, profiles, tasks } = config;
  const taskId = String(p.taskId || '');
  const tabs = () => browser.snapshot().tabs.map(tab => ({
    ...tab,
    url: redactText(tab.url),
    error: tab.error ? 'Halaman gagal dimuat.' : null,
    certificateWarning: tab.certificateWarning ? { requestId: tab.certificateWarning.requestId, host: redactText(tab.certificateWarning.host), url: redactText(tab.certificateWarning.url) } : tab.certificateWarning ?? null,
  }));

  const tabId = String(p.tabId || '');
  if (['tabs.close', 'tabs.switch'].includes(method) && !browser.snapshot().tabs.some(t => t.id === tabId))
    throw new RpcError('TAB_NOT_FOUND', 'Tab tidak ada pada profil tugas.');
  switch (method) {
    case 'profiles.create': {
      const profileId = browser.createProfile(String(p.name), { switchTo: p.switchTo === true });
      return { activeProfileId: profiles.activeProfileId, profileId };
    }
    case 'profiles.duplicate':
      return await browser.duplicateProfile(String(p.profileId), { name: p.name as string | undefined, copyLogin: p.copyLogin as boolean | undefined, switchTo: p.switchTo === true });
    case 'profiles.rename':
      browser.renameProfile(String(p.profileId), String(p.name));
      return { ok: true, profileId: String(p.profileId), name: profiles.requireProfile(String(p.profileId)).name };
    case 'profiles.delete':
      await browser.deleteProfile(String(p.profileId));
      return { ok: true, profileId: String(p.profileId), activeProfileId: profiles.activeProfileId };
    case 'profiles.switch': browser.switchProfile(String(p.profileId)); return { activeProfileId: profiles.activeProfileId };
    case 'tabs.list': return tabs();
    case 'tabs.new':
      browser.newTab(); if (p.url) browser.execute({ action: 'navigate', input: String(p.url) }); return tabs();
    case 'tabs.close': browser.execute({ action: 'close-tab', tabId }); return tabs();
    case 'tabs.switch': browser.execute({ action: 'switch-tab', tabId }); return tabs();
    case 'tabs.navigate': {
      const targetUrl = String(p.url);
      const resolvedUrl = typeof (browser as any).navigateToUrl === 'function'
        ? await (browser as any).navigateToUrl(targetUrl, signal)
        : (() => { browser.execute({ action: 'navigate', input: targetUrl }); return targetUrl; })();
      const activeTab = browser.snapshot().tabs.find(t => t.id === browser.snapshot().activeTabId);
      const certWarning = activeTab?.certificateWarning ?? null;
      if (certWarning) {
        return {
          url: redactText(String(resolvedUrl)),
          status: 'certificate_warning',
          certificateWarning: { host: redactText(certWarning.host) },
          hint: 'Sertifikat TLS tidak valid. Setujui lewat UI Hero Browser untuk melanjutkan.',
        };
      }
      if (p.expect) {
        const verified = await browser.verifyCondition(browser.getActiveWebContents(), p.expect as any, signal);
        return { url: redactText(String(resolvedUrl)), status: verified ? 'verified' : 'unverified' };
      }
      return { url: redactText(String(resolvedUrl)) };
    }
    case 'tabs.reload':
      return await browser.reloadTab({ hard: p.hard as boolean | undefined, force: p.force as boolean | undefined }, signal);
    case 'tabs.back': browser.execute({ action: 'back' }); break;
    case 'tabs.forward': browser.execute({ action: 'forward' }); break;
    case 'automation.observe':
      return await browser.observe({ maxLength: p.maxLength as number | undefined, format: p.format as 'text' | 'json' | 'both' | undefined });
    case 'automation.readText': {
      const page = await browser.readText({
        url: p.url as string | undefined, source: p.source as 'auto' | 'fetch' | 'live' | undefined,
        maxLength: p.maxLength as number | undefined, mainOnly: p.mainOnly as boolean | undefined, includeLinks: p.includeLinks as boolean | undefined,
      }, signal);
      return { ...page, url: redactText(page.url) };
    }
    case 'automation.click':
      if (Number(Boolean(p.selector)) + Number(Boolean(p.text)) + Number(p.elementId !== undefined) !== 1)
        throw new RpcError('INVALID_INPUT', 'Berikan tepat satu target klik.');
      return (await browser.click({ elementId: p.elementId as number | undefined, selector: p.selector as string | undefined, text: p.text as string | undefined, expect: p.expect as any }, signal)) || { ok: true };
    case 'automation.type':
      if (Number(Boolean(p.selector)) + Number(p.elementId !== undefined) !== 1)
        throw new RpcError('INVALID_INPUT', 'Berikan tepat satu target ketik.');
      return (await browser.type(p.elementId !== undefined ? { elementId: p.elementId as number } : String(p.selector), String(p.text), { clear: Boolean(p.clear), pressEnter: Boolean(p.pressEnter), expect: p.expect as any }, signal)) || { ok: true };
    case 'automation.selectOption':
      if (Number(Boolean(p.selector)) + Number(p.elementId !== undefined) !== 1)
        throw new RpcError('INVALID_INPUT', 'Berikan tepat satu target select.');
      return (await browser.selectOption(
        p.elementId !== undefined ? { elementId: p.elementId as number } : { selector: String(p.selector) },
        { value: p.value as string | undefined, text: p.text as string | undefined, index: p.index as number | undefined, expect: p.expect as any },
        signal
      )) || { ok: true };
    case 'automation.check':
      if (Number(Boolean(p.selector)) + Number(p.elementId !== undefined) !== 1)
        throw new RpcError('INVALID_INPUT', 'Berikan tepat satu target checkbox.');
      return (await browser.setCheckbox(
        p.elementId !== undefined ? { elementId: p.elementId as number } : { selector: String(p.selector) },
        p.checked !== undefined ? Boolean(p.checked) : true,
        { expect: p.expect as any },
        signal
      )) || { ok: true };
    case 'automation.hover':
      if (Number(Boolean(p.selector)) + Number(Boolean(p.text)) + Number(p.elementId !== undefined) !== 1)
        throw new RpcError('INVALID_INPUT', 'Berikan tepat satu target hover.');
      await browser.hover({ elementId: p.elementId as number | undefined, selector: p.selector as string | undefined, text: p.text as string | undefined }, signal);
      break;
    case 'automation.pressKey': await browser.pressKey(String(p.key), signal); break;
    case 'automation.getDOM': return browser.getDOM({ format: p.format as 'text' | 'html' | 'outline' | undefined, maxLength: p.maxLength as number | undefined });
    case 'automation.inspectForm':
      return await browser.inspectForm({
        formSelector: p.formSelector as string | undefined,
        formElementId: p.formElementId as number | undefined,
      });
    case 'automation.fillForm':
      return await browser.fillForm({
        formSelector: p.formSelector as string | undefined,
        formElementId: p.formElementId as number | undefined,
        fields: (p.fields as Record<string, string | number | boolean>) || {},
        submit: p.submit as boolean | undefined,
        validate: p.validate as boolean | undefined,
      }, signal);
    case 'automation.findElement':
      return await browser.findElement({
        query: String(p.query || ''),
        role: p.role as string | undefined,
        tag: p.tag as string | undefined,
        maxResults: p.maxResults as number | undefined,
      });
    case 'automation.getState':
      return await browser.getState();
    case 'automation.extract': return browser.extract(String(p.selector), p.maxItems as number | undefined);
    case 'automation.screenshot':
      return await browser.captureScreenshot({
        elementId: p.elementId as number | undefined,
        selector: p.selector as string | undefined,
        region: p.region as { x: number; y: number; width: number; height: number } | undefined,
      });
    case 'automation.getConsoleLogs':
      return browser.getConsoleLogs({
        level: p.level as 'info' | 'warn' | 'error' | 'debug' | 'all' | undefined,
        limit: p.limit as number | undefined,
        clear: p.clear as boolean | undefined,
      });
    case 'automation.getNetworkActivity':
      return browser.getNetworkActivity({
        filter: p.filter as string | undefined,
        onlyFailed: p.onlyFailed as boolean | undefined,
        limit: p.limit as number | undefined,
      });
    case 'automation.waitFor': {
      const primaryConditions = [p.ms, p.selector, p.text, p.networkIdle, p.expression].filter(v => v !== undefined && v !== false);
      if (primaryConditions.length !== 1) {
        throw new RpcError('INVALID_INPUT', 'Berikan tepat satu kondisi tunggu (ms, selector, text, networkIdle, atau expression).');
      }
      if (p.state !== undefined && p.selector === undefined) {
        throw new RpcError('INVALID_INPUT', 'Parameter state hanya berlaku ketika selector ditentukan.');
      }
      return browser.waitFor({
        ms: p.ms as number | undefined,
        selector: p.selector as string | undefined,
        text: p.text as string | undefined,
        state: p.state as 'visible' | 'hidden' | 'attached' | 'detached' | undefined,
        networkIdle: p.networkIdle ? Boolean(p.networkIdle) : undefined,
        expression: p.expression as string | undefined,
        timeoutMs: p.timeoutMs as number | undefined,
      }, signal);
    }
    case 'automation.scroll': await browser.scroll({ direction: p.direction as 'up' | 'down' | 'top' | 'bottom' | undefined, amount: p.amount as number | undefined }); break;
    case 'automation.evaluate': return await browser.evaluateSafe(String(p.script));
    case 'browser.setVisibility': browser.setVisibility(Boolean(p.visible)); break;
    case 'automation.healSelector':
      return await browser.healSelector(
        String(p.selector),
        p.previousTag as string | undefined,
        p.contextSnippet as string | undefined
      );
    case 'automation.detectChallenge': {
      const result = await browser.detectChallenge();
      if (result.detected && p.autoIntervene && taskId) {
        const req = tasks.requestHumanIntervention(taskId, {
          reason: `Tantangan Keamanan (${result.provider || 'CAPTCHA'}) Terdeteksi`,
          message: result.details || 'Tantangan keamanan (CAPTCHA TikTok/Cloudflare/dll) terdeteksi di browser. Silakan selesaikan tantangan di layar browser, lalu klik Lanjutkan.',
        });
        return {
          ...result,
          status: 'human_required',
          taskId: req.taskId,
          resumeToken: req.resumeToken,
        };
      }
      return result;
    }
    case 'automation.uploadFile':
      if (Number(Boolean(p.selector)) + Number(p.elementId !== undefined) !== 1) {
        throw new RpcError('INVALID_INPUT', 'Berikan tepat satu target upload.');
      }
      return await browser.uploadFile(
        { elementId: p.elementId as number | undefined, selector: p.selector as string | undefined },
        p.filePaths as string[]
      );
    case 'automation.waitForDownload':
      return await browser.waitForDownload(
        { timeoutMs: p.timeoutMs as number | undefined, fileNamePattern: p.fileNamePattern as string | undefined },
        signal
      );
    case 'automation.createCheckpoint':
      return await browser.createCheckpoint(p.name as string | undefined);
    case 'automation.rollbackCheckpoint':
      return await browser.rollbackCheckpoint(String(p.name), signal);
    case 'automation.act': {
      const actRes = await browser.act(p as any, signal);
      if (actRes.challengeDetected && p.autoChallengeIntervention !== false && taskId) {
        try {
          const req = tasks.requestHumanIntervention(taskId, {
            reason: `Tantangan Bot / CAPTCHA Terdeteksi saat Aksi`,
            message: actRes.message || 'Tantangan bot/CAPTCHA terdeteksi di layar. Silakan selesaikan CAPTCHA di browser lalu klik Lanjutkan.',
          });
          return {
            ...actRes,
            status: 'human_required',
            resumeToken: req.resumeToken,
            message: `${actRes.message} Tugas dialihkan ke intervensi manusia (human_required). Pengguna sedang menyelesaikan CAPTCHA di browser.`,
          };
        } catch {
          // ignore if task is already in intervention or completed
        }
      }
      return actRes;
    }

    case 'cookies.get':
      return await browser.getCookies({
        url: p.url as string | undefined,
        name: p.name as string | undefined,
        domain: p.domain as string | undefined,
      });
    case 'cookies.set':
      return await browser.setCookie({
        url: p.url as string | undefined,
        name: String(p.name),
        value: String(p.value),
        domain: p.domain as string | undefined,
        path: p.path as string | undefined,
        secure: p.secure as boolean | undefined,
        httpOnly: p.httpOnly as boolean | undefined,
        sameSite: p.sameSite as any,
        expirationDate: p.expirationDate as number | undefined,
      });
    case 'storage.get':
      return await browser.getStorage({
        type: (p.type as 'local' | 'session') || 'local',
        key: p.key as string | undefined,
      });
    case 'storage.set':
      return await browser.setStorage({
        type: (p.type as 'local' | 'session') || 'local',
        action: (p.action as 'set' | 'remove' | 'clear') || 'set',
        key: p.key as string | undefined,
        value: p.value !== undefined ? String(p.value) : undefined,
      });
    case 'automation.dragAndDrop':
      return await browser.dragAndDrop(p as any, signal);
    default: throw new RpcError('UNKNOWN_METHOD', 'Metode tidak tersedia.');
  }
  return { ok: true };
}
