/**
 * Semantic element finding plus focus and geometry helpers.
 * Runs inside the browser page (WebContentsView) without module dependencies:
 * serialized with Function.prototype.toString, so it must not import anything.
 */

export function findPageElements(options: {
  query: string;
  role?: string;
  tag?: string;
  maxResults?: number;
}): {
  query: string;
  elements: Array<{
    elementId: number;
    score: number;
    name: string;
    role: string;
    tag: string;
    selector?: string;
    boundingBox: { x: number; y: number; width: number; height: number };
    attributes: Record<string, string>;
    context?: string;
  }>;
} {
  const query = (options.query || '').trim().toLowerCase();
  const queryTokens = query.split(/\s+/).filter(Boolean);

  let maxId = 0;
  for (const el of document.querySelectorAll('[data-hero-id]')) {
    const idNum = parseInt(el.getAttribute('data-hero-id') || '0', 10);
    if (idNum > maxId) maxId = idNum;
  }
  const getOrAssignId = (el: Element): number => {
    let idStr = el.getAttribute('data-hero-id');
    if (idStr) return parseInt(idStr, 10);
    maxId++;
    el.setAttribute('data-hero-id', String(maxId));
    return maxId;
  };

  const isVisible = (el: Element): boolean => {
    if (el.matches('script, style, template, noscript, input[type="hidden"], [hidden], [aria-hidden="true"]')) {
      return false;
    }
    for (let parent: Element | null = el; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0') return false;
    }
    const rects = el.getClientRects();
    return Boolean(rects.length && rects[0]!.width > 0 && rects[0]!.height > 0);
  };

  const selector = [
    'button',
    'a[href]',
    'input',
    'select',
    'textarea',
    '[role]',
    '[tabindex]:not([tabindex="-1"])',
    'label',
    'summary',
    'h1, h2, h3, h4, h5, h6',
    'p, span, div[onclick]',
  ].join(',');

  const all = Array.from(document.body ? document.body.querySelectorAll(selector) : []);
  const candidates = all.filter(isVisible);

  // Filter container redundancy
  const filtered = candidates.filter(el => {
    if (el.matches('button, a, input, select, textarea, [role="button"]')) return true;
    const hasInteractive = candidates.some(other => other !== el && el.contains(other) && other.matches('button, a, input, select, textarea'));
    return !hasInteractive;
  });

  const scored: Array<{
    elementId: number;
    score: number;
    name: string;
    role: string;
    tag: string;
    selector?: string;
    boundingBox: { x: number; y: number; width: number; height: number };
    attributes: Record<string, string>;
    context?: string;
  }> = [];

  for (const el of filtered) {
    const tag = el.tagName.toLowerCase();
    if (options.tag && tag !== options.tag.toLowerCase()) continue;

    let role = el.getAttribute('role') || '';
    if (!role) {
      if (tag === 'button') role = 'button';
      else if (tag === 'a') role = 'link';
      else if (tag === 'select') role = 'combobox';
      else if (tag === 'textarea') role = 'textbox';
      else if (tag === 'input') {
        const type = (el as HTMLInputElement).type || 'text';
        if (['checkbox', 'radio'].includes(type)) role = type;
        else if (['button', 'submit', 'reset'].includes(type)) role = 'button';
        else role = 'textbox';
      } else {
        role = tag;
      }
    }

    if (options.role && role.toLowerCase() !== options.role.toLowerCase()) continue;

    // Accessible name
    let name = '';
    if (el.getAttribute('aria-label')) name = el.getAttribute('aria-label')!;
    else if (el.getAttribute('aria-labelledby')) {
      const lbl = document.getElementById(el.getAttribute('aria-labelledby')!);
      if (lbl) name = (lbl.textContent || '').trim();
    } else if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type)) {
      name = el.value || '';
    } else if (el.id) {
      const lbl = document.querySelector(`label[for="${el.id}"]`);
      if (lbl) name = (lbl.textContent || '').trim();
    }
    if (!name && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      name = el.placeholder || el.name || '';
    }
    if (!name) {
      name = ((el instanceof HTMLElement ? el.innerText : el.textContent) || '').trim();
    }
    name = name.replace(/\s+/g, ' ').slice(0, 150);

    const nameLower = name.toLowerCase();
    const nameTokens = nameLower.split(/\s+/).filter(Boolean);

    // Nearby text (e.g. the product row a generic "Add" button lives in) so a
    // query like "Add button for Tea" can tell identical buttons apart.
    let context = '';
    for (let parent = el.parentElement, depth = 0; parent && parent !== document.body && depth < 5; parent = parent.parentElement, depth++) {
      const text = ((parent as HTMLElement).innerText || parent.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length > name.length + 2) {
        if (text.length <= 300) context = text.replace(name, '').replace(/\s+/g, ' ').trim().slice(0, 150);
        break;
      }
    }
    const contextLower = context.toLowerCase();

    // Scoring
    let score = 0.0;

    if (nameLower === query) {
      score = 1.0;
    } else if (nameLower.startsWith(query) || nameLower.endsWith(query)) {
      score = 0.85;
    } else if (nameLower.includes(query) || (query.length > 3 && query.includes(nameLower))) {
      score = 0.75;
    } else {
      // Token overlap
      let matches = 0;
      for (const qt of queryTokens) {
        if (nameTokens.some(nt => nt.includes(qt) || qt.includes(nt))) matches++;
      }
      if (queryTokens.length > 0) {
        score = (matches / queryTokens.length) * 0.65;
      }
    }

    // Boost based on attribute matches
    const id = el.id ? el.id.toLowerCase() : '';
    const elName = (el as any).name ? String((el as any).name).toLowerCase() : '';
    const testId = (el.getAttribute('data-testid') || el.getAttribute('data-e2e') || '').toLowerCase();
    const placeholder = (el as any).placeholder ? String((el as any).placeholder).toLowerCase() : '';

    for (const qt of queryTokens) {
      if (id && id.includes(qt)) score = Math.max(score, 0.7);
      if (elName && elName.includes(qt)) score = Math.max(score, 0.7);
      if (testId && testId.includes(qt)) score = Math.max(score, 0.75);
      if (placeholder && placeholder.includes(qt)) score = Math.max(score, 0.7);
    }

    // Role intent boost
    if (['tombol', 'button', 'submit', 'klik'].some(w => query.includes(w)) && role === 'button') {
      score = Math.min(1.0, score + 0.2);
    } else if (['input', 'ketik', 'form', 'field'].some(w => query.includes(w)) && role === 'textbox') {
      score = Math.min(1.0, score + 0.2);
    } else if (['link', 'tautan', 'buka', 'halaman'].some(w => query.includes(w)) && role === 'link') {
      score = Math.min(1.0, score + 0.2);
    }

    if (score < 0.25) continue;

    // Query words not explained by the element's own name must be found nearby.
    const filler = new Set(['tombol', 'button', 'btn', 'untuk', 'for', 'the', 'di', 'pada', 'yang', 'link', 'tautan', 'klik', 'click',
      'ke', 'to', 'of', 'on', 'in', 'dan', 'and', 'a', 'an', 'field', 'input', 'kolom', 'item', 'dari', 'milik']);
    const extraTokens = queryTokens.filter(qt => !filler.has(qt) && !nameTokens.some(nt => nt.includes(qt) || qt.includes(nt)));
    if (extraTokens.length > 0 && contextLower) {
      const hits = extraTokens.filter(qt => contextLower.includes(qt)).length;
      score += 0.3 * (hits / extraTokens.length);
    }

    const elementId = getOrAssignId(el);
    const rect = el.getBoundingClientRect();
    const boundingBox = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };

    const attrs: Record<string, string> = {};
    for (const attr of ['id', 'name', 'type', 'data-testid', 'placeholder', 'href']) {
      const val = el.getAttribute(attr);
      if (val) attrs[attr] = val.slice(0, 100);
    }

    scored.push({
      elementId,
      score: Math.round(score * 100) / 100,
      ...(context ? { context } : {}),
      name,
      role,
      tag,
      selector: el.id ? `#${el.id}` : undefined,
      boundingBox,
      attributes: attrs,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const limit = Math.min(Math.max(options.maxResults ?? 5, 1), 20);

  return {
    query: options.query,
    elements: scored.slice(0, limit),
  };
}

export function getPageFocusedElement(): {
  elementId?: number;
  tag: string;
  role?: string;
  name?: string;
  id?: string;
} | null {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;

  const tag = el.tagName.toLowerCase();
  const id = el.id || undefined;
  const heroIdStr = el.getAttribute('data-hero-id');
  const elementId = heroIdStr ? parseInt(heroIdStr, 10) : undefined;
  const role = el.getAttribute('role') || tag;
  const name = ((el instanceof HTMLElement ? el.innerText : el.textContent) || el.getAttribute('aria-label') || '').slice(0, 50).trim() || undefined;

  return { elementId, tag, role, name, id };
}

export function getElementBoundingBox(target: { elementId?: number; selector?: string }): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  let el: Element | null = null;
  if (target.elementId !== undefined) {
    el = document.querySelector(`[data-hero-id="${target.elementId}"]`);
  } else if (target.selector) {
    try {
      el = document.querySelector(target.selector);
    } catch {}
  }
  if (!el) return null;

  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  return {
    x: Math.max(0, Math.round(rect.left)),
    y: Math.max(0, Math.round(rect.top)),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}
