import { createServer } from 'node:http';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { z } from 'zod';
import type { BrowserManager } from './browser-manager';
import type { ProfileManager } from './profile-manager';
import type { TaskManager } from './task-manager';
import type { AuditLogger } from './audit-logger';
import type { DataStore } from './data/store';
import type { JobRunner } from './data/job-runner';
import type { DataAnalysis } from './data/analysis';
import type { InteractionRecorder } from './data/recorder';
import { contractFor } from '../shared/mcp-contracts';
import { dataContractFor } from '../shared/data-contracts';
import { paginate } from './data/analysis';
import { RpcError, publicError } from '../shared/rpc-error';
import { redactText } from '../shared/redaction';

export interface BridgeConfig {
  userDataDir: string;
  browser: BrowserManager;
  profiles: ProfileManager;
  tasks: TaskManager;
  auditLogger?: AuditLogger;
  store?: DataStore;
  jobRunner?: JobRunner;
  analysis?: DataAnalysis;
  recorder?: InteractionRecorder;
}
const envelope = z.object({ method: z.string().min(1).max(100), params: z.record(z.string(), z.unknown()).default({}) }).strict();

function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new RpcError('CANCELLED', 'Operasi dibatalkan.'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export class McpBridge {
  private server: Server | null = null;
  private token = '';
  private filePath = '';
  private browserBusy = false;
  private readonly requests = new Set<AbortController>();
  constructor(private readonly config: BridgeConfig) {}

  async start(): Promise<{ port: number; token: string }> {
    this.token = randomBytes(24).toString('hex');
    this.filePath = path.join(this.config.userDataDir, 'mcp-bridge.json');
    return new Promise((resolve, reject) => {
      const srv = createServer((req, res) => this.handleRequest(req, res));
      srv.on('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const address = srv.address();
        if (!address || typeof address === 'string') { srv.close(); reject(new Error('Bridge tidak tersedia.')); return; }
        this.server = srv;
        try {
          writeFileSync(this.filePath, JSON.stringify({ port: address.port, token: this.token, pid: process.pid, createdAt: Date.now() }), { encoding: 'utf8', mode: 0o600 });
          resolve({ port: address.port, token: this.token });
        } catch (error) { srv.close(); this.server = null; reject(error); }
      });
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method !== 'POST' || req.url !== '/rpc') { res.writeHead(404); res.end('{}'); return; }
    if (req.headers.authorization !== 'Bearer ' + this.token) { res.writeHead(401); res.end('{}'); return; }
    let body = '';
    let tooLarge = false;
    req.setTimeout(10000, () => req.destroy());
    req.on('error', () => {});
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      body += chunk.toString('utf8');
      if (Buffer.byteLength(body) > 2000000) {
        tooLarge = true; res.writeHead(413); res.end('{}'); req.destroy();
      }
    });
    req.on('end', () => {
      if (tooLarge || res.destroyed) return;
      req.setTimeout(0);
      void this.runRequest(body, res);
    });
  }

  private async runRequest(body: string, res: ServerResponse): Promise<void> {
    const controller = new AbortController();
    this.requests.add(controller);
    const timer = setTimeout(() => controller.abort(new RpcError('TIMEOUT', 'Batas waktu operasi habis.')), 65000);
    const disconnected = () => { if (!res.writableEnded) controller.abort(new RpcError('CANCELLED', 'Permintaan dibatalkan.')); };
    res.on('close', disconnected);
    let method = '';
    let params: Record<string, unknown> = {};
    const started = Date.now();
    try {
      let parsed: z.infer<typeof envelope>;
      try { parsed = envelope.parse(JSON.parse(body)); }
      catch { throw new RpcError('INVALID_INPUT', 'Format permintaan tidak valid.'); }
      method = parsed.method;
      const contract = contractFor(method) || dataContractFor(method);
      if (method === 'ping') {
        if (Object.keys(parsed.params).length) throw new RpcError('INVALID_INPUT', 'Ping tidak menerima parameter.');
      } else {
        if (!contract) throw new RpcError('UNKNOWN_METHOD', 'Metode tidak tersedia.');
        const checked = contract.input.safeParse(parsed.params);
        if (!checked.success) throw new RpcError('INVALID_INPUT', 'Parameter tidak sesuai skema tool.');
        params = checked.data;
      }
      const result = await this.dispatch(method, params, controller.signal);
      const valid = contract ? contract.output.safeParse(result) : null;
      if (valid && !valid.success) throw new RpcError('INVALID_OUTPUT', 'Hasil operasi tidak sesuai kontrak.');
      this.log(method, params, 'SUCCESS', started);
      const resultPayload = result === undefined ? null : result;
      if (!res.destroyed) res.end(JSON.stringify({ ok: true, result: resultPayload }));
    } catch (error) {
      const safe = publicError(error);
      this.log(method, params, 'FAILED', started, safe.message);
      if (!res.destroyed) res.end(JSON.stringify({ ok: false, error: safe.message, code: safe.code }));
    } finally {
      clearTimeout(timer); this.requests.delete(controller); res.off('close', disconnected);
    }
  }

  private log(method: string, params: Record<string, unknown>, status: 'SUCCESS' | 'FAILED', started: number, error?: string): void {
    if (!method || method === 'ping') return;
    const taskId = typeof params.taskId === 'string' ? params.taskId : undefined;
    this.config.auditLogger?.log({
      source: 'mcp', action: method, params, status, error, taskId,
      profileId: taskId ? this.config.tasks.getTask(taskId)?.profileId : this.config.profiles.activeProfileId,
      durationMs: Date.now() - started,
    });
  }

  private async dispatch(method: string, params: Record<string, unknown>, requestSignal: AbortSignal): Promise<unknown> {
    const { browser, profiles, tasks, store, jobRunner, analysis, recorder } = this.config;
    const taskId = String(params.taskId || '');
    if (taskId) tasks.touchTask(taskId);
    if (method === 'ping') return { ok: true, activeProfileId: profiles.activeProfileId, tabCount: browser.snapshot().tabs.length };
    if (method === 'profiles.list') return profiles.listProfiles().map(p => ({
      ...p, isActive: p.id === profiles.activeProfileId, isLocked: profiles.isLocked(p.id),
    }));
    if (method === 'profiles.unlock') {
      tasks.forceUnlockProfile(String(params.profileId));
      return { ok: true, profileId: String(params.profileId) };
    }
    if (method === 'tasks.create') {
      const targetProfile = String(params.profileId || profiles.activeProfileId);
      if (params.force) tasks.forceUnlockProfile(targetProfile);
      const ttlSec = params.ttlSeconds !== undefined ? Number(params.ttlSeconds) : 120;
      return tasks.createTask(targetProfile, taskId || undefined, ttlSec);
    }
    if (method === 'tasks.list') return tasks.listTasks();
    if (method === 'tasks.get') {
      const task = tasks.getTask(taskId);
      if (!task) throw new RpcError('TASK_NOT_FOUND', 'Tugas tidak ditemukan.');
      return task;
    }
    if (method === 'tasks.cancel') { tasks.cancelTask(taskId); return tasks.getTask(taskId); }
    if (method === 'tasks.pause') return tasks.pauseTask(taskId);
    if (method === 'tasks.resumeIntervention') return tasks.resumeTask(taskId, params.resumeToken as string | undefined);
    if (method === 'tasks.complete') { tasks.completeTask(taskId); return tasks.getTask(taskId); }
    if (method === 'tasks.requestIntervention') return tasks.requestHumanIntervention(taskId, {
      reason: String(params.reason), message: String(params.message), timeoutMs: params.timeoutMs as number | undefined,
    });

    // Data runtime methods
    if (method === 'data.overview') {
      if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return jobRunner.overview();
    }
    if (method === 'data.createJob') {
      if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return jobRunner.createJob(params as any);
    }
    if (method === 'data.listJobs') {
      if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return jobRunner.listJobs();
    }
    if (method === 'data.runJob') {
      if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return await jobRunner.runJob(String(params.jobId));
    }
    if (method === 'data.pauseJob') {
      if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return jobRunner.pauseJob(String(params.jobId));
    }
    if (method === 'data.resumeJob') {
      if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return await jobRunner.resumeJob(String(params.jobId));
    }
    if (method === 'data.cancelJob') {
      if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return jobRunner.cancelJob(String(params.jobId));
    }
    if (method === 'data.getJob') {
      if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return jobRunner.getJob(String(params.jobId));
    }
    if (method === 'data.results') {
      if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return jobRunner.getResults(params.jobId as string | undefined, params.offset as number | undefined, params.limit as number | undefined);
    }
    if (method === 'data.history') {
      if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return jobRunner.getHistory(String(params.jobId), params.offset as number | undefined, params.limit as number | undefined);
    }
    if (method === 'data.changes') {
      if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return jobRunner.getChanges(String(params.jobId), params.offset as number | undefined, params.limit as number | undefined);
    }
    if (method === 'data.compare') {
      if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return analysis.compare(String(params.beforeId), String(params.afterId));
    }
    if (method === 'data.recordStart') {
      if (!recorder) throw new RpcError('SERVICE_UNAVAILABLE', 'Recorder belum aktif.');
      return await recorder.start(String(params.name));
    }
    if (method === 'data.recordStop') {
      if (!recorder) throw new RpcError('SERVICE_UNAVAILABLE', 'Recorder belum aktif.');
      return await recorder.stop();
    }
    if (method === 'data.recordList') {
      if (!recorder) throw new RpcError('SERVICE_UNAVAILABLE', 'Recorder belum aktif.');
      return recorder.list();
    }
    if (method === 'data.recordUpdate') {
      if (!recorder) throw new RpcError('SERVICE_UNAVAILABLE', 'Recorder belum aktif.');
      return recorder.update(String(params.recordingId), params.steps as any);
    }
    if (method === 'data.recordConvert') {
      if (!recorder) throw new RpcError('SERVICE_UNAVAILABLE', 'Recorder belum aktif.');
      return recorder.convert(String(params.recordingId), params.schema as any, String(params.name), (params.intervalMinutes as number | null) ?? null);
    }
    if (method === 'data.buildDataset') {
      if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return analysis.build(params as any);
    }
    if (method === 'data.listDatasets') {
      if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return analysis.store.list('dataset').map((d: any) => analysis!.summary(d));
    }
    if (method === 'data.quality') {
      if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      const d = analysis.store.get('dataset', String(params.datasetId)) as any;
      return d.metrics;
    }
    if (method === 'data.datasetRows') {
      if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      const d = analysis.store.get('dataset', String(params.datasetId)) as any;
      return paginate(d.rows, Number(params.offset || 0), Number(params.limit || 50));
    }
    if (method === 'data.exportDataset') {
      if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return await analysis.export(String(params.datasetId), params.format as any);
    }
    if (method === 'data.search') {
      if (!store) throw new RpcError('SERVICE_UNAVAILABLE', 'Data store belum aktif.');
      return store.records(params as any);
    }
    if (method === 'data.entityCandidates') {
      if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return analysis.candidates(String(params.alias));
    }
    if (method === 'data.entityLink') {
      if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return analysis.link(params as any);
    }
    if (['data.get_activity_timeline', 'data.get_trends', 'data.detect_anomalies', 'data.compare_entities'].includes(method)) {
      if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return analysis.analytics(params as any);
    }
    if (method === 'data.graph') {
      if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return analysis.graph(params as any);
    }
    if (method === 'data.setEmbeddings') {
      if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return analysis.embeddings(String(params.model), params.items as any);
    }
    if (method === 'data.semantic') {
      if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return analysis.semantic(String(params.model), params.vector as any, Number(params.limit || 20));
    }
    if (method === 'data.networkRequests') {
      if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return jobRunner.network.getRequests(String(params.filter || ''), params.limit ? Number(params.limit) : 50);
    }
    if (method === 'data.networkRecipe') {
      if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return jobRunner.network.getRecipe(params.requestId ? String(params.requestId) : undefined);
    }
    if (method === 'data.networkReplay') {
      if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return await jobRunner.network.replayRecipe(String(params.recipeId), (params.params as any) || {});
    }
    if (method === 'data.frontierPush') {
      if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return jobRunner.frontier.push(params.urls as string[], Number(params.depth || 0), Number(params.priority || 50));
    }
    if (method === 'data.frontierPop') {
      if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return jobRunner.frontier.popBatch(Number(params.limit || 10));
    }
    if (method === 'data.frontierStats') {
      if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return jobRunner.frontier.getStats();
    }
    if (method === 'data.reviewList') {
      if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return jobRunner.reviewQueue.listItems((params.status as any) || 'pending', Number(params.limit || 50));
    }
    if (method === 'data.reviewResolve') {
      if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      return jobRunner.reviewQueue.resolveItem(String(params.reviewId), params.resolution as any, params.editedData as any);
    }
    if (method === 'data.lineage') {
      if (!store) throw new RpcError('SERVICE_UNAVAILABLE', 'Data store belum aktif.');
      return store.getLineage(String(params.recordId));
    }
    if (method === 'data.checkDrift') {
      if (!jobRunner || !store) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
      const latestSnaps = store.list<any>('snapshot').filter((s: any) => s.jobId === String(params.jobId)) || [];
      const rows = latestSnaps.length > 0 ? latestSnaps[0].rows : [];
      return jobRunner.drift.checkDrift(String(params.jobId), params.schema as any, rows);
    }

    if (['data.extractSchema', 'data.discover', 'data.extractMultiStrategy', 'data.collect', 'data.healSelector', 'data.copilotSynthesize'].includes(method)) {
      if (this.browserBusy) throw new RpcError('BROWSER_BUSY', 'Tunggu operasi browser yang sedang berjalan.');
      const task = tasks.assertRunnable(taskId);
      if (profiles.activeProfileId !== task.profileId) {
        throw new RpcError('TASK_PROFILE_MISMATCH', 'Aktifkan profil milik tugas sebelum menjalankan perintah.');
      }
      const signal = AbortSignal.any([requestSignal, tasks.signal(taskId)]);
      signal.throwIfAborted();
      this.browserBusy = true;
      const work = (async () => {
        if (method === 'data.extractSchema') return await browser.extractSchema(params.schema as any);
        if (method === 'data.discover') return await browser.discoverLinks(params.keyword as string | undefined, params.limit as number | undefined);
        if (method === 'data.extractMultiStrategy') {
          if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
          return await jobRunner.extractor.extract(browser.getActiveWebContents(), params.schema as any, (params.strategy as any) || 'auto', Number(params.minConfidence || 0.5));
        }
        if (method === 'data.collect') {
          if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
          return await jobRunner.collector.collect(browser.getActiveWebContents(), params.schema as any, Number(params.maxItems || 100), Number(params.maxScrolls || 20), Number(params.timeoutMs || 60000), (params.terminationCondition as any) || 'no_new_items');
        }
        if (method === 'data.healSelector') {
          if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
          return await jobRunner.healer.heal(browser.getActiveWebContents(), String(params.selector), params.previousTag ? String(params.previousTag) : undefined, params.contextSnippet ? String(params.contextSnippet) : undefined);
        }
        if (method === 'data.copilotSynthesize') {
          if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
          return await jobRunner.copilot.synthesize(browser.getActiveWebContents(), String(params.targetUrl), params.goalContract as any);
        }
        return null;
      })();
      void work.finally(() => { this.browserBusy = false; }).catch(() => {});
      return await untilAborted(work, signal);
    }

    if (this.browserBusy) throw new RpcError('BROWSER_BUSY', 'Tunggu operasi browser yang sedang berjalan.');
    let signal = requestSignal;
    if (method !== 'profiles.create') {
      const task = tasks.assertRunnable(taskId);
      if (method === 'profiles.switch') {
        if (params.profileId !== task.profileId) throw new RpcError('TASK_PROFILE_MISMATCH', 'Profil tujuan bukan milik tugas ini.');
      } else if (profiles.activeProfileId !== task.profileId) {
        throw new RpcError('TASK_PROFILE_MISMATCH', 'Aktifkan profil milik tugas sebelum menjalankan perintah.');
      }
      signal = AbortSignal.any([requestSignal, tasks.signal(taskId)]);
    }
    signal.throwIfAborted();
    this.browserBusy = true;
    const work = this.browserAction(method, params, signal);
    // Keep the gate until a dispatched action actually settles. Cancellation
    // cannot undo a click already delivered to a page.
    void work.finally(() => { this.browserBusy = false; }).catch(() => {});
    try { return await untilAborted(work, signal); }
    catch (error) {
      if (requestSignal.aborted && tasks.getTask(taskId)?.status === 'RUNNING') tasks.cancelTask(taskId);
      throw error;
    }
  }

  private async browserAction(method: string, p: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const { browser, profiles } = this.config;
    const tabs = () => browser.snapshot().tabs.map(tab => ({ ...tab, url: redactText(tab.url), error: tab.error ? 'Halaman gagal dimuat.' : null }));
    const tabId = String(p.tabId || '');
    if (['tabs.close', 'tabs.switch'].includes(method) && !browser.snapshot().tabs.some(t => t.id === tabId))
      throw new RpcError('TAB_NOT_FOUND', 'Tab tidak ada pada profil tugas.');
    switch (method) {
      case 'profiles.create': browser.createProfile(String(p.name)); return { activeProfileId: profiles.activeProfileId };
      case 'profiles.switch': browser.switchProfile(String(p.profileId)); return { activeProfileId: profiles.activeProfileId };
      case 'tabs.list': return tabs();
      case 'tabs.new':
        browser.newTab(); if (p.url) browser.execute({ action: 'navigate', input: String(p.url) }); return tabs();
      case 'tabs.close': browser.execute({ action: 'close-tab', tabId }); return tabs();
      case 'tabs.switch': browser.execute({ action: 'switch-tab', tabId }); return tabs();
      case 'tabs.navigate': {
        browser.execute({ action: 'navigate', input: String(p.url) });
        if (p.expect) {
          const verified = await browser.verifyCondition(browser.getActiveWebContents(), p.expect as any, signal);
          return { url: redactText(String(p.url)), status: verified ? 'verified' : 'unverified' };
        }
        return { url: redactText(String(p.url)) };
      }
      case 'tabs.reload': browser.execute({ action: 'reload' }); break;
      case 'tabs.back': browser.execute({ action: 'back' }); break;
      case 'tabs.forward': browser.execute({ action: 'forward' }); break;
      case 'automation.observe':
        return await browser.observe({ maxLength: p.maxLength as number | undefined });
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
      case 'automation.detectChallenge':
        return await browser.detectChallenge();
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
      case 'automation.act':
        return await browser.act(p as any, signal);
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
  stop(): void {
    for (const controller of this.requests) controller.abort(new RpcError('CANCELLED', 'Browser ditutup.'));
    this.server?.close(); this.server = null;
    if (this.filePath && existsSync(this.filePath)) { try { unlinkSync(this.filePath); } catch { /* Already closed. */ } }
  }
}
