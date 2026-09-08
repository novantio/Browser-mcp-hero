import { redactText } from '../shared/redaction';
import path from 'node:path';
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { ActivityEvent } from '../shared/types';

export interface AuditEntry {
  id?: string;
  timestamp?: string;
  source: 'mcp' | 'user' | 'system';
  action: string;
  params?: Record<string, unknown>;
  status: 'SUCCESS' | 'FAILED' | 'PAUSED_HUMAN' | 'RESUMED_HUMAN';
  durationMs?: number;
  taskId?: string;
  profileId?: string;
  error?: string;
}

export class AuditLogger {
  private readonly logPath: string;
  private onActivityListener?: (event: ActivityEvent) => void;

  constructor(userDataDir: string) {
    this.logPath = path.join(userDataDir, 'audit.log');
  }

  setActivityListener(listener: (event: ActivityEvent) => void): void {
    this.onActivityListener = listener;
  }

  /**
   * Sanitizes parameters so passwords, tokens, and credentials are never written to disk or shown in the UI.
   */
  sanitizeParams(params: Record<string, unknown> = {}): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const sensitiveKeyRegex = /(?:pass|pwd|secret|token|credential|auth|cookie|api_?key)/i;
    

    for (const [key, value] of Object.entries(params)) {
      if (sensitiveKeyRegex.test(key)) {
        result[key] = '••••••••';
      } else if (['text', 'key', 'message', 'reason'].includes(key)) {
        result[key] = '••••••••';
      } else if (key === 'selector' && typeof value === 'string') {
        result[key] = /^#[a-zA-Z0-9_-]+$/.test(value) ? value : '[selector]';
      } else if (typeof value === 'string') {
        // Redact token-like query params in URLs
        result[key] = redactText(value);
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.sanitizeParams(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  log(entry: AuditEntry): void {
    const id = entry.id || randomUUID().slice(0, 8);
    const now = new Date();
    const sanitizedParams = this.sanitizeParams(entry.params || {});

    const fullRecord = {
      id,
      timestamp: entry.timestamp || now.toISOString(),
      source: entry.source,
      action: entry.action,
      params: sanitizedParams,
      status: entry.status,
      durationMs: entry.durationMs ?? 0,
      taskId: entry.taskId,
      profileId: entry.profileId,
      error: entry.error ? 'Operasi gagal; detail sensitif tidak dicatat.' : undefined,
    };

    try {
      appendFileSync(this.logPath, JSON.stringify(fullRecord) + '\n', 'utf8');
    } catch {
      // Non-blocking in case of filesystem issues
    }

    // Produce human-readable activity event for UI feed
    if (this.onActivityListener) {
      const summary = this.generateSummary(entry.action, sanitizedParams, entry.status);
      const event: ActivityEvent = {
        id,
        timestamp: Date.now(),
        action: entry.action,
        summary,
        status: entry.status === 'SUCCESS' ? 'success'
          : entry.status === 'FAILED' ? 'failed'
          : entry.status === 'PAUSED_HUMAN' ? 'waiting' : 'running',
        detail: entry.error ? 'Operasi gagal; detail sensitif tidak dicatat.' : undefined,
      };
      this.onActivityListener(event);
    }
  }

  private generateSummary(action: string, params: Record<string, unknown>, status: string): string {
    switch (action) {
      case 'tabs.navigate':
        return `Navigasi ke ${params.url || 'alamat'}`;
      case 'tabs.new':
        return `Buka tab baru${params.url ? ` (${params.url})` : ''}`;
      case 'tabs.close':
        return `Tutup tab`;
      case 'tabs.switch':
        return `Pindah tab`;
      case 'tabs.reload':
        return `Muat ulang halaman`;
      case 'automation.click':
        return `Klik ${params.selector || params.text || 'elemen'}`;
      case 'automation.type':
        return `Ketik pada ${params.selector || 'input'}`;
      case 'automation.pressKey':
        return `Tekan tombol ${params.key}`;
      case 'automation.extract':
        return `Ekstraksi data: ${params.selector}`;
      case 'automation.observe':
        return `Observasi semantik halaman`;
      case 'automation.selectOption':
        return `Pilih opsi dropdown ${params.selector || ''}`;
      case 'automation.check':
        return `Ubah status centang ${params.selector || ''}`;
      case 'automation.hover':
        return `Arahkan kursor mouse ke ${params.selector || ''}`;
      case 'automation.inspectForm':
        return `Inspeksi struktur formulir ${params.formSelector || ''}`.trim();
      case 'automation.fillForm':
        return `Isi formulir otomatis (${Object.keys((params.fields as any) || {}).length} field)`;
      case 'automation.findElement':
        return `Pencarian semantik elemen: "${params.query || ''}"`;
      case 'automation.getState':
        return `Ambil ringkasan status browser`;
      case 'automation.screenshot':
        return `Ambil screenshot halaman`;
      case 'automation.getConsoleLogs':
        return `Ambil log konsol browser`;
      case 'automation.getNetworkActivity':
        return `Ambil ringkasan aktivitas jaringan`;
      case 'automation.waitFor':
        if (params.networkIdle) return 'Menunggu jaringan tenang (network idle)';
        if (params.expression) return 'Menunggu evaluasi ekspresi JavaScript';
        return `Menunggu ${params.selector ? `elemen ${params.selector}${params.state ? ` (${params.state})` : ''}` : `${params.ms}ms`}`;
      case 'automation.scroll':
        return `Scroll halaman (${params.direction || 'down'})`;
      case 'automation.healSelector':
        return `Perbaikan selector otomatis: ${params.selector || ''}`;
      case 'automation.detectChallenge':
        return `Deteksi tantangan bot / CAPTCHA`;
      case 'automation.uploadFile':
        return `Unggah file ke elemen input (${Array.isArray(params.filePaths) ? params.filePaths.length : 1} file)`;
      case 'automation.waitForDownload':
        return `Menunggu proses unduhan selesai`;
      case 'automation.createCheckpoint':
        return `Simpan checkpoint formulir (${params.name || 'default'})`;
      case 'automation.rollbackCheckpoint':
        return `Kembalikan formulir dari checkpoint (${params.name || ''})`;
      case 'automation.act':
        return `Eksekusi aksi otonom: ${params.intent} ${params.target || ''}`.trim();
      case 'cookies.get':
        return `Ambil cookies sesi browser`;
      case 'cookies.set':
        return `Setel cookie: ${params.name || 'session'}`;
      case 'storage.get':
        return `Baca ${params.type || 'local'}Storage`;
      case 'storage.set':
        return `${params.action || 'set'} pada ${params.type || 'local'}Storage`;
      case 'automation.dragAndDrop':
        return `Drag and drop gesture`;
      case 'tasks.create':
        return `Memulai tugas otomasi`;
      case 'tasks.complete':
        return `Tugas otomasi selesai`;
      case 'tasks.fail':
        return `Tugas otomasi gagal`;
      case 'tasks.requestIntervention':
        return `Menunggu intervensi manusia: ${params.reason || 'Pemeriksaan keamanan'}`;
      case 'tasks.resumeIntervention':
        return `Intervensi manusia dilanjutkan`;
      default:
        return `${action} (${status.toLowerCase()})`;
    }
  }
}
