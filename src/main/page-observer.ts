/**
 * Runs inside the browser page; serialized without module dependencies.
 * Extracts an AI-friendly semantic snapshot of interactive elements with stable [1], [2] IDs.
 */
export function observePage(options: { maxLength?: number } = {}): {
  url: string;
  title: string;
  loading: boolean;
  elements: Array<{
    id: number;
    tag: string;
    role: string;
    name: string;
    type?: string;
    value?: string;
    checked?: boolean;
    disabled?: boolean;
    required?: boolean;
    options?: string[];
    selected?: string;
    href?: string;
    context?: string;
  }>;
  text: string;
} {
  const url = window.location.href;
  const title = document.title || 'Tanpa judul';
  const loading = document.readyState !== 'complete';

  // Clear previous hero element IDs across document and open shadow roots
  const clearHeroIds = (root: Element | Document | ShadowRoot) => {
    try {
      for (const old of root.querySelectorAll('[data-hero-id]')) {
        old.removeAttribute('data-hero-id');
      }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) clearHeroIds(el.shadowRoot);
      }
    } catch {}
  };
  clearHeroIds(document);

  if (!document.body) {
    return {
      url,
      title,
      loading,
      elements: [],
      text: `URL: ${url}\nTitle: ${title}\n(Halaman kosong atau belum memuat body)`,
    };
  }

  const isVisible = (el: Element): boolean => {
    if (el.matches('script, style, template, noscript, iframe, object, embed, meta, link, input[type="hidden"], [hidden], [aria-hidden="true"]')) {
      return false;
    }
    let current: Element | null = el;
    while (current) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0') {
        return false;
      }
      if (current.parentElement) {
        current = current.parentElement;
      } else {
        const root = current.getRootNode();
        if (root && 'host' in root && (root as ShadowRoot).host) {
          current = (root as ShadowRoot).host;
        } else {
          break;
        }
      }
    }
    return Boolean(el.getClientRects().length);
  };

  const interactiveSelector = [
    'button',
    'a[href]',
    'input',
    'select',
    'textarea',
    '[role="button"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="link"]',
    '[role="textbox"]',
    '[role="combobox"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="switch"]',
    'summary',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const collectCandidates = (root: Element | Document | ShadowRoot): Element[] => {
    const list: Element[] = [];
    try {
      list.push(...Array.from(root.querySelectorAll(interactiveSelector)));
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) {
          list.push(...collectCandidates(el.shadowRoot));
        }
      }
    } catch {}
    return list;
  };

  const rawCandidates = collectCandidates(document.body);

  // Filter visible and remove redundant outer containers when inner is also a candidate
  const visible = rawCandidates.filter(isVisible);
  const filtered = visible.filter(el => {
    // If this candidate contains another interactive candidate, keep the more specific inner one
    const hasInteractiveChild = visible.some(other => other !== el && el.contains(other));
    if (hasInteractiveChild && !el.matches('select')) return false;
    return true;
  });

  const elements: Array<{
    id: number;
    tag: string;
    role: string;
    name: string;
    type?: string;
    value?: string;
    checked?: boolean;
    disabled?: boolean;
    required?: boolean;
    options?: string[];
    selected?: string;
    href?: string;
    context?: string;
  }> = [];

  const nodes: Element[] = [];
  let nextId = 1;
  const lines: string[] = [];

  for (const el of filtered) {
    const id = nextId++;
    el.setAttribute('data-hero-id', String(id));

    const tag = el.tagName.toLowerCase();
    let role = el.getAttribute('role') || '';
    if (!role) {
      if (tag === 'button') role = 'button';
      else if (tag === 'a') role = 'link';
      else if (tag === 'select') role = 'combobox';
      else if (tag === 'textarea') role = 'textbox';
      else if (tag === 'input') {
        const inputType = (el as HTMLInputElement).type || 'text';
        if (['checkbox', 'radio'].includes(inputType)) role = inputType;
        else if (['button', 'submit', 'reset'].includes(inputType)) role = 'button';
        else role = 'textbox';
      } else {
        role = tag;
      }
    }

    // Determine accessible name
    let name = '';
    if (el.getAttribute('aria-label')) {
      name = el.getAttribute('aria-label')!;
    } else if (el.getAttribute('aria-labelledby')) {
      const labelEl = document.getElementById(el.getAttribute('aria-labelledby')!);
      if (labelEl) name = (labelEl.textContent || '').trim();
    } else if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type)) {
      name = el.value || '';
    } else if (el.id) {
      const labelFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (labelFor) name = (labelFor.textContent || '').trim();
    }
    const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
    if (!name && isField) {
      // <label>Kota <select>…</select></label>: use the label's own text, not the options.
      const wrapping = el.closest('label');
      if (wrapping) {
        name = Array.from(wrapping.childNodes)
          .filter(node => node !== el && !(node instanceof Element && node.matches('input, select, textarea')))
          .map(node => node.textContent || '').join(' ').trim();
      }
    }
    if (!name && isField) {
      name = (el as HTMLInputElement).placeholder || (el as HTMLInputElement).name || '';
    }
    if (!name && !(el instanceof HTMLSelectElement)) {
      name = ((el instanceof HTMLElement ? el.innerText : el.textContent) || '').trim();
    }
    name = name.replace(/\s+/g, ' ').slice(0, 100);

    const item: (typeof elements)[0] = {
      id,
      tag,
      role,
      name,
    };

    const outlineParts: string[] = [`[${id}]`, role];

    if (el instanceof HTMLInputElement) {
      item.type = el.type || 'text';
      if (['checkbox', 'radio'].includes(el.type)) {
        item.checked = el.checked;
        outlineParts.push(el.checked ? '(checked)' : '(unchecked)');
      } else if (el.type === 'password') {
        item.value = el.value ? '••••••••' : '';
        outlineParts.push('(password)');
      } else if (!['button', 'submit', 'reset'].includes(el.type)) {
        item.value = el.value || '';
        outlineParts.push(`(value: "${el.value || ''}")`);
      }
      if (el.required) item.required = true;
      if (el.disabled) item.disabled = true;
    } else if (el instanceof HTMLTextAreaElement) {
      item.value = el.value || '';
      outlineParts.push(`(value: "${el.value || ''}")`);
      if (el.required) item.required = true;
      if (el.disabled) item.disabled = true;
    } else if (el instanceof HTMLSelectElement) {
      const opts = Array.from(el.options).map(o => (o.text || o.value).trim());
      item.options = opts.slice(0, 30);
      const selected = el.selectedOptions[0]?.text || el.value || '';
      item.selected = selected;
      outlineParts.push(opts.length <= 10
        ? `(selected: "${selected}", options: ${opts.map(o => `"${o}"`).join(', ')})`
        : `(selected: "${selected}", options: ${opts.length})`);
      if (el.disabled) item.disabled = true;
    } else if (el instanceof HTMLAnchorElement && el.href) {
      try {
        const parsed = new URL(el.href);
        item.href = parsed.pathname + parsed.search;
        outlineParts.push(`-> ${item.href}`);
      } catch {
        item.href = el.href;
      }
    }

    if (name) {
      outlineParts.splice(2, 0, `"${name}"`);
    }

    if (el.matches(':disabled') || el.closest('[disabled], [aria-disabled="true"]')) {
      item.disabled = true;
      outlineParts.push('[disabled]');
    }

    elements.push(item);
    nodes.push(el);
    lines.push(outlineParts.join(' '));
  }

  // Identical controls ("Add", "Delete", "Reply") are useless to an agent without the
  // row they belong to, so give each duplicate a short snippet of its surrounding text.
  const counts = new Map<string, number>();
  for (const item of elements) counts.set(item.role + '\u0000' + item.name, (counts.get(item.role + '\u0000' + item.name) || 0) + 1);
  elements.forEach((item, index) => {
    if ((counts.get(item.role + '\u0000' + item.name) || 0) < 2) return;
    for (let parent = nodes[index]!.parentElement, depth = 0; parent && parent !== document.body && depth < 5; parent = parent.parentElement, depth++) {
      const text = ((parent as HTMLElement).innerText || parent.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length > item.name.length + 2) {
        const context = text.replace(item.name, '').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (context && text.length <= 400) {
          item.context = context;
          lines[index] += ` (dekat: "${context}")`;
        }
        break;
      }
    }
  });

  const maxLen = Math.min(Math.max(options.maxLength ?? 30000, 1000), 100000);
  const header = `URL: ${url}\nTitle: ${title}\nStatus: ${loading ? 'Loading...' : 'Ready'}\nInteractive elements (${elements.length}):\n`;
  const body = lines.join('\n');
  const text = (header + body).slice(0, maxLen);

  return {
    url,
    title,
    loading,
    elements,
    text,
  };
}
