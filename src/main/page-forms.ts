/**
 * Serialized page-context functions for Form Intelligence, Smart Form Filling,
 * Semantic Element Finding, and State / Geometry Extraction.
 * These functions run inside the browser page (WebContentsView) without module dependencies.
 */

export function inspectPageForms(options: { formSelector?: string; formElementId?: number } = {}): {
  forms: Array<{
    id: string;
    name?: string;
    action?: string;
    method?: string;
    elementId?: number;
    fields: Array<{
      name: string;
      id: string;
      elementId: number;
      tag: 'input' | 'select' | 'textarea';
      type?: string;
      label: string;
      value?: string;
      placeholder?: string;
      required: boolean;
      disabled: boolean;
      readOnly: boolean;
      checked?: boolean;
      options?: Array<{ value: string; text: string; selected: boolean }>;
    }>;
    submitButton?: {
      elementId?: number;
      text?: string;
      tag: string;
      selector?: string;
    };
  }>;
} {
  // Ensure elements have hero IDs
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

  const getAccessibleLabel = (el: Element): string => {
    if (el.getAttribute('aria-label')) {
      return el.getAttribute('aria-label')!.trim();
    }
    if (el.getAttribute('aria-labelledby')) {
      const labelNode = document.getElementById(el.getAttribute('aria-labelledby')!);
      if (labelNode) return (labelNode.textContent || '').trim();
    }
    if (el.id) {
      const labelFor = document.querySelector(`label[for="${el.id}"]`);
      if (labelFor) return (labelFor.textContent || '').trim();
    }
    const parentLabel = el.closest('label');
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true) as HTMLElement;
      for (const child of clone.querySelectorAll('input, select, textarea')) child.remove();
      const text = (clone.textContent || '').trim();
      if (text) return text;
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el.placeholder) return el.placeholder.trim();
    }
    if (el.getAttribute('title')) return el.getAttribute('title')!.trim();
    if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type)) {
      return (el.value || '').trim();
    }
    return '';
  };

  let formElements: Element[] = [];
  if (options.formElementId !== undefined) {
    const target = document.querySelector(`[data-hero-id="${options.formElementId}"]`);
    if (target) formElements = [target];
  } else if (options.formSelector) {
    try {
      formElements = Array.from(document.querySelectorAll(options.formSelector));
    } catch {
      formElements = [];
    }
  } else {
    formElements = Array.from(document.querySelectorAll('form'));
    // If no <form> tag exists, find standalone interactive inputs in document.body
    if (formElements.length === 0 && document.body) {
      const inputs = document.body.querySelectorAll('input:not([type="hidden"]), select, textarea');
      if (inputs.length > 0) {
        formElements = [document.body];
      }
    }
  }

  const results: ReturnType<typeof inspectPageForms>['forms'] = [];

  for (const formEl of formElements) {
    const isRealForm = formEl.tagName.toLowerCase() === 'form';
    const formId = formEl.id || (isRealForm ? 'form-' + (results.length + 1) : 'synthetic-form');
    const formName = formEl.getAttribute('name') || undefined;
    const formAction = isRealForm ? (formEl as HTMLFormElement).action || undefined : undefined;
    const formMethod = isRealForm ? ((formEl as HTMLFormElement).method || 'get').toUpperCase() : undefined;
    const formElementId = getOrAssignId(formEl);

    const fieldCandidates = Array.from(
      formEl.querySelectorAll('input:not([type="hidden"]), select, textarea')
    ).filter(el => {
      // Exclude submit/button inputs from fields list (they are handled as submit buttons)
      if (el instanceof HTMLInputElement && ['submit', 'button', 'reset', 'image'].includes(el.type)) {
        return false;
      }
      return true;
    });

    const fields: ReturnType<typeof inspectPageForms>['forms'][0]['fields'] = [];

    for (const fieldEl of fieldCandidates) {
      const elementId = getOrAssignId(fieldEl);
      const tag = fieldEl.tagName.toLowerCase() as 'input' | 'select' | 'textarea';
      const name = (fieldEl as HTMLInputElement).name || '';
      const id = fieldEl.id || '';
      const label = getAccessibleLabel(fieldEl) || name || id || `field-${elementId}`;
      const required = Boolean((fieldEl as HTMLInputElement).required);
      const disabled = Boolean((fieldEl as HTMLInputElement).disabled);
      const readOnly = Boolean((fieldEl as HTMLInputElement).readOnly);
      const placeholder = (fieldEl as HTMLInputElement).placeholder || undefined;

      let type: string | undefined = undefined;
      let value: string | undefined = undefined;
      let checked: boolean | undefined = undefined;
      let optionsList: Array<{ value: string; text: string; selected: boolean }> | undefined = undefined;

      if (fieldEl instanceof HTMLInputElement) {
        type = fieldEl.type || 'text';
        if (['checkbox', 'radio'].includes(type)) {
          checked = fieldEl.checked;
          value = fieldEl.value || 'on';
        } else if (type === 'password') {
          value = fieldEl.value ? '••••••••' : '';
        } else {
          value = fieldEl.value || '';
        }
      } else if (fieldEl instanceof HTMLTextAreaElement) {
        type = 'textarea';
        value = fieldEl.value || '';
      } else if (fieldEl instanceof HTMLSelectElement) {
        type = 'select';
        value = fieldEl.value || '';
        optionsList = Array.from(fieldEl.options).map(opt => ({
          value: opt.value,
          text: (opt.text || opt.textContent || '').trim(),
          selected: opt.selected,
        }));
      }

      fields.push({
        name,
        id,
        elementId,
        tag,
        type,
        label,
        value,
        placeholder,
        required,
        disabled,
        readOnly,
        checked,
        options: optionsList,
      });
    }

    // Identify submit button
    let submitButton: ReturnType<typeof inspectPageForms>['forms'][0]['submitButton'] = undefined;
    const submitEl = formEl.querySelector(
      'button[type="submit"], input[type="submit"], button:not([type="button"]):not([type="reset"])'
    );
    if (submitEl) {
      const submitId = getOrAssignId(submitEl);
      let btnText = '';
      if (submitEl instanceof HTMLInputElement) {
        btnText = submitEl.value || 'Submit';
      } else {
        btnText = (submitEl.textContent || '').trim();
      }
      submitButton = {
        elementId: submitId,
        text: btnText.replace(/\s+/g, ' ').slice(0, 100),
        tag: submitEl.tagName.toLowerCase(),
        selector: submitEl.id ? `#${submitEl.id}` : undefined,
      };
    }

    results.push({
      id: formId,
      name: formName,
      action: formAction,
      method: formMethod,
      elementId: formElementId,
      fields,
      submitButton,
    });
  }

  return { forms: results };
}

export function fillPageForm(options: {
  formSelector?: string;
  formElementId?: number;
  fields: Record<string, string | number | boolean>;
  submit?: boolean;
  validate?: boolean;
}): {
  ok: boolean;
  filled: Array<{
    field: string;
    elementId?: number;
    matchedBy: string;
    type: string;
  }>;
  skipped: Array<{
    field: string;
    reason: string;
  }>;
  submitted: boolean;
  valid: boolean;
  summary: string;
} {
  let formContainer: Element | null = null;
  if (options.formElementId !== undefined) {
    formContainer = document.querySelector(`[data-hero-id="${options.formElementId}"]`);
  } else if (options.formSelector) {
    try {
      formContainer = document.querySelector(options.formSelector);
    } catch {}
  }
  if (!formContainer) {
    formContainer = document.querySelector('form') || document.body;
  }
  if (!formContainer) {
    return {
      ok: false,
      filled: [],
      skipped: Object.keys(options.fields || {}).map(f => ({ field: f, reason: 'FORM_NOT_FOUND' })),
      submitted: false,
      valid: false,
      summary: 'Tidak dapat menemukan elemen form atau body pada halaman.',
    };
  }

  // Find all field candidates
  const candidates = Array.from(
    formContainer.querySelectorAll('input:not([type="hidden"]), select, textarea')
  ) as Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;

  // Ensure hero IDs
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

  const getAccessibleLabel = (el: Element): string => {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label')!.trim();
    if (el.getAttribute('aria-labelledby')) {
      const labelNode = document.getElementById(el.getAttribute('aria-labelledby')!);
      if (labelNode) return (labelNode.textContent || '').trim();
    }
    if (el.id) {
      const labelFor = document.querySelector(`label[for="${el.id}"]`);
      if (labelFor) return (labelFor.textContent || '').trim();
    }
    const parentLabel = el.closest('label');
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true) as HTMLElement;
      for (const child of clone.querySelectorAll('input, select, textarea')) child.remove();
      const text = (clone.textContent || '').trim();
      if (text) return text;
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el.placeholder) return el.placeholder.trim();
    }
    if (el.getAttribute('title')) return el.getAttribute('title')!.trim();
    return '';
  };

  const filled: ReturnType<typeof fillPageForm>['filled'] = [];
  const skipped: ReturnType<typeof fillPageForm>['skipped'] = [];

  for (const [key, rawValue] of Object.entries(options.fields || {})) {
    const queryKey = key.trim().toLowerCase();
    let matchedEl: (typeof candidates)[0] | null = null;
    let matchedBy = 'none';

    // 1. Check direct elementId match (if key is numeric)
    const keyAsNum = parseInt(key, 10);
    if (!isNaN(keyAsNum) && keyAsNum > 0) {
      const found = candidates.find(c => c.getAttribute('data-hero-id') === String(keyAsNum));
      if (found) {
        matchedEl = found;
        matchedBy = 'elementId';
      }
    }

    // 2. Exact match on id or name
    if (!matchedEl) {
      for (const el of candidates) {
        if (el.name && el.name.toLowerCase() === queryKey) {
          matchedEl = el;
          matchedBy = 'name';
          break;
        }
        if (el.id && el.id.toLowerCase() === queryKey) {
          matchedEl = el;
          matchedBy = 'id';
          break;
        }
      }
    }

    // 3. Match on accessible label
    if (!matchedEl) {
      for (const el of candidates) {
        const lbl = getAccessibleLabel(el).toLowerCase();
        if (lbl && lbl === queryKey) {
          matchedEl = el;
          matchedBy = 'label_exact';
          break;
        }
      }
    }

    // 4. Match on placeholder
    if (!matchedEl) {
      for (const el of candidates) {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          if (el.placeholder && el.placeholder.toLowerCase() === queryKey) {
            matchedEl = el;
            matchedBy = 'placeholder';
            break;
          }
        }
      }
    }

    // 5. Partial / substring match on label or name
    if (!matchedEl) {
      for (const el of candidates) {
        const lbl = getAccessibleLabel(el).toLowerCase();
        const name = (el.name || '').toLowerCase();
        if ((lbl && (lbl.includes(queryKey) || queryKey.includes(lbl))) ||
            (name && (name.includes(queryKey) || queryKey.includes(name)))) {
          matchedEl = el;
          matchedBy = 'partial';
          break;
        }
      }
    }

    if (!matchedEl) {
      skipped.push({ field: key, reason: 'FIELD_NOT_FOUND' });
      continue;
    }

    // Check interactivity
    if (matchedEl.matches(':disabled') || (matchedEl as any).disabled || Boolean((matchedEl as any).readOnly) || matchedEl.closest('[inert], [aria-disabled="true"]')) {
      skipped.push({ field: key, reason: 'ELEMENT_NOT_INTERACTABLE' });
      continue;
    }

    const heroId = getOrAssignId(matchedEl);
    const tag = matchedEl.tagName.toLowerCase();

    // Value filling
    if (matchedEl instanceof HTMLSelectElement) {
      const valStr = String(rawValue).trim().toLowerCase();
      let matchedOpt: HTMLOptionElement | null = null;
      for (let i = 0; i < matchedEl.options.length; i++) {
        const opt = matchedEl.options[i]!;
        if (opt.value.toLowerCase() === valStr || (opt.text || '').trim().toLowerCase() === valStr) {
          matchedOpt = opt;
          break;
        }
      }
      if (!matchedOpt && !isNaN(Number(rawValue)) && matchedEl.options[Number(rawValue)]) {
        matchedOpt = matchedEl.options[Number(rawValue)]!;
      }
      if (!matchedOpt) {
        for (let i = 0; i < matchedEl.options.length; i++) {
          const opt = matchedEl.options[i]!;
          if ((opt.text || '').trim().toLowerCase().includes(valStr)) {
            matchedOpt = opt;
            break;
          }
        }
      }
      if (matchedOpt) {
        matchedEl.value = matchedOpt.value;
        matchedEl.dispatchEvent(new InputEvent('input', { bubbles: true }));
        matchedEl.dispatchEvent(new Event('change', { bubbles: true }));
        filled.push({ field: key, elementId: heroId, matchedBy, type: 'select' });
      } else {
        skipped.push({ field: key, reason: 'OPTION_NOT_FOUND' });
      }
    } else if (matchedEl instanceof HTMLInputElement && ['checkbox', 'radio'].includes(matchedEl.type)) {
      const desiredChecked = Boolean(rawValue);
      if (matchedEl.checked !== desiredChecked) {
        matchedEl.click();
        if (matchedEl.checked !== desiredChecked) {
          matchedEl.checked = desiredChecked;
          matchedEl.dispatchEvent(new InputEvent('input', { bubbles: true }));
          matchedEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      filled.push({ field: key, elementId: heroId, matchedBy, type: matchedEl.type });
    } else if (matchedEl instanceof HTMLInputElement || matchedEl instanceof HTMLTextAreaElement) {
      const textVal = String(rawValue);
      matchedEl.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
      matchedEl.focus();

      // Bypass prototype setter for controlled frameworks
      const proto = matchedEl instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) {
        setter.call(matchedEl, textVal);
      } else {
        matchedEl.value = textVal;
      }
      matchedEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
      matchedEl.dispatchEvent(new Event('change', { bubbles: true }));

      filled.push({
        field: key,
        elementId: heroId,
        matchedBy,
        type: matchedEl instanceof HTMLInputElement ? matchedEl.type || 'text' : 'textarea',
      });
    }
  }

  // Validate form if form is HTMLFormElement
  let valid = true;
  if (options.validate !== false && formContainer instanceof HTMLFormElement) {
    valid = formContainer.checkValidity();
  }

  // Submit if requested
  let submitted = false;
  if (options.submit && valid) {
    const submitBtn = formContainer.querySelector(
      'button[type="submit"], input[type="submit"], button:not([type="button"]):not([type="reset"])'
    ) as HTMLElement | null;

    if (submitBtn) {
      submitBtn.click();
      submitted = true;
    } else if (formContainer instanceof HTMLFormElement && typeof formContainer.requestSubmit === 'function') {
      formContainer.requestSubmit();
      submitted = true;
    } else if (formContainer instanceof HTMLFormElement) {
      formContainer.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      submitted = true;
    }
  }

  const summary = `Berhasil mengisi ${filled.length} field, ${skipped.length} dilewati.${submitted ? ' Formulir dikirimkan (submitted).' : ''}`;

  return {
    ok: filled.length > 0,
    filled,
    skipped,
    submitted,
    valid,
    summary,
  };
}

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

export function captureFormCheckpoint(): {
  url: string;
  fields: Array<{
    elementId?: number;
    selector?: string;
    name?: string;
    id?: string;
    tag: string;
    type?: string;
    value?: string;
    checked?: boolean;
  }>;
} {
  const url = window.location.href;
  const elements = Array.from(document.querySelectorAll('input, select, textarea'));
  const fields: ReturnType<typeof captureFormCheckpoint>['fields'] = [];

  for (const el of elements) {
    if (el instanceof HTMLInputElement && ['button', 'submit', 'reset', 'password'].includes(el.type)) continue;
    const heroIdStr = el.getAttribute('data-hero-id');
    const elementId = heroIdStr ? parseInt(heroIdStr, 10) : undefined;
    const id = el.id || undefined;
    const name = (el as any).name || undefined;
    const tag = el.tagName.toLowerCase();
    let type: string | undefined = undefined;
    let value: string | undefined = undefined;
    let checked: boolean | undefined = undefined;

    if (el instanceof HTMLInputElement) {
      type = el.type || 'text';
      if (['checkbox', 'radio'].includes(type)) {
        checked = el.checked;
      } else {
        value = el.value;
      }
    } else if (el instanceof HTMLTextAreaElement) {
      type = 'textarea';
      value = el.value;
    } else if (el instanceof HTMLSelectElement) {
      type = 'select';
      value = el.value;
    }

    fields.push({
      elementId,
      selector: id ? `#${id}` : undefined,
      name,
      id,
      tag,
      type,
      value,
      checked,
    });
  }

  return { url, fields };
}

export function restoreFormCheckpoint(data: {
  fields: Array<{
    elementId?: number;
    selector?: string;
    name?: string;
    id?: string;
    tag: string;
    type?: string;
    value?: string;
    checked?: boolean;
  }>;
}): { restoredCount: number } {
  let restoredCount = 0;

  for (const item of data.fields || []) {
    let el: Element | null = null;
    if (item.elementId !== undefined) {
      el = document.querySelector(`[data-hero-id="${item.elementId}"]`);
    }
    if (!el && item.id) {
      el = document.getElementById(item.id);
    }
    if (!el && item.selector) {
      try { el = document.querySelector(item.selector); } catch {}
    }
    if (!el && item.name) {
      el = document.querySelector(`[name="${item.name}"]`);
    }

    if (!el) continue;

    if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type) && item.checked !== undefined) {
      if (el.checked !== item.checked) {
        el.click();
        if (el.checked !== item.checked) {
          el.checked = item.checked;
          el.dispatchEvent(new InputEvent('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      restoredCount++;
    } else if (el instanceof HTMLSelectElement && item.value !== undefined) {
      el.value = item.value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      restoredCount++;
    } else if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && item.value !== undefined) {
      const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) {
        setter.call(el, item.value);
      } else {
        el.value = item.value;
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      restoredCount++;
    }
  }

  return { restoredCount };
}
