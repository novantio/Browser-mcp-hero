import { app } from 'electron';
import type { Session, DownloadItem } from 'electron';
import path from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { RpcError } from '../shared/rpc-error';

export interface DownloadRecord {
  id: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
  receivedBytes: number;
  mimeType: string;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  completedAt?: number;
}

export class DownloadManager {
  private readonly records = new Map<string, DownloadRecord>();
  private readonly pendingWaiters: Array<{
    pattern?: RegExp;
    resolve: (rec: DownloadRecord) => void;
    reject: (err: Error) => void;
  }> = [];
  private readonly downloadDir: string;
  private readonly appDataDir: string;

  constructor(customDownloadDir?: string) {
    const appData = process.env.HERO_USER_DATA_DIR || app?.getPath('userData') || process.cwd();
    this.appDataDir = appData;
    this.downloadDir = customDownloadDir || path.join(appData, 'Downloads');
    try {
      if (!existsSync(this.downloadDir)) {
        mkdirSync(this.downloadDir, { recursive: true });
      }
    } catch {}
  }

  /** App data directory shared by persisted stores (profiles, trust, downloads). */
  userDataDirectory(): string {
    return this.appDataDir;
  }

  getDownloadDirectory(): string {
    return this.downloadDir;
  }

  attachSession(browserSession: Session): void {
    browserSession.on('will-download', (_event, item: DownloadItem) => {
      const id = randomUUID();
      const rawFileName = item.getFilename() || `download-${Date.now()}`;
      const safeFileName = path.basename(rawFileName).replace(/[^a-zA-Z0-9._-]/g, '_');
      const savePath = path.join(this.downloadDir, safeFileName);

      item.setSavePath(savePath);

      const record: DownloadRecord = {
        id,
        fileName: safeFileName,
        filePath: savePath,
        sizeBytes: item.getTotalBytes(),
        receivedBytes: item.getReceivedBytes(),
        mimeType: item.getMimeType() || 'application/octet-stream',
        state: 'progressing',
      };
      this.records.set(id, record);

      item.on('updated', (_evt, state) => {
        record.receivedBytes = item.getReceivedBytes();
        record.sizeBytes = item.getTotalBytes();
        if (state === 'progressing' || state === 'interrupted') {
          record.state = state;
        }
      });

      item.once('done', (_evt, state) => {
        record.state = state;
        record.completedAt = Date.now();
        record.receivedBytes = item.getReceivedBytes();
        record.sizeBytes = item.getTotalBytes();

        if (state === 'completed') {
          // Notify waiters
          for (let i = this.pendingWaiters.length - 1; i >= 0; i--) {
            const waiter = this.pendingWaiters[i]!;
            if (!waiter.pattern || waiter.pattern.test(record.fileName)) {
              waiter.resolve(record);
              this.pendingWaiters.splice(i, 1);
            }
          }
        }
      });
    });
  }

  async waitForDownload(
    options: { timeoutMs?: number; fileNamePattern?: string } = {},
    signal?: AbortSignal
  ): Promise<DownloadRecord> {
    const timeout = Math.min(Math.max(options.timeoutMs ?? 30000, 1000), 120000);
    const pattern = options.fileNamePattern ? new RegExp(options.fileNamePattern, 'i') : undefined;

    // Check if a matching download recently finished (within last 15 seconds)
    const recent = Array.from(this.records.values())
      .filter(r => r.state === 'completed' && r.completedAt && (Date.now() - r.completedAt < 15000))
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

    for (const r of recent) {
      if (!pattern || pattern.test(r.fileName)) {
        return r;
      }
    }

    signal?.throwIfAborted();

    return new Promise<DownloadRecord>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;

      const waiter = {
        pattern,
        resolve: (rec: DownloadRecord) => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          resolve(rec);
        },
        reject: (err: Error) => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          reject(err);
        },
      };

      const onAbort = () => {
        const idx = this.pendingWaiters.indexOf(waiter);
        if (idx !== -1) this.pendingWaiters.splice(idx, 1);
        waiter.reject(new RpcError('CANCELLED', 'Penantian unduhan dibatalkan.'));
      };

      signal?.addEventListener('abort', onAbort, { once: true });

      timer = setTimeout(() => {
        const idx = this.pendingWaiters.indexOf(waiter);
        if (idx !== -1) this.pendingWaiters.splice(idx, 1);
        signal?.removeEventListener('abort', onAbort);
        reject(new RpcError('TIMEOUT', 'Batas waktu menunggu file unduhan selesai telah habis.'));
      }, timeout);

      this.pendingWaiters.push(waiter);
    });
  }

  getRecentDownloads(): DownloadRecord[] {
    return Array.from(this.records.values())
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
      .slice(0, 50);
  }
}
