/**
 * Runs inside the page. Work on a detached clone; never change live form fields
 * or browser storage. No external references: this function is serialized.
 */
export function readSafePage(options: { format?: string; selector?: string; maxLength?: number; maxItems?: number }): unknown {
  if (!document.body) return options.selector ? [] : '';
  const root = document.body.cloneNode(true) as HTMLElement;
  const original = [document.body, ...document.body.querySelectorAll('*')];
  const copies = [root, ...root.querySelectorAll('*')];
  const secrets = new Set<string>();
  const sensitive = /pass|pwd|secret|token|credential|auth|cookie|api.?key|csrf|otp/i;
  const allowed = new Set(['id', 'class', 'name', 'role', 'type', 'placeholder', 'aria-label', 'href', 'src', 'alt', 'title', 'datetime', 'itemprop', 'itemtype', 'itemscope']);
  const isAllowedAttr = (name: string): boolean => {
    const n = name.toLowerCase();
    return allowed.has(n) || n.startsWith('aria-') || n.startsWith('data-e2e') || n.startsWith('data-testid') || n.startsWith('data-cy') || n.startsWith('data-qa');
  };
  const cleanUrl = (value: string): string => {
    try {
      const url = new URL(value, document.baseURI);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      url.username = ''; url.password = ''; url.hash = '';
      for (const key of [...url.searchParams.keys()]) {
        if (/token|code|secret|auth|key|session|password|credential/i.test(key)) url.searchParams.delete(key);
      }
      return url.href;
    } catch { return ''; }
  };
  for (const [index, source] of original.entries()) {
    const copy = copies[index];
    if (!copy) continue;
    for (const attr of source.attributes) {
      if (sensitive.test(attr.name) && attr.value.length >= 4) secrets.add(attr.value);
    }
    if (source.matches('input, textarea, select, [contenteditable]')) {
      const value = 'value' in source ? String(source.value || '') : source.textContent || '';
      const isSecret = source.matches('input[type="password"],input[type="hidden"],[autocomplete="one-time-code"],[autocomplete="current-password"],[autocomplete="new-password"]') || sensitive.test(source.id + ' ' + (source.getAttribute('name') || ''));
      if (isSecret && value.length >= 4) secrets.add(value);
      const preset = source.getAttribute('value');
      if (isSecret && preset && preset.length >= 4) secrets.add(preset);
      copy.textContent = '';
    }
    const style = getComputedStyle(source);
    if (source.matches('script, style, template, noscript, iframe, object, embed, meta, link, input[type="hidden"], [hidden], [aria-hidden="true"]') ||
        style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      copy.remove();
      continue;
    }
    for (const attr of [...copy.attributes]) {
      if (!isAllowedAttr(attr.name)) copy.removeAttribute(attr.name);
      else if (attr.name === 'href' || attr.name === 'src') copy.setAttribute(attr.name, cleanUrl(attr.value));
    }
    if (source.matches('input[type="password"]')) copy.setAttribute('placeholder', '[REDACTED]');
  }
  const scrub = (value: string): string => {
    let clean = value;
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) clean = clean.split(secret).join('[REDACTED]');
    return clean.replace(/([?&#](?:[\w-]*(?:token|secret|password|auth|credential|api.?key)[\w-]*|code|key)=)[^&#\s"'<>]+/gi, '$1[REDACTED]');
  };
  if (options.selector) {
    // Match on the original DOM so selectors using stripped attributes still work.
    const selected = [...document.querySelectorAll(options.selector)].slice(0, options.maxItems ?? 50);
    return selected.flatMap(source => {
      if (source.matches('script, style, template, noscript, iframe, object, embed, meta, link, input[type="hidden"]')) {
        return [];
      }
      const copy = copies[original.indexOf(source as HTMLElement)];
      if (copy && (copy === root || root.contains(copy))) {
        const attributes: Record<string, string> = {};
        for (const attr of copy.attributes) attributes[attr.name] = scrub(attr.value);
        return [{ tag: copy.tagName.toLowerCase(), text: scrub((copy.textContent || '').trim()).slice(0, 1000), attributes }];
      }
      const style = getComputedStyle(source);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return [];
      }
      const targetEl = copy || (source as HTMLElement);
      const attributes: Record<string, string> = {};
      for (const attr of targetEl.attributes) {
        if (isAllowedAttr(attr.name)) {
          const val = attr.name === 'href' || attr.name === 'src' ? cleanUrl(attr.value) : attr.value;
          attributes[attr.name] = scrub(val);
        }
      }
      return [{ tag: targetEl.tagName.toLowerCase(), text: scrub((targetEl.textContent || '').trim()).slice(0, 1000), attributes }];
    });
  }
  let result = '';
  if (options.format === 'html') result = root.outerHTML;
  else if (options.format === 'text') result = root.textContent || '';
  else {
    result = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6,a,button,input,select,textarea,[role]')].slice(0, 200).map(el => {
      const label = (el.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim();
      return '<' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '> ' + label +
        (el.getAttribute('href') ? ' -> ' + el.getAttribute('href') : '');
    }).join('\n');
  }
  return scrub(result).slice(0, options.maxLength ?? 30000);
}
