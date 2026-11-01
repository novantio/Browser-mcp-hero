/**
 * Runs inside the browser page; serialized without module dependencies.
 * Scrolls the page, or the nearest scrollable container around a target element
 * (comment panels, chat lists, sidebars), and reports where it ended up.
 */
export function scrollPageArea(options: {
  elementId?: number; selector?: string; text?: string;
  direction?: 'up' | 'down' | 'top' | 'bottom'; amount?: number;
}): { target: 'page' | 'element'; before: number; after: number; max: number; atStart: boolean; atEnd: boolean } | { error: string } {
  let start: Element | null = null;
  if (options.elementId !== undefined) start = document.querySelector(`[data-hero-id="${options.elementId}"]`);
  else if (options.selector) {
    try { start = document.querySelector(options.selector); } catch { return { error: 'INVALID_SELECTOR' }; }
  } else if (options.text) {
    // Smallest visible element whose own text contains the phrase (e.g. "466 comments").
    const needle = options.text.trim().toLowerCase();
    let best: Element | null = null;
    for (const el of document.body ? document.body.querySelectorAll('*') : []) {
      const text = ((el as HTMLElement).innerText || '').trim().toLowerCase();
      if (!text.includes(needle) || !el.getClientRects().length) continue;
      if (!best || best.contains(el)) best = el;
    }
    start = best;
  }
  if ((options.elementId !== undefined || options.selector || options.text) && !start) return { error: 'ELEMENT_NOT_FOUND' };

  const scrollable = (el: Element): boolean => {
    if (el.scrollHeight <= el.clientHeight + 4) return false;
    return /auto|scroll|overlay/.test(getComputedStyle(el).overflowY);
  };
  let box: Element | null = start;
  while (box && box !== document.body && box !== document.documentElement && !scrollable(box)) box = box.parentElement;
  const isPage = !box || box === document.body || box === document.documentElement;
  const area = (isPage ? (document.scrollingElement || document.documentElement) : box) as Element;

  const max = Math.max(0, area.scrollHeight - area.clientHeight);
  const before = area.scrollTop;
  const amount = Math.max(1, Math.min(options.amount ?? 600, 20000));
  const direction = options.direction || 'down';
  // Instant, not smooth: smooth scrolling is skipped or interrupted on some sites.
  const next = direction === 'top' ? 0 : direction === 'bottom' ? max : direction === 'up' ? before - amount : before + amount;
  area.scrollTop = Math.max(0, Math.min(next, max));
  const after = area.scrollTop;
  return {
    target: isPage ? 'page' : 'element',
    before: Math.round(before), after: Math.round(after), max: Math.round(max),
    atStart: after <= 1, atEnd: after >= max - 2,
  };
}
