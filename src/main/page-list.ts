/**
 * Runs inside the browser page; serialized without module dependencies.
 * Finds the main repeating list (comments, search results, posts) near a target and
 * returns each item as text lines, so agents don't have to parse a page dump.
 */
export function extractRepeatedItems(options: { elementId?: number; selector?: string; text?: string; maxItems?: number }):
  { container: string; total: number; items: Array<{ lines: string[]; links: string[] }> } | { error: string } {
  const scrollable = (el: Element) => el.scrollHeight > el.clientHeight + 4 && /auto|scroll|overlay/.test(getComputedStyle(el).overflowY);
  let start: Element | null = null;
  if (options.elementId !== undefined) start = document.querySelector(`[data-hero-id="${options.elementId}"]`);
  else if (options.selector) {
    try { start = document.querySelector(options.selector); } catch { return { error: 'INVALID_SELECTOR' }; }
  } else if (options.text) {
    const needle = options.text.trim().toLowerCase();
    const has = (el: Element) => (el.textContent || '').toLowerCase().includes(needle);
    const matches = [...(document.body ? document.body.querySelectorAll('*') : [])]
      .filter(el => has(el) && el.getClientRects().length > 0 && ![...el.children].some(has));
    const inPanel = (el: Element) => { for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) if (scrollable(n)) return true; return false; };
    start = matches.find(inPanel) ?? matches[0] ?? null;
  }
  if ((options.elementId !== undefined || options.selector || options.text) && !start) return { error: 'ELEMENT_NOT_FOUND' };

  // Search inside the nearest scroll panel around the target, else the whole page.
  let root: Element = start || document.body;
  for (let n: Element | null = start; n && n !== document.body; n = n.parentElement) if (scrollable(n)) { root = n; break; }

  const signature = (el: Element) => el.tagName + '.' + [...el.classList].filter(c => !/active|selected|hover|focus/i.test(c)).sort().join('.');
  const textOf = (el: Element) => ((el as HTMLElement).innerText || '').trim();
  let best: { parent: Element; children: Element[]; score: number } | null = null;
  for (const parent of [root, ...root.querySelectorAll('*')]) {
    if (parent.children.length < 3) continue;
    const groups = new Map<string, Element[]>();
    for (const child of parent.children) {
      const key = signature(child);
      const list = groups.get(key);
      if (list) list.push(child); else groups.set(key, [child]);
    }
    for (const children of groups.values()) {
      if (children.length < 3) continue;
      const withText = children.filter(c => textOf(c).length > 0);
      if (withText.length < 3) continue;
      // Prefer many items that each carry real text (a comment, a result) over icon rows.
      const avg = withText.reduce((n, c) => n + Math.min(textOf(c).length, 400), 0) / withText.length;
      const score = withText.length * Math.min(avg, 200);
      if (!best || score > best.score) best = { parent, children: withText, score };
    }
  }
  if (!best) return { container: root === document.body ? 'page' : 'panel', total: 0, items: [] };

  // Lines from text nodes grouped by their nearest non-inline element. innerText glues
  // adjacent inline elements ("8-18" + "5" -> "8-185"), which corrupts dates and counts.
  const linesOf = (item: Element): string[] => {
    const lines: string[] = [];
    let currentBlock: Element | null = null;
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      const parent = node.parentElement;
      if (!text || !parent || !parent.getClientRects().length) continue;
      let block: Element = parent;
      while (block !== item && getComputedStyle(block).display === 'inline' && block.parentElement) block = block.parentElement;
      if (block === currentBlock && lines.length) lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + text).slice(0, 500);
      else lines.push(text.slice(0, 500));
      currentBlock = block;
    }
    return lines.filter((line, i) => line !== lines[i - 1]);
  };

  const limit = Math.min(Math.max(options.maxItems ?? 50, 1), 200);
  const items = best.children.slice(0, limit).map(child => {
    const lines = linesOf(child);
    const links = [...new Set([...child.querySelectorAll('a[href]')].map(a => (a as HTMLAnchorElement).href).filter(h => /^https?:/.test(h)))].slice(0, 5);
    return { lines: lines.slice(0, 30), links };
  });
  return { container: root === document.body ? 'page' : 'panel', total: best.children.length, items };
}
