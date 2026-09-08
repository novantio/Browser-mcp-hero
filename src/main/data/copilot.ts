import type { WebContents } from 'electron';
import type { ExtractionSpec, CopilotSynthesis, Json } from '../../shared/data-contracts';
import type { NetworkIntelligence } from './network-intelligence';
import type { ExtractionEngine } from './extraction-engine';

export class ScraperCopilot {
  constructor(
    private readonly network?: NetworkIntelligence,
    private readonly extractor?: ExtractionEngine
  ) {}

  async synthesize(contents: WebContents, targetUrl: string, goalContract: Record<string, string>): Promise<CopilotSynthesis> {
    const discoveredEndpoints: Array<{ url: string; method: string; relevanceScore: number }> = [];
    const fields = Object.entries(goalContract).map(([name, type]) => ({
      path: name,
      selector: '',
      type: (['string', 'integer', 'number', 'datetime', 'url', 'boolean'].includes(type) ? type : 'string') as any,
      required: false,
    }));

    // 1. Cek apakah ada network endpoint yang cocok
    let recommendedStrategy = 'dom';
    if (this.network) {
      const payloads = this.network.findJsonPayloads();
      for (const p of payloads) {
        const payloadStr = JSON.stringify(p.data).toLowerCase();
        let matches = 0;
        for (const f of fields) {
          if (payloadStr.includes(`"${f.path.toLowerCase()}"`)) matches++;
        }
        if (matches > 0) {
          const score = matches / fields.length;
          discoveredEndpoints.push({ url: p.url, method: 'GET', relevanceScore: score });
          if (score >= 0.5) recommendedStrategy = 'network';
        }
      }
    }

    // 2. Cek repeating DOM card selector
    const bestRowSelector = await contents.executeJavaScript(`
      (() => {
        const commonSelectors = [
          'article', '[role="article"]', '[data-e2e*="item"]', '[data-testid*="item"]',
          '.item', '.card', '.product', 'li.item', 'div[class*="Item"]', 'div[class*="Card"]'
        ];
        for (const sel of commonSelectors) {
          try {
            const els = document.querySelectorAll(sel);
            if (els.length >= 3 && els.length <= 150) return sel;
          } catch {}
        }
        return 'article';
      })()
    `).catch(() => 'article');

    // 3. Bangun suggested schema
    const suggestedSchema: ExtractionSpec = {
      rowSelector: bestRowSelector,
      fields: fields.map(f => ({
        ...f,
        selector: '', // Biarkan auto-resolving atau selector healer menangani sub-elemen
      })),
      identityFields: [fields[0]?.path || 'id'],
      maxItems: 20,
    };

    // 4. Jalankan test extraction jika extractor tersedia
    let sampleRecords: Record<string, Json>[] = [];
    let testAccuracy = 0;

    if (this.extractor) {
      try {
        sampleRecords = await this.extractor.extract(contents, suggestedSchema, recommendedStrategy as any);
        if (sampleRecords.length > 0) {
          let validFieldHits = 0;
          let totalChecks = 0;
          for (const r of sampleRecords) {
            for (const f of fields) {
              totalChecks++;
              if (r[f.path] !== null && r[f.path] !== undefined && r[f.path] !== '') {
                validFieldHits++;
              }
            }
          }
          testAccuracy = totalChecks > 0 ? Math.round((validFieldHits / totalChecks) * 100) : 0;
        }
      } catch {}
    }

    return {
      targetUrl,
      goalContract,
      recommendedStrategy,
      suggestedSchema,
      discoveredEndpoints: discoveredEndpoints.slice(0, 5),
      sampleRecords: sampleRecords.slice(0, 5),
      testAccuracy,
      jobReady: testAccuracy >= 50 || sampleRecords.length > 0,
    };
  }
}
