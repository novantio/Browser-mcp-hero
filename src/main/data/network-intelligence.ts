import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import type { NetworkRecord, NetworkRecipe, Json } from '../../shared/data-contracts';
import { redactText } from '../../shared/redaction';
import { RpcError } from '../../shared/rpc-error';

export class NetworkIntelligence {
  private readonly records: NetworkRecord[] = [];
  private readonly pendingRequests = new Map<string, Partial<NetworkRecord>>();
  private readonly recipes = new Map<string, NetworkRecipe>();
  private readonly attachedIds = new Set<number>();
  private currentAction = '';

  setAction(action: string): void {
    this.currentAction = action;
  }

  attach(contents: WebContents): void {
    const id = contents.id;
    if (this.attachedIds.has(id)) return;

    try {
      if (!contents.debugger.isAttached()) {
        contents.debugger.attach('1.3');
      }
      contents.debugger.sendCommand('Network.enable', { maxPostDataSize: 65536 }).catch(() => {});
      this.attachedIds.add(id);

      contents.debugger.on('message', (_event, method, params: any) => {
        try {
          if (method === 'Network.requestWillBeSent') {
            const reqId = String(params.requestId);
            this.pendingRequests.set(reqId, {
              id: randomUUID(),
              requestId: reqId,
              url: params.request.url,
              method: params.request.method,
              requestHeaders: params.request.headers || {},
              postData: params.request.postData,
              timestamp: Date.now(),
              lastAction: this.currentAction || undefined,
            });
          } else if (method === 'Network.responseReceived') {
            const reqId = String(params.requestId);
            const pending = this.pendingRequests.get(reqId);
            if (pending) {
              pending.status = params.response.status;
              pending.mimeType = params.response.mimeType || '';
              pending.responseHeaders = params.response.headers || {};
            }
          } else if (method === 'Network.loadingFinished') {
            const reqId = String(params.requestId);
            const pending = this.pendingRequests.get(reqId);
            if (!pending || !pending.url) return;

            const durationMs = Date.now() - (pending.timestamp || Date.now());
            const mime = (pending.mimeType || '').toLowerCase();

            // Ambil response body jika JSON atau text
            if (mime.includes('json') || mime.includes('text') || mime.includes('javascript')) {
              contents.debugger.sendCommand('Network.getResponseBody', { requestId: reqId })
                .then((bodyRes: any) => {
                  let bodyStr = bodyRes.body || '';
                  if (bodyRes.base64Encoded) {
                    try {
                      bodyStr = Buffer.from(bodyStr, 'base64').toString('utf8');
                    } catch {}
                  }

                  let jsonBody: Json | undefined = undefined;
                  try {
                    jsonBody = JSON.parse(bodyStr);
                  } catch {}

                  const completeRecord: NetworkRecord = {
                    id: pending.id || randomUUID(),
                    requestId: reqId,
                    url: pending.url || '',
                    method: pending.method || 'GET',
                    status: pending.status || 200,
                    mimeType: pending.mimeType || mime,
                    requestHeaders: pending.requestHeaders || {},
                    responseHeaders: pending.responseHeaders || {},
                    postData: pending.postData,
                    body: bodyStr.slice(0, 50000),
                    jsonBody: jsonBody,
                    timestamp: pending.timestamp || Date.now(),
                    durationMs,
                    lastAction: pending.lastAction,
                  };

                  this.addRecord(completeRecord);
                  this.pendingRequests.delete(reqId);
                })
                .catch(() => {
                  this.finalizePending(pending, reqId, durationMs);
                });
            } else {
              this.finalizePending(pending, reqId, durationMs);
            }
          } else if (method === 'Network.loadingFailed') {
            const reqId = String(params.requestId);
            const pending = this.pendingRequests.get(reqId);
            if (pending) {
              const durationMs = Date.now() - (pending.timestamp || Date.now());
              this.finalizePending({
                ...pending,
                status: 0,
                mimeType: params.errorText || 'failed',
              }, reqId, durationMs);
            }
            this.pendingRequests.delete(reqId);
          }
        } catch {}
      });

      contents.on('destroyed', () => {
        this.attachedIds.delete(id);
      });
    } catch {}
  }

  private finalizePending(pending: Partial<NetworkRecord>, reqId: string, durationMs: number): void {
    const rec: NetworkRecord = {
      id: pending.id || randomUUID(),
      requestId: reqId,
      url: pending.url || '',
      method: pending.method || 'GET',
      status: pending.status || 200,
      mimeType: pending.mimeType || 'unknown',
      requestHeaders: pending.requestHeaders || {},
      responseHeaders: pending.responseHeaders || {},
      postData: pending.postData,
      timestamp: pending.timestamp || Date.now(),
      durationMs,
      lastAction: pending.lastAction,
    };
    this.addRecord(rec);
    this.pendingRequests.delete(reqId);
  }

  private addRecord(record: NetworkRecord): void {
    this.records.unshift(record);
    if (this.records.length > 200) {
      this.records.length = 200;
    }
  }

  getRequests(filter = '', limit = 50): NetworkRecord[] {
    const f = filter.toLowerCase().trim();
    let res = this.records;
    if (f) {
      res = res.filter(r => r.url.toLowerCase().includes(f) || r.method.toLowerCase().includes(f) || r.mimeType.toLowerCase().includes(f));
    }
    return res.slice(0, Math.min(limit, 200));
  }

  getRecipe(requestId?: string): NetworkRecipe {
    let target = requestId ? this.records.find(r => r.requestId === requestId || r.id === requestId) : undefined;
    if (!target) {
      // Prioritaskan endpoint API JSON terbaru
      target = this.records.find(r => (r.mimeType.includes('json') || r.url.includes('/api/')) && r.status >= 200 && r.status < 300);
    }
    if (!target) {
      target = this.records[0];
    }
    if (!target) {
      throw new Error('Belum ada data network request yang terekam.');
    }

    const recipe: NetworkRecipe = {
      id: randomUUID(),
      name: 'Recipe ' + new URL(target.url).pathname,
      urlPattern: target.url.split('?')[0] + '(?.*)?',
      method: target.method,
      headers: { ...target.requestHeaders },
      postPayloadTemplate: target.postData,
      responseExtractionPath: target.jsonBody ? '$' : undefined,
      createdAt: new Date().toISOString(),
    };

    this.recipes.set(recipe.id, recipe);
    return recipe;
  }

  async replayRecipe(recipeId: string, params: Record<string, Json> = {}): Promise<{ status: number; durationMs: number; data: Json }> {
    const recipe = this.recipes.get(recipeId);
    if (!recipe) throw new Error('Resep network tidak ditemukan: ' + recipeId);

    const start = Date.now();
    let targetUrl = recipe.urlPattern.replace(/\(\?\.\*\)\?/, '');
    if (Object.keys(params).length > 0 && !targetUrl.includes('?')) {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== null && v !== undefined) sp.set(k, String(v));
      }
      targetUrl += '?' + sp.toString();
    }

    const res = await fetch(targetUrl, {
      method: recipe.method,
      headers: recipe.headers,
      body: recipe.method !== 'GET' && recipe.postPayloadTemplate ? recipe.postPayloadTemplate : undefined,
    });

    const text = await res.text();
    let json: Json = text;
    try { json = JSON.parse(text); } catch {}

    return {
      status: res.status,
      durationMs: Date.now() - start,
      data: json,
    };
  }

  findJsonPayloads(keyword = ''): Array<{ url: string; matchCount: number; data: Json }> {
    const kw = keyword.toLowerCase().trim();
    const results: Array<{ url: string; matchCount: number; data: Json }> = [];

    for (const r of this.records) {
      if (r.jsonBody) {
        const str = JSON.stringify(r.jsonBody).toLowerCase();
        if (!kw || str.includes(kw)) {
          results.push({
            url: r.url,
            matchCount: kw ? (str.split(kw).length - 1) : 1,
            data: r.jsonBody,
          });
        }
      }
    }
    return results;
  }

  getInflightCount(): number {
    let count = 0;
    for (const req of this.pendingRequests.values()) {
      const url = req.url || '';
      if (!url.startsWith('data:') && !url.startsWith('devtools:')) {
        count++;
      }
    }
    return count;
  }

  getInflightRequests(): Array<{ id: string; url: string; method: string; durationMs: number }> {
    const now = Date.now();
    const result: Array<{ id: string; url: string; method: string; durationMs: number }> = [];
    for (const req of this.pendingRequests.values()) {
      const url = req.url || '';
      if (!url.startsWith('data:') && !url.startsWith('devtools:')) {
        result.push({
          id: req.id || req.requestId || '',
          url: redactText(url),
          method: req.method || 'GET',
          durationMs: now - (req.timestamp || now),
        });
      }
    }
    return result;
  }

  getFailedRequests(limit = 50): Array<{ id: string; url: string; method: string; status: number; mimeType: string; durationMs: number }> {
    const failed = this.records.filter(r => r.status === 0 || r.status >= 400);
    return failed.slice(0, Math.min(limit, 200)).map(r => ({
      id: r.id,
      url: redactText(r.url),
      method: r.method,
      status: r.status,
      mimeType: r.mimeType,
      durationMs: r.durationMs,
    }));
  }

  getActivity(options: { filter?: string; onlyFailed?: boolean; limit?: number } = {}) {
    const inflight = this.getInflightRequests();
    const failed = this.getFailedRequests(options.limit ?? 50);
    let recent = this.records;
    if (options.filter) {
      const f = options.filter.toLowerCase().trim();
      recent = recent.filter(r => r.url.toLowerCase().includes(f) || r.method.toLowerCase().includes(f));
    }
    if (options.onlyFailed) {
      recent = recent.filter(r => r.status === 0 || r.status >= 400);
    }
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const recentRequests = recent.slice(0, limit).map(r => ({
      id: r.id,
      url: redactText(r.url),
      method: r.method,
      status: r.status,
      mimeType: r.mimeType,
      durationMs: r.durationMs,
    }));

    return {
      inflightCount: inflight.length,
      inflightRequests: inflight,
      failedRequests: failed,
      recentRequests,
      summary: {
        totalRecorded: this.records.length,
        inflightCount: inflight.length,
        failedCount: this.records.filter(r => r.status === 0 || r.status >= 400).length,
      },
    };
  }

  async waitForIdle(options: { idleTimeMs?: number; timeoutMs?: number; maxInflight?: number } = {}, signal?: AbortSignal): Promise<boolean> {
    const idleTime = Math.min(Math.max(options.idleTimeMs ?? 500, 100), 10000);
    const timeout = Math.min(Math.max(options.timeoutMs ?? 10000, 500), 60000);
    const maxInflight = options.maxInflight ?? 0;
    const start = Date.now();
    let idleStart: number | null = null;

    while (Date.now() - start < timeout) {
      signal?.throwIfAborted();
      const currentInflight = this.getInflightCount();
      if (currentInflight <= maxInflight) {
        if (idleStart === null) {
          idleStart = Date.now();
        } else if (Date.now() - idleStart >= idleTime) {
          return true;
        }
      } else {
        idleStart = null;
      }
      await new Promise(r => setTimeout(r, 50));
    }
    throw new RpcError('TIMEOUT', 'Batas waktu menunggu network idle terlampaui.');
  }
}
