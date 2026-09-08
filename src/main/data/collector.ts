import { createHash } from 'node:crypto';
import type { WebContents } from 'electron';
import type { ExtractionSpec, Json } from '../../shared/data-contracts';
import type { ExtractionEngine } from './extraction-engine';

export interface CollectResult {
  totalCollected: number;
  uniqueCount: number;
  scrollsPerformed: number;
  terminationReason: string;
  durationMs: number;
  rows: Record<string, Json>[];
}

export class CollectorEngine {
  constructor(private readonly extractor: ExtractionEngine) {}

  async collect(
    contents: WebContents,
    schema: ExtractionSpec,
    maxItems = 100,
    maxScrolls = 20,
    timeoutMs = 60000,
    terminationCondition: 'no_new_items' | 'max_items' | 'end_of_feed' = 'no_new_items'
  ): Promise<CollectResult> {
    const startTime = Date.now();
    const uniqueMap = new Map<string, Record<string, Json>>();
    let consecutiveNoNew = 0;
    let scrolls = 0;
    let terminationReason = 'completed';

    while (scrolls < maxScrolls && Date.now() - startTime < timeoutMs) {
      // 1. Ekstrak halaman saat ini
      const extracted = await this.extractor.extract(contents, schema, 'auto');
      let newCount = 0;

      for (const row of extracted) {
        const key = this.getRowKey(row, schema.identityFields);
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, row);
          newCount++;
        }
        if (uniqueMap.size >= maxItems) {
          terminationReason = 'max_items_reached';
          break;
        }
      }

      if (uniqueMap.size >= maxItems) break;

      if (newCount === 0) {
        consecutiveNoNew++;
        if (consecutiveNoNew >= 3 && terminationCondition === 'no_new_items') {
          terminationReason = 'no_new_items_detected';
          break;
        }
      } else {
        consecutiveNoNew = 0;
      }

      // 2. Cek apakah sudah di dasar halaman (end of feed)
      const atBottom = await contents.executeJavaScript(`
        (() => {
          const scrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
          const windowHeight = window.innerHeight;
          const docHeight = document.documentElement.scrollHeight;
          return (scrollY + windowHeight) >= (docHeight - 50);
        })()
      `).catch(() => false);

      if (atBottom && terminationCondition === 'end_of_feed') {
        terminationReason = 'end_of_feed_reached';
        break;
      }

      // 3. Scroll ke bawah
      await contents.executeJavaScript(`
        (() => {
          window.scrollBy({ top: 800, behavior: 'smooth' });
        })()
      `).catch(() => {});

      scrolls++;
      // Beri waktu render / network fetch
      await new Promise(r => setTimeout(r, 1500));
    }

    if (Date.now() - startTime >= timeoutMs) {
      terminationReason = 'timeout';
    } else if (scrolls >= maxScrolls && terminationReason === 'completed') {
      terminationReason = 'max_scrolls_reached';
    }

    const rows = Array.from(uniqueMap.values());
    return {
      totalCollected: rows.length,
      uniqueCount: rows.length,
      scrollsPerformed: scrolls,
      terminationReason,
      durationMs: Date.now() - startTime,
      rows,
    };
  }

  private getRowKey(row: Record<string, Json>, identityFields: string[] = []): string {
    if (identityFields.length > 0) {
      const parts = identityFields.map(f => String(row[f] ?? ''));
      if (parts.some(Boolean)) return parts.join(':::');
    }
    const str = JSON.stringify(row);
    return createHash('sha256').update(str).digest('hex').slice(0, 16);
  }
}
