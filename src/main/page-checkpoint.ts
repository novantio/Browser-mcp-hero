/**
 * Form checkpoints: capture and restore field values for rollback.
 * Runs inside the browser page (WebContentsView) without module dependencies:
 * serialized with Function.prototype.toString, so it must not import anything.
 */

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
