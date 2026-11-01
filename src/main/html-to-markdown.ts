/**
 * Lynx-style reader: turns raw HTML into compact markdown without running any page
 * JavaScript. Links become numbered references ([text][3] … "[3]: https://…") so an
 * agent can follow them by number. Pure string processing, safe to run in main.
 */
export interface MarkdownPage {
  title: string;
  markdown: string;
  links: number;
  truncated: boolean;
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const DROP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'object', 'head', 'math', 'dialog']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside', 'form', 'fieldset',
  'figure', 'figcaption', 'address', 'details', 'summary', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'caption', 'center']);
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—',
  ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»', bull: '•', middot: '·', times: '×', euro: '€',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function attr(attrs: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  if (!match) return undefined;
  return decodeEntities(match[1] ?? match[2] ?? match[3] ?? '');
}

function isHidden(attrs: string, keepAriaHidden: boolean): boolean {
  if (/(?:^|\s)hidden(?:\s|=|$)/i.test(attrs)) return true;
  // aria-hidden usually marks decorative duplicates, but an open dialog also sets it on the
  // whole page behind it; keepAriaHidden reads that page anyway.
  if (!keepAriaHidden && attr(attrs, 'aria-hidden') === 'true') return true;
  const style = (attr(attrs, 'style') || '').replace(/\s+/g, '').toLowerCase();
  return style.includes('display:none') || style.includes('visibility:hidden');
}

/** True when the HTML contains an open modal dialog (role=dialog / aria-modal). */
export function hasOpenDialog(html: string): boolean {
  return /<[a-z][^>]*(?:role\s*=\s*["']?(?:alert)?dialog|aria-modal\s*=\s*["']?true)[^>]*>/i.test(html);
}

export function htmlToMarkdown(html: string, options: { baseUrl?: string; maxLength?: number; mainOnly?: boolean; includeLinks?: boolean; keepAriaHidden?: boolean } = {}): MarkdownPage {
  const keepAriaHidden = options.keepAriaHidden === true;
  const maxLength = Math.min(Math.max(options.maxLength ?? 20000, 200), 200000);
  const includeLinks = options.includeLinks !== false;
  let source = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<![^>]*>|<\?[^>]*>/g, '');
  const title = decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(source)?.[1] || '').replace(/\s+/g, ' ').trim());
  let base = options.baseUrl;
  const baseHref = /<base\s[^>]*href\s*=\s*["']?([^"'\s>]+)/i.exec(source)?.[1];
  if (baseHref) { try { base = new URL(baseHref, base).href; } catch { /* keep page URL */ } }
  if (options.mainOnly) {
    const main = /<main[\s>][\s\S]*<\/main>/i.exec(source)?.[0] || /<article[\s>][\s\S]*<\/article>/i.exec(source)?.[0];
    if (main) source = main;
  }

  const out: string[] = [];
  const refs: string[] = [];
  const refIndex = new Map<string, number>();
  const lists: Array<{ ordered: boolean; n: number }> = [];
  const anchors: Array<{ href?: string; start: number }> = [];
  let skipTag = '';
  let skipDepth = 0;
  let pre = 0;
  let inSelect: string[] | null = null;
  let selectLabel = '';
  const rows: number[] = [];
  const buttons: number[] = [];
  const CELL = '\u0001';

  const tail = () => out.join('').slice(-2);
  const newline = (count = 1) => {
    const current = tail();
    const have = current.endsWith('\n\n') ? 2 : current.endsWith('\n') ? 1 : 0;
    if (out.length === 0) return;
    out.push('\n'.repeat(Math.max(0, count - have)));
  };
  const write = (text: string) => {
    if (!text) return;
    // Whitespace between block tags must not open a new line or double a space.
    if (!pre && text === ' ' && (out.length === 0 || /[\n ]$/.test(out[out.length - 1]!))) return;
    out.push(text);
  };
  const resolve = (href: string): string | null => {
    if (!href || href.startsWith('#') || /^(javascript|data|mailto|tel):/i.test(href)) return /^(mailto|tel):/i.test(href) ? href : null;
    try { return new URL(href, base).href; } catch { return null; }
  };
  const refFor = (url: string): number => {
    let n = refIndex.get(url);
    if (!n) { refs.push(url); n = refs.length; refIndex.set(url, n); }
    return n;
  };

  const tokens = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|(<)/g;
  for (let match = tokens.exec(source); match; match = tokens.exec(source)) {
    const [, closing, rawTag, attrs = '', text, stray] = match;
    if (text !== undefined || stray !== undefined) {
      if (skipDepth) continue;
      const raw = decodeEntities(text ?? '<');
      if (inSelect) continue;
      write(pre ? raw : raw.replace(/\s+/g, ' '));
      continue;
    }
    const tag = rawTag!.toLowerCase();
    const isClose = closing === '/';

    if (skipDepth) {
      if (tag === skipTag && !VOID.has(tag)) skipDepth += isClose ? -1 : 1;
      continue;
    }
    if (!isClose && !VOID.has(tag) && (DROP.has(tag) || isHidden(attrs, keepAriaHidden))) { skipTag = tag; skipDepth = 1; continue; }
    if (!isClose && VOID.has(tag) && isHidden(attrs, keepAriaHidden)) continue;

    if (/^h[1-6]$/.test(tag)) {
      newline(2);
      if (!isClose) write('#'.repeat(Number(tag[1])) + ' ');
      continue;
    }
    switch (tag) {
      case 'br': write(pre ? '\n' : '\n'); continue;
      case 'hr': newline(2); write('---'); newline(2); continue;
      case 'ul': case 'ol':
        if (isClose) lists.pop(); else lists.push({ ordered: tag === 'ol', n: 0 });
        newline(lists.length ? 1 : 2); continue;
      case 'li':
        if (isClose) { newline(); continue; }
        newline();
        { const list = lists[lists.length - 1]; const indent = '  '.repeat(Math.max(0, lists.length - 1));
          if (list) list.n++; write(indent + (list?.ordered ? `${list.n}. ` : '- ')); }
        continue;
      case 'blockquote': newline(2); if (!isClose) write('> '); continue;
      case 'pre': newline(2); write('```'); if (isClose) { pre = Math.max(0, pre - 1); newline(2); } else { pre++; write('\n'); } continue;
      case 'code': if (!pre) write('`'); continue;
      case 'strong': case 'b': write('**'); continue;
      case 'tr': {
        if (!isClose) { newline(); rows.push(out.length); continue; }
        const start = rows.pop();
        if (start === undefined) continue;
        // Drop empty cells; a one-cell row is layout, not data, so print it as text.
        const cells = out.slice(start).join('').split(CELL).map(cell => cell.trim()).filter(Boolean);
        const row = cells.length > 1 ? '| ' + cells.map(cell => cell.replace(/\s*\n\s*/g, ' ')).join(' | ') + ' |' : (cells[0] ?? '');
        out.splice(start, out.length - start, row);
        newline();
        continue;
      }
      case 'td': case 'th': if (!isClose && rows.length) out.push(CELL); continue;
      case 'a': {
        if (!isClose) { anchors.push({ href: attr(attrs, 'href'), start: out.length }); continue; }
        const anchor = anchors.pop();
        if (!anchor || !includeLinks) continue;
        const url = anchor.href ? resolve(anchor.href) : null;
        const label = out.slice(anchor.start).join('').replace(/\s+/g, ' ').trim();
        if (!url || !label) continue;
        out.splice(anchor.start, out.length - anchor.start, `[${label}][${refFor(url)}]`);
        continue;
      }
      case 'img': {
        const alt = (attr(attrs, 'alt') || '').trim();
        if (alt) write(`[gambar: ${alt}]`);
        continue;
      }
      case 'input': {
        const type = (attr(attrs, 'type') || 'text').toLowerCase();
        if (type === 'hidden') continue;
        const label = attr(attrs, 'aria-label') || attr(attrs, 'placeholder') || attr(attrs, 'value') || attr(attrs, 'name') || type;
        if (['submit', 'button', 'reset'].includes(type)) write(`[tombol: ${label}]`);
        else if (type === 'checkbox' || type === 'radio') write(/\schecked/i.test(attrs) ? '[x] ' : '[ ] ');
        else write(`[${type}: ${label}]`);
        continue;
      }
      case 'textarea':
        if (!isClose) write(`[textarea: ${attr(attrs, 'placeholder') || attr(attrs, 'name') || ''}]`);
        if (!isClose) { skipTag = 'textarea'; skipDepth = 1; }
        continue;
      case 'button': {
        if (!isClose) { buttons.push(out.length); continue; }
        const start = buttons.pop();
        if (start === undefined) continue;
        // Icon-only buttons have no text; dropping them keeps the output readable.
        const label = out.slice(start).join('').replace(/\s+/g, ' ').trim();
        out.splice(start, out.length - start, ...(label ? [`[tombol: ${label}]`] : []));
        continue;
      }
      case 'select':
        if (!isClose) { inSelect = []; selectLabel = attr(attrs, 'aria-label') || attr(attrs, 'name') || 'pilihan'; }
        else if (inSelect) { write(`[${selectLabel}: ${inSelect.slice(0, 15).join(' | ')}${inSelect.length > 15 ? ' | …' : ''}]`); inSelect = null; }
        continue;
      case 'option': {
        if (isClose || !inSelect) continue;
        const rest = source.slice(tokens.lastIndex);
        const optionText = decodeEntities((/^([^<]*)/.exec(rest)?.[1] || '').replace(/\s+/g, ' ').trim());
        if (optionText) inSelect.push(optionText);
        continue;
      }
    }
    if (BLOCK.has(tag)) newline(tag === 'div' || tag === 'dd' || tag === 'dt' ? 1 : 2);
  }

  let fenced = false;
  let markdown = out.join('')
    .split('\n').map(line => {
      if (line.startsWith('```')) { fenced = !fenced; return line; }
      if (fenced) return line;
      const lead = /^[ \t]*/.exec(line)![0];
      const body = line.slice(lead.length).replace(/[ \t]+/g, ' ').trimEnd();
      return /^(?:- |\d+\. )/.test(body) ? lead + body : body;
    }).join('\n')
    .replace(/\*\*\s*\*\*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const truncated = markdown.length > maxLength;
  if (truncated) markdown = markdown.slice(0, maxLength) + '\n\n…(dipotong; naikkan maxLength atau gunakan mainOnly: true)';
  // Keep the reference list even when the body is cut, but only for links still shown.
  const shown = refs.map((url, i) => ({ url, n: i + 1 })).filter(ref => markdown.includes(`][${ref.n}]`));
  if (shown.length) markdown += '\n\n---\nTautan:\n' + shown.map(ref => `[${ref.n}]: ${ref.url}`).join('\n');
  return { title, markdown, links: shown.length, truncated };
}
