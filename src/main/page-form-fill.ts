/**
 * Smart Form Filling: resolve fields by label/name/placeholder and fill them.
 * Runs inside the browser page (WebContentsView) without module dependencies:
 * serialized with Function.prototype.toString, so it must not import anything.
 */

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
