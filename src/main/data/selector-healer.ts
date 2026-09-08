import type { WebContents } from 'electron';
import type { HealedSelector } from '../../shared/data-contracts';

export class SelectorHealer {
  private readonly history: HealedSelector[] = [];

  async heal(contents: WebContents, brokenSelector: string, previousTag?: string, contextSnippet?: string): Promise<HealedSelector> {
    try {
      const candidates = await contents.executeJavaScript(`
        (() => {
          const broken = ${JSON.stringify(brokenSelector)};
          const tag = ${JSON.stringify(previousTag || '')};
          const snippet = ${JSON.stringify((contextSnippet || '').toLowerCase().trim())};
          
          // Ekstrak keyword dari broken selector
          const words = broken.replace(/[^a-zA-Z0-9]/g, ' ').split(/\\s+/).filter(w => w.length > 2);
          const elements = Array.from(document.querySelectorAll('*')).slice(0, 1000);
          const results = [];

          for (const el of elements) {
            if (['script', 'style', 'head', 'meta', 'link'].includes(el.tagName.toLowerCase())) continue;
            let score = 0;
            let matchType = '';

            // 1. Cek semantic attributes (data-e2e, data-testid, aria-label)
            for (const attr of Array.from(el.attributes)) {
              const name = attr.name.toLowerCase();
              const val = attr.value.toLowerCase();
              if (name.startsWith('data-') || name.startsWith('aria-') || name === 'id' || name === 'class') {
                for (const w of words) {
                  if (val.includes(w.toLowerCase())) {
                    score += 0.35;
                    matchType = 'semantic:' + name;
                  }
                }
              }
            }

            // 2. Cek kesamaan tag
            if (tag && el.tagName.toLowerCase() === tag.toLowerCase()) {
              score += 0.20;
            }

            // 3. Cek kesamaan teks context
            const text = (el.innerText || el.textContent || '').trim().slice(0, 200).toLowerCase();
            if (snippet && text.includes(snippet)) {
              score += 0.40;
              matchType = matchType ? matchType + '+text' : 'text_similarity';
            }

            if (score >= 0.40) {
              // Bangun unique CSS selector untuk elemen ini
              let sel = el.tagName.toLowerCase();
              if (el.id) sel += '#' + el.id;
              else if (el.getAttribute('data-e2e')) sel += '[data-e2e="' + el.getAttribute('data-e2e') + '"]';
              else if (el.getAttribute('data-testid')) sel += '[data-testid="' + el.getAttribute('data-testid') + '"]';
              else if (el.className && typeof el.className === 'string') {
                const firstCls = el.className.trim().split(/\\s+/)[0];
                if (firstCls) sel += '.' + firstCls;
              }

              results.push({
                selector: sel,
                confidence: Math.min(score, 0.98),
                tag: el.tagName.toLowerCase(),
                sampleText: text.slice(0, 100),
                strategy: matchType || 'structural',
              });
            }
          }

          // Urutkan kandidat tertinggi
          results.sort((a, b) => b.confidence - a.confidence);
          return results.slice(0, 5);
        })()
      `) as Array<{ selector: string; confidence: number; tag: string; sampleText: string; strategy: string }>;

      const best = candidates[0] || {
        selector: brokenSelector,
        confidence: 0,
        tag: previousTag || 'div',
        sampleText: '',
        strategy: 'none',
      };

      const result: HealedSelector = {
        targetSelector: brokenSelector,
        resolvedSelector: best.selector,
        confidence: best.confidence,
        strategyUsed: best.strategy,
        candidates: candidates.map(c => ({
          selector: c.selector,
          confidence: c.confidence,
          tag: c.tag,
          sampleText: c.sampleText,
        })),
      };

      this.history.unshift(result);
      if (this.history.length > 100) this.history.length = 100;

      return result;
    } catch {
      return {
        targetSelector: brokenSelector,
        resolvedSelector: brokenSelector,
        confidence: 0,
        strategyUsed: 'error_fallback',
        candidates: [],
      };
    }
  }

  getHistory(): HealedSelector[] {
    return this.history;
  }
}
