/**
 * Runs inside the browser page; serialized without module dependencies.
 * Scrolls the page, or the nearest scrollable container around a target element
 * (comment panels, chat lists, sidebars), and reports where it ended up.
 */
export function scrollPageArea(options: {
  elementId?: number; selector?: string; text?: string;
  direction?: 'up' | 'down' | 'top' | 'bottom'; amount?: number;
}): { target: 'page' | 'element'; before: number; after: number; max: number; atStart: boolean; atEnd: boolean } | { error: string } {
  const scrollable = (el: Element): boolean => {
    if (el.scrollHeight <= el.clientHeight + 4) return false;
    return /auto|scroll|overlay/.test(getComputedStyle(el).overflowY);
  };
  const containerOf = (el: Element | null): Element | null => {
    let box = el;
    while (box && box !== document.body && box !== document.documentElement && !scrollable(box)) box = box.parentElement;
    return box && box !== document.body && box !== document.documentElement ? box : null;
  };

  let start: Element | null = null;
  if (options.elementId !== undefined) start = document.querySelector(`[data-hero-id="${options.elementId}"]`);
  else if (options.selector) {
    try { start = document.querySelector(options.selector); } catch { return { error: 'INVALID_SELECTOR' }; }
  } else if (options.text) {
    // Innermost visible elements containing the phrase. The same word often also sits
    // outside the panel (TikTok's "Comments" tab above its scrolling list), so prefer a
    // match that lives inside a scrollable container.
    const needle = options.text.trim().toLowerCase();
    // textContent, not innerText: innerText forces layout for every node on big pages.
    const has = (el: Element) => (el.textContent || '').toLowerCase().includes(needle);
    const matches = [...(document.body ? document.body.querySelectorAll('*') : [])]
      .filter(el => has(el) && el.getClientRects().length > 0 && ![...el.children].some(has));
    start = matches.find(el => containerOf(el)) ?? matches[0] ?? null;
  }
  if ((options.elementId !== undefined || options.selector || options.text) && !start) return { error: 'ELEMENT_NOT_FOUND' };

  const box: Element | null = containerOf(start);
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
