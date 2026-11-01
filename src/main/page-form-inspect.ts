/**
 * Form Intelligence: list forms, fields, options and submit buttons.
 * Runs inside the browser page (WebContentsView) without module dependencies:
 * serialized with Function.prototype.toString, so it must not import anything.
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
