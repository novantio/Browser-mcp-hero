/** Runs in the page; serialized without module dependencies. Never returns field values. */
export function fillPageInput(target: string | { elementId?: number; selector?: string }, text: string, clear: boolean): string | null {
  let selector = typeof target === 'string' ? target : (target.selector || '');
  if (typeof target === 'object' && target.elementId !== undefined) {
    selector = `[data-hero-id="${target.elementId}"]`;
  }
  let matches: NodeListOf<Element>;
  try { matches = document.querySelectorAll(selector); }
  catch { return 'INVALID_SELECTOR'; }
  if (!matches.length) return 'ELEMENT_NOT_FOUND';
  if (matches.length !== 1) return 'ELEMENT_AMBIGUOUS';
  const el = matches[0]!;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return 'ELEMENT_NOT_EDITABLE';
  if (el instanceof HTMLInputElement && !['text', 'search', 'email', 'password', 'tel', 'url', 'number'].includes(el.type))
    return 'ELEMENT_NOT_EDITABLE';
  if (el.matches(':disabled') || el.readOnly || el.closest('[inert], [aria-disabled="true"]')) return 'ELEMENT_NOT_INTERACTABLE';
  for (let parent: Element | null = el; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0') return 'ELEMENT_NOT_INTERACTABLE';
  }
  if (!el.getClientRects().length) return 'ELEMENT_NOT_INTERACTABLE';
  el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
  el.focus();
  if (document.activeElement !== el) return 'ELEMENT_NOT_INTERACTABLE';
  const value = (clear ? '' : el.value) + text;
  // Bypass an instance value tracker so controlled forms can detect the input event.
  const prototype = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: null }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  const current = document.querySelector(selector);
  return current instanceof HTMLInputElement || current instanceof HTMLTextAreaElement
    ? (current.value === value ? null : 'INPUT_VALUE_REJECTED') : 'INPUT_VALUE_REJECTED';
}

export function clickPageElement(target: { elementId?: number; selector?: string; text?: string }): string | null {
  let el: Element | null = null;

  if (target.elementId !== undefined) {
    const found = document.querySelector(`[data-hero-id="${target.elementId}"]`);
    if (!found) return 'ELEMENT_NOT_FOUND';
    el = found;
  } else if (target.selector) {
    let matches: NodeListOf<Element>;
    try { matches = document.querySelectorAll(target.selector); }
    catch { return 'INVALID_SELECTOR'; }
    if (!matches.length) return 'ELEMENT_NOT_FOUND';
    if (matches.length !== 1) return 'ELEMENT_AMBIGUOUS';
    el = matches[0]!;
  } else if (target.text) {
    const targetText = target.text.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!targetText) return 'ELEMENT_NOT_FOUND';

    const isInteractive = (node: Element): boolean => {
      return node.matches('button, a[href], input[type="button"], input[type="submit"], input[type="reset"], [role="button"], summary, select, [tabindex]:not([tabindex="-1"])');
    };

    const all = Array.from(document.body ? document.body.querySelectorAll('*:not(script):not(style):not(noscript):not(template)') : []);
    const tier1: Element[] = [];
    const tier2: Element[] = [];
    const tier3: Element[] = [];
    const tier4: Element[] = [];

    for (const node of all) {
      let raw = '';
      if (node instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(node.type)) {
        raw = node.value || '';
      } else {
        raw = (node instanceof HTMLElement ? node.innerText : node.textContent) || node.textContent || '';
      }
      if (!raw && node.hasAttribute('aria-label')) {
        raw = node.getAttribute('aria-label') || '';
      }
      const text = raw.trim().replace(/\s+/g, ' ').toLowerCase();
      if (!text) continue;

      const exact = text === targetText;
      const partial = !exact && text.includes(targetText);
      if (!exact && !partial) continue;

      const interactive = isInteractive(node);
      if (exact) {
        if (interactive) tier1.push(node);
        else tier2.push(node);
      } else {
        if (interactive) tier3.push(node);
        else tier4.push(node);
      }
    }

    const filterLeaves = (tier: Element[]): Element[] => {
      return tier.filter(c => !tier.some(other => other !== c && c.contains(other)));
    };

    for (const tier of [tier1, tier2, tier3, tier4]) {
      if (tier.length === 0) continue;
      const candidates = filterLeaves(tier);
      if (candidates.length === 1) {
        el = candidates[0]!;
        break;
      }
      if (candidates.length > 1) {
        return 'ELEMENT_AMBIGUOUS';
      }
    }

    if (!el) return 'ELEMENT_NOT_FOUND';
  } else {
    return 'ELEMENT_NOT_FOUND';
  }

  if (el.matches(':disabled') || (el as any).disabled || el.closest('[inert], [aria-disabled="true"], :disabled')) {
    return 'ELEMENT_NOT_INTERACTABLE';
  }

  if (getComputedStyle(el).pointerEvents === 'none') {
    return 'ELEMENT_NOT_INTERACTABLE';
  }

  for (let parent: Element | null = el; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0') {
      return 'ELEMENT_NOT_INTERACTABLE';
    }
  }

  if (!el.getClientRects().length) {
    return 'ELEMENT_NOT_INTERACTABLE';
  }

  el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });

  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return 'ELEMENT_NOT_INTERACTABLE';
  }

  const visibleLeft = Math.max(0, rect.left);
  const visibleRight = Math.min(window.innerWidth, rect.right);
  const visibleTop = Math.max(0, rect.top);
  const visibleBottom = Math.min(window.innerHeight, rect.bottom);
  if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) {
    return 'ELEMENT_NOT_INTERACTABLE';
  }

  const cx = (visibleLeft + visibleRight) / 2;
  const cy = (visibleTop + visibleBottom) / 2;
  const topEl = document.elementFromPoint(cx, cy);
  if (!topEl || (topEl !== el && !el.contains(topEl))) {
    return 'ELEMENT_NOT_INTERACTABLE';
  }

  if (typeof (el as HTMLElement).click === 'function') {
    (el as HTMLElement).click();
  } else {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }

  return null;
}

export function selectPageOption(
  target: { elementId?: number; selector?: string },
  option: { value?: string; text?: string; index?: number }
): string | null {
  let selector = target.selector || '';
  if (target.elementId !== undefined) {
    selector = `[data-hero-id="${target.elementId}"]`;
  }
  let matches: NodeListOf<Element>;
  try { matches = document.querySelectorAll(selector); }
  catch { return 'INVALID_SELECTOR'; }
  if (!matches.length) return 'ELEMENT_NOT_FOUND';
  if (matches.length !== 1) return 'ELEMENT_AMBIGUOUS';
  const el = matches[0]!;
  if (!(el instanceof HTMLSelectElement)) return 'ELEMENT_NOT_EDITABLE';
  if (el.matches(':disabled') || el.closest('[inert], [aria-disabled="true"], :disabled')) return 'ELEMENT_NOT_INTERACTABLE';

  for (let parent: Element | null = el; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0') return 'ELEMENT_NOT_INTERACTABLE';
  }

  let matchedOption: HTMLOptionElement | null = null;
  let targetIndex = -1;

  if (option.index !== undefined && option.index >= 0 && option.index < el.options.length) {
    matchedOption = el.options[option.index]!;
    targetIndex = option.index;
  } else if (option.value !== undefined) {
    for (let i = 0; i < el.options.length; i++) {
      if (el.options[i]!.value === option.value) {
        matchedOption = el.options[i]!;
        targetIndex = i;
        break;
      }
    }
  } else if (option.text !== undefined) {
    const query = option.text.trim().toLowerCase();
    for (let i = 0; i < el.options.length; i++) {
      if ((el.options[i]!.text || el.options[i]!.textContent || '').trim().toLowerCase() === query) {
        matchedOption = el.options[i]!;
        targetIndex = i;
        break;
      }
    }
    if (!matchedOption) {
      for (let i = 0; i < el.options.length; i++) {
        if ((el.options[i]!.text || el.options[i]!.textContent || '').trim().toLowerCase().includes(query)) {
          matchedOption = el.options[i]!;
          targetIndex = i;
          break;
        }
      }
    }
  }

  if (!matchedOption || targetIndex === -1) return 'ELEMENT_NOT_FOUND';

  el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
  el.focus();
  el.selectedIndex = targetIndex;
  el.value = matchedOption.value;
  el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return null;
}

export function setCheckboxState(
  target: { elementId?: number; selector?: string },
  checked: boolean
): string | null {
  let selector = target.selector || '';
  if (target.elementId !== undefined) {
    selector = `[data-hero-id="${target.elementId}"]`;
  }
  let matches: NodeListOf<Element>;
  try { matches = document.querySelectorAll(selector); }
  catch { return 'INVALID_SELECTOR'; }
  if (!matches.length) return 'ELEMENT_NOT_FOUND';
  if (matches.length !== 1) return 'ELEMENT_AMBIGUOUS';
  const el = matches[0]!;
  if (!(el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type))) {
    return 'ELEMENT_NOT_EDITABLE';
  }
  if (el.matches(':disabled') || el.closest('[inert], [aria-disabled="true"], :disabled')) return 'ELEMENT_NOT_INTERACTABLE';

  for (let parent: Element | null = el; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0') return 'ELEMENT_NOT_INTERACTABLE';
  }

  el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
  el.focus();

  if (el.checked !== checked) {
    el.click();
    if (el.checked !== checked) {
      el.checked = checked;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  return null;
}

export function hoverPageElement(target: { elementId?: number; selector?: string; text?: string }): string | null {
  let el: Element | null = null;

  if (target.elementId !== undefined) {
    const found = document.querySelector(`[data-hero-id="${target.elementId}"]`);
    if (!found) return 'ELEMENT_NOT_FOUND';
    el = found;
  } else if (target.selector) {
    let matches: NodeListOf<Element>;
    try { matches = document.querySelectorAll(target.selector); }
    catch { return 'INVALID_SELECTOR'; }
    if (!matches.length) return 'ELEMENT_NOT_FOUND';
    if (matches.length !== 1) return 'ELEMENT_AMBIGUOUS';
    el = matches[0]!;
  } else if (target.text) {
    const targetText = target.text.trim().toLowerCase();
    const all = Array.from(document.body ? document.body.querySelectorAll('*:not(script):not(style)') : []);
    const match = all.find(node => ((node instanceof HTMLElement ? node.innerText : node.textContent) || '').trim().toLowerCase().includes(targetText));
    if (!match) return 'ELEMENT_NOT_FOUND';
    el = match;
  } else {
    return 'ELEMENT_NOT_FOUND';
  }

  for (let parent: Element | null = el; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0') return 'ELEMENT_NOT_INTERACTABLE';
  }

  el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
  el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
  el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }));
  return null;
}

