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
import { RpcError, publicError } from '../shared/rpc-error';
import { dispatchDataMethod, NOT_DATA_METHOD } from './mcp-data-dispatch';
import { runBrowserAction } from './mcp-browser-actions';

import type { SessionManager } from './session-manager';
import type { SocialAccountInfo } from '../shared/profiles';

export interface BridgeConfig {
  engineUpdater?: import('./engine-updater').EngineUpdater;
  userDataDir: string;
  browser: BrowserManager;
  profiles: ProfileManager;
  tasks: TaskManager;
  sessions?: SessionManager;
  auditLogger?: AuditLogger;
  store?: DataStore;
  jobRunner?: JobRunner;
  analysis?: DataAnalysis;
  recorder?: InteractionRecorder;
  /** Rebuilds and relaunches the app; used when the browser is stuck beyond tab recovery. */
  restartApp?: () => void;
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
    if (method === 'engine.status' || method === 'engine.check') {
      if (!this.config.engineUpdater) throw new RpcError('ENGINE_UNAVAILABLE', 'Pengelola pembaruan belum tersedia.');
      if (method === 'engine.check') void this.config.engineUpdater.check();
      return this.config.engineUpdater.snapshot();
    }
    if (method === 'app.restart') {
      // Deliberately ignores browserBusy: restarting is the way out of a stuck browser.
      if (!this.config.restartApp) throw new RpcError('SERVICE_UNAVAILABLE', 'Restart tidak tersedia pada mode ini.');
      setTimeout(() => this.config.restartApp?.(), 300);
      return { ok: true, restarting: true, message: 'Hero Browser sedang di-restart. Tunggu ±10-30 detik, lalu mulai task baru dengan browser_start_task.' };
    }
    const taskId = String(params.taskId || '');
    if (taskId) tasks.touchTask(taskId);
    if (method === 'ping') return { ok: true, activeProfileId: profiles.activeProfileId, tabCount: browser.snapshot().tabs.length };
    if (method === 'profiles.list') {
      const sessionMgr = this.config.sessions || (typeof (browser as any).getSessions === 'function' ? (browser as any).getSessions() : null);
      const list = profiles.listProfiles();
      return await Promise.all(list.map(async p => {
        let loggedInServices: string[] = [];
        let socialAccounts: SocialAccountInfo[] = [];
        if (sessionMgr) {
          try {
            socialAccounts = await sessionMgr.getSocialLogins(p.id);
            loggedInServices = socialAccounts.filter(a => a.loggedIn).map(a => a.platform);
          } catch {
            // ignore
          }
        }
        return {
          ...p,
          isActive: p.id === profiles.activeProfileId,
          isLocked: profiles.isLocked(p.id),
          loggedInServices,
          socialAccounts,
        };
      }));
    }
    if (method === 'profiles.getLogins') {
      const sessionMgr = this.config.sessions || (typeof (browser as any).getSessions === 'function' ? (browser as any).getSessions() : null);
      const targetProfileId = params.profileId ? String(params.profileId) : undefined;
      const targetProfiles = targetProfileId ? [profiles.requireProfile(targetProfileId)] : profiles.listProfiles();

      const recommendations: Record<string, string> = {};
      const profileSummaries = await Promise.all(targetProfiles.map(async p => {
        let loggedInServices: string[] = [];
        let socialAccounts: SocialAccountInfo[] = [];
        if (sessionMgr) {
          try {
            socialAccounts = await sessionMgr.getSocialLogins(p.id);
            loggedInServices = socialAccounts.filter(a => a.loggedIn).map(a => a.platform);
          } catch {
            // ignore
          }
        }
        for (const s of loggedInServices) {
          if (!recommendations[s]) {
            recommendations[s] = p.id;
          }
        }
        return {
          profileId: p.id,
          profileName: p.name,
          isActive: p.id === profiles.activeProfileId,
          loggedInServices,
          socialAccounts,
        };
      }));

      return {
        profiles: profileSummaries,
        recommendations,
      };
    }

    if (method === 'profiles.unlock') {
      tasks.forceUnlockProfile(String(params.profileId));
      return { ok: true, profileId: String(params.profileId) };
    }
    if (method === 'tasks.create') {
      const targetProfile = String(params.profileId || profiles.activeProfileId);
      if (params.force) tasks.forceUnlockProfile(targetProfile);
      const ttlSec = params.ttlSeconds !== undefined ? Number(params.ttlSeconds) : 600;
      const retentionSec = params.retentionSeconds !== undefined ? Number(params.retentionSeconds) : 1800;
      return tasks.createTask(targetProfile, taskId || undefined, ttlSec, retentionSec);
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

    const dataResult = await dispatchDataMethod(this.config, method, params);
    if (dataResult !== NOT_DATA_METHOD) return dataResult;

    if (['data.extractSchema', 'data.discover', 'data.extractMultiStrategy', 'data.collect', 'data.healSelector', 'data.copilotSynthesize'].includes(method)) {
      if (this.browserBusy) throw new RpcError('BROWSER_BUSY', 'Tunggu operasi browser yang sedang berjalan.');
      const task = tasks.assertRunnable(taskId);
      if (profiles.activeProfileId !== task.profileId) {
        throw new RpcError('TASK_PROFILE_MISMATCH', 'Profil task belum aktif di jendela browser. Panggil browser_switch_profile { taskId, profileId } dulu, lalu ulangi perintah.');
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
    // Profile housekeeping is not tied to a task; ProfileManager still refuses locked profiles.
    if (!['profiles.create', 'profiles.duplicate', 'profiles.rename', 'profiles.delete'].includes(method)) {
      const task = tasks.assertRunnable(taskId);
      if (method === 'profiles.switch') {
        if (params.profileId !== task.profileId) throw new RpcError('TASK_PROFILE_MISMATCH', 'Profil tujuan bukan milik tugas ini.');
      } else if (profiles.activeProfileId !== task.profileId) {
        throw new RpcError('TASK_PROFILE_MISMATCH', 'Profil task belum aktif di jendela browser. Panggil browser_switch_profile { taskId, profileId } dulu, lalu ulangi perintah.');
      }
      signal = AbortSignal.any([requestSignal, tasks.signal(taskId)]);
    }
    signal.throwIfAborted();
    this.browserBusy = true;
    const work = runBrowserAction(this.config, method, params, signal);
    // Keep the gate until a dispatched action actually settles. Cancellation
    // cannot undo a click already delivered to a page.
    void work.finally(() => { this.browserBusy = false; }).catch(() => {});
    try { return await untilAborted(work, signal); }
    catch (error) {
      if (requestSignal.aborted && tasks.getTask(taskId)?.status === 'RUNNING') tasks.cancelTask(taskId);
      throw error;
    }
  }
  stop(): void {
    for (const controller of this.requests) controller.abort(new RpcError('CANCELLED', 'Browser ditutup.'));
    this.server?.close(); this.server = null;
    if (this.filePath && existsSync(this.filePath)) { try { unlinkSync(this.filePath); } catch { /* Already closed. */ } }
  }
}
