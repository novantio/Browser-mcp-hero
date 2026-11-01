import { execWithTimeout } from '../page-exec';
import type { WebContents } from 'electron';
import type { ExtractionSpec, Json } from '../../shared/data-contracts';
import type { NetworkIntelligence } from './network-intelligence';
import { convert, setPath } from './processing';

export interface StrategyResult {
  strategy: 'network' | 'embedded_json' | 'json_ld' | 'dom' | 'accessibility' | 'visual';
  confidence: number;
  rows: Record<string, Json>[];
  notes?: string;
}

export class ExtractionEngine {
  constructor(private readonly network?: NetworkIntelligence) {}

  async extract(contents: WebContents, schema: ExtractionSpec, strategy: 'auto' | 'network' | 'embedded_json' | 'json_ld' | 'dom' | 'accessibility' | 'visual' = 'auto', minConfidence = 0.5): Promise<Record<string, Json>[]> {
    if (strategy === 'auto') {
      const candidates: StrategyResult[] = [];

      // 1. Cek Network Responses
      if (this.network) {
        const netRes = this.extractFromNetwork(schema);
        if (netRes.rows.length > 0) candidates.push(netRes);
      }

      // 2. Cek Embedded JSON / State
      const embeddedRes = await this.extractFromEmbedded(contents, schema);
      if (embeddedRes.rows.length > 0) candidates.push(embeddedRes);

      // 3. Cek JSON-LD & Meta
      const metaRes = await this.extractFromMetadata(contents, schema);
      if (metaRes.rows.length > 0) candidates.push(metaRes);

      // 4. Cek DOM Selector
      const domRes = await this.extractFromDom(contents, schema);
      if (domRes.rows.length > 0) candidates.push(domRes);

      // 5. Cek Accessibility Tree
      const ariaRes = await this.extractFromAria(contents, schema);
      if (ariaRes.rows.length > 0) candidates.push(ariaRes);

      // Urutkan berdasarkan confidence tertinggi
      candidates.sort((a, b) => b.confidence - a.confidence);

      const top = candidates[0];
      if (top && top.confidence >= minConfidence) {
        return top.rows;
      }
      return top ? top.rows : [];
    }

    // Strategi eksplisit
    switch (strategy) {
      case 'network':
        return this.extractFromNetwork(schema).rows;
      case 'embedded_json':
        return (await this.extractFromEmbedded(contents, schema)).rows;
      case 'json_ld':
        return (await this.extractFromMetadata(contents, schema)).rows;
      case 'accessibility':
        return (await this.extractFromAria(contents, schema)).rows;
      case 'dom':
      default:
        return (await this.extractFromDom(contents, schema)).rows;
    }
  }

  private extractFromNetwork(schema: ExtractionSpec): StrategyResult {
    if (!this.network) return { strategy: 'network', confidence: 0, rows: [] };

    const payloads = this.network.findJsonPayloads();
    for (const p of payloads) {
      const items = this.searchArrayInJson(p.data);
      if (items.length > 0) {
        const rows: Record<string, Json>[] = [];
        const requiredCount = schema.fields.filter(f => f.required).length;

        for (const rawItem of items.slice(0, schema.maxItems)) {
          if (typeof rawItem !== 'object' || !rawItem) continue;
          const rowObj: Record<string, Json> = {};
          let matches = 0;

          for (const field of schema.fields) {
            // Cari field dengan nama sama atau case-insensitive
            const val = this.extractFieldFromJson(rawItem as Record<string, unknown>, field.path);
            if (val !== null && val !== undefined) {
              matches++;
              const conv = convert(typeof val === 'object' ? JSON.stringify(val) : String(val), field, p.url);
              setPath(rowObj, field.path, conv);
            } else {
              setPath(rowObj, field.path, null);
            }
          }

          if (matches > 0) {
            rowObj._source = 'network';
            rowObj._confidence = 0.95;
            rows.push(rowObj);
          }
        }

        if (rows.length >= 1) {
          return {
            strategy: 'network',
            confidence: 0.95,
            rows,
            notes: `Diekstrak dari network payload ${p.url}`,
          };
        }
      }
    }

    return { strategy: 'network', confidence: 0, rows: [] };
  }

  private searchArrayInJson(obj: unknown, maxDepth = 4): unknown[] {
    if (!obj || maxDepth <= 0) return [];
    if (Array.isArray(obj)) return obj;
    if (typeof obj !== 'object') return [];

    for (const key of Object.keys(obj as Record<string, unknown>)) {
      const val = (obj as Record<string, unknown>)[key];
      if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
        return val;
      }
      if (typeof val === 'object' && val !== null) {
        const sub = this.searchArrayInJson(val, maxDepth - 1);
        if (sub.length > 0) return sub;
      }
    }
    return [];
  }

  private extractFieldFromJson(obj: Record<string, unknown>, fieldPath: string): unknown {
    if (fieldPath in obj) return obj[fieldPath];
    const lower = fieldPath.toLowerCase();
    for (const [k, v] of Object.entries(obj)) {
      if (k.toLowerCase() === lower) return v;
    }
    return null;
  }

  private async extractFromEmbedded(contents: WebContents, schema: ExtractionSpec): Promise<StrategyResult> {
    try {
      const embeddedData = await execWithTimeout(contents, `
        (() => {
          const scripts = Array.from(document.querySelectorAll('script[type="application/json"], script#__NEXT_DATA__, script#__NUXT_DATA__'));
          for (const s of scripts) {
            try {
              const parsed = JSON.parse(s.textContent || '');
              if (parsed) return parsed;
            } catch {}
          }
          if (window.__INITIAL_STATE__) return window.__INITIAL_STATE__;
          if (window.__NEXT_DATA__) return window.__NEXT_DATA__;
          return null;
        })()
      `);

      if (embeddedData) {
        const items = this.searchArrayInJson(embeddedData);
        if (items.length > 0) {
          const rows: Record<string, Json>[] = [];
          for (const rawItem of items.slice(0, schema.maxItems)) {
            if (typeof rawItem !== 'object' || !rawItem) continue;
            const rowObj: Record<string, Json> = {};
            for (const field of schema.fields) {
              const val = this.extractFieldFromJson(rawItem as Record<string, unknown>, field.path);
              const conv = val !== null && val !== undefined ? convert(typeof val === 'object' ? JSON.stringify(val) : String(val), field, contents.getURL() || '') : null;
              setPath(rowObj, field.path, conv);
            }
            rowObj._source = 'embedded_json';
            rowObj._confidence = 0.90;
            rows.push(rowObj);
          }
          if (rows.length > 0) {
            return { strategy: 'embedded_json', confidence: 0.90, rows };
          }
        }
      }
    } catch {}

    return { strategy: 'embedded_json', confidence: 0, rows: [] };
  }

  private async extractFromMetadata(contents: WebContents, schema: ExtractionSpec): Promise<StrategyResult> {
    try {
      const meta = await execWithTimeout(contents, `
        (() => {
          const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s => {
            try { return JSON.parse(s.textContent || ''); } catch { return null; }
          }).filter(Boolean);
          const og: Record<string, string> = {};
          Array.from(document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]')).forEach(m => {
            const prop = m.getAttribute('property') || m.getAttribute('name');
            const cont = m.getAttribute('content');
            if (prop && cont) og[prop] = cont;
          });
          return { jsonLd, og };
        })()
      `);

      const rows: Record<string, Json>[] = [];
      if (meta && (meta.jsonLd.length > 0 || Object.keys(meta.og).length > 0)) {
        const rowObj: Record<string, Json> = {};
        for (const field of schema.fields) {
          let val: unknown = null;
          if (meta.og['og:' + field.path] || meta.og['twitter:' + field.path]) {
            val = meta.og['og:' + field.path] || meta.og['twitter:' + field.path];
          } else if (meta.jsonLd.length > 0) {
            val = this.extractFieldFromJson(meta.jsonLd[0], field.path);
          }
          const conv = val !== null && val !== undefined ? convert(String(val), field, contents.getURL() || '') : null;
          setPath(rowObj, field.path, conv);
        }
        rowObj._source = 'json_ld';
        rowObj._confidence = 0.85;
        rows.push(rowObj);
        return { strategy: 'json_ld', confidence: 0.85, rows };
      }
    } catch {}

    return { strategy: 'json_ld', confidence: 0, rows: [] };
  }

  private async extractFromDom(contents: WebContents, schema: ExtractionSpec): Promise<StrategyResult> {
    try {
      const currentUrl = contents.getURL() || 'http://localhost';
      const rawRows = await execWithTimeout(contents, `
        (() => {
          const rowSelector = ${JSON.stringify(schema.rowSelector)};
          const fields = ${JSON.stringify(schema.fields)};
          const maxItems = ${Math.min(schema.maxItems, 200)};
          let rowElements = [];
          try {
            rowElements = Array.from(document.querySelectorAll(rowSelector)).slice(0, maxItems);
          } catch {
            rowElements = [];
          }
          return rowElements.map(row => {
            const item = {};
            for (const field of fields) {
              let el = null;
              if (field.selector && field.selector.trim()) {
                try { el = row.querySelector(field.selector) || document.querySelector(field.selector); } catch {}
              } else {
                el = row;
              }
              if (!el) {
                item[field.path] = null;
                continue;
              }
              if (field.attribute) {
                item[field.path] = el.getAttribute(field.attribute);
              } else {
                item[field.path] = (el.innerText || el.textContent || '').trim();
              }
            }
            return item;
          });
        })()
      `) as Record<string, string | null>[];

      const rows: Record<string, Json>[] = [];
      for (const raw of rawRows) {
        const rowObj: Record<string, Json> = {};
        for (const field of schema.fields) {
          const rawVal = raw[field.path] ?? null;
          const parsed = convert(rawVal, field, currentUrl);
          setPath(rowObj, field.path, parsed);
        }
        rowObj._source = 'dom';
        rowObj._confidence = 0.80;
        rows.push(rowObj);
      }

      if (rows.length > 0) {
        return { strategy: 'dom', confidence: 0.80, rows };
      }
    } catch {}

    return { strategy: 'dom', confidence: 0, rows: [] };
  }

  private async extractFromAria(contents: WebContents, schema: ExtractionSpec): Promise<StrategyResult> {
    try {
      const currentUrl = contents.getURL() || 'http://localhost';
      const rawRows = await execWithTimeout(contents, `
        (() => {
          const articles = Array.from(document.querySelectorAll('[role="article"], [role="listitem"], [role="region"], article, [data-e2e*="item"], [data-testid*="item"]')).slice(0, ${Math.min(schema.maxItems, 100)});
          return articles.map(el => {
            return {
              text: (el.innerText || el.textContent || '').trim().slice(0, 1000),
              aria: el.getAttribute('aria-label') || el.getAttribute('aria-description') || '',
              role: el.getAttribute('role') || el.tagName.toLowerCase(),
            };
          });
        })()
      `) as Array<{ text: string; aria: string; role: string }>;

      const rows: Record<string, Json>[] = [];
      for (const raw of rawRows) {
        const rowObj: Record<string, Json> = {};
        for (const field of schema.fields) {
          const parsed = convert(raw.aria || raw.text, field, currentUrl);
          setPath(rowObj, field.path, parsed);
        }
        rowObj._source = 'accessibility';
        rowObj._confidence = 0.70;
        rows.push(rowObj);
      }

      if (rows.length > 0) {
        return { strategy: 'accessibility', confidence: 0.70, rows };
      }
    } catch {}

    return { strategy: 'accessibility', confidence: 0, rows: [] };
  }
}
