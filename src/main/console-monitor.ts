import type { WebContents } from 'electron';
import { redactText } from '../shared/redaction';

export interface ConsoleEntry {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  source?: string;
  line?: number;
  timestamp: number;
  tabId?: string;
}

export interface ConsoleLogsResult {
  entries: ConsoleEntry[];
  summary: {
    total: number;
    errorCount: number;
    warnCount: number;
    infoCount: number;
  };
}

export class ConsoleMonitor {
  private readonly entries: ConsoleEntry[] = [];
  private readonly maxEntries = 500;
  private readonly attachedContents = new Set<number>();

  attach(tabId: string, contents: WebContents): void {
    const id = contents.id;
    if (this.attachedContents.has(id)) return;
    this.attachedContents.add(id);

    const listener = (event: any, level?: number, message?: string, line?: number, sourceId?: string) => {
      try {
        const lvlNum = typeof level === 'number' ? level : (event?.level ?? 0);
        const rawMsg = typeof message === 'string' ? message : (event?.message ?? '');
        const lineNum = typeof line === 'number' ? line : (event?.line ?? 0);
        const src = typeof sourceId === 'string' ? sourceId : (event?.sourceId ?? '');

        let levelStr: ConsoleEntry['level'] = 'info';
        if (lvlNum === 3) levelStr = 'error';
        else if (lvlNum === 2) levelStr = 'warn';
        else if (lvlNum === 1) levelStr = 'info';
        else if (lvlNum === 0) levelStr = 'debug';

        this.addEntry({
          level: levelStr,
          message: redactText(String(rawMsg)),
          source: src ? redactText(String(src)) : undefined,
          line: lineNum || undefined,
          timestamp: Date.now(),
          tabId,
        });
      } catch {}
    };

    contents.on('console-message', listener);
    contents.on('render-process-gone', (_event, details) => {
      this.addEntry({
        level: 'error',
        message: `Proses renderer terhenti: reason=${details.reason}, exitCode=${details.exitCode}`,
        timestamp: Date.now(),
        tabId,
      });
    });

    contents.on('destroyed', () => {
      this.attachedContents.delete(id);
    });
  }

  private addEntry(entry: ConsoleEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  getLogs(options: {
    tabId?: string;
    level?: 'info' | 'warn' | 'error' | 'debug' | 'all';
    limit?: number;
    clear?: boolean;
  } = {}): ConsoleLogsResult {
    let filtered = this.entries;
    if (options.tabId) {
      filtered = filtered.filter(e => !e.tabId || e.tabId === options.tabId);
    }
    if (options.level && options.level !== 'all') {
      filtered = filtered.filter(e => e.level === options.level);
    }
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const resultEntries = filtered.slice(-limit);

    const summary = {
      total: filtered.length,
      errorCount: filtered.filter(e => e.level === 'error').length,
      warnCount: filtered.filter(e => e.level === 'warn').length,
      infoCount: filtered.filter(e => e.level === 'info').length,
    };

    if (options.clear) {
      if (options.tabId) {
        for (let i = this.entries.length - 1; i >= 0; i--) {
          if (this.entries[i]?.tabId === options.tabId) this.entries.splice(i, 1);
        }
      } else {
        this.entries.length = 0;
      }
    }

    return { entries: resultEntries, summary };
  }
}
