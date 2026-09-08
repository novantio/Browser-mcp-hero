import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import type { NetworkRecord, NetworkRecipe, Json } from '../../shared/data-contracts';

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
}
