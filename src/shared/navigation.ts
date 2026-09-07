import type { BrowserCommand, ViewBounds } from './types';

export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

export function resolveAddress(value: string): string {
  const input = value.trim();
  if (!input || input.length > 8192) throw new Error('Masukkan alamat atau kata pencarian yang valid.');
  const hostLike = /^(localhost|\[[\da-f:]+\]|[^\s/:]+\.[^\s/:]+)(:\d+)?([/?#]|$)/i.test(input);
  if (/^[a-z][a-z\d+.-]*:/i.test(input) && !/^localhost:\d+/i.test(input) && !hostLike) {
    if (!isWebUrl(input)) throw new Error('Hanya alamat HTTP dan HTTPS yang diizinkan.');
    return new URL(input).href;
  }
  if (hostLike && !/\s/.test(input)) {
    const url = `${/^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(input) ? 'http' : 'https'}://${input}`;
    if (!isWebUrl(url)) throw new Error('Alamat tidak valid.');
    return new URL(url).href;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}

export function parseCommand(value: unknown): BrowserCommand {
  if (!value || typeof value !== 'object') throw new Error('Perintah tidak valid.');
  const data = value as Record<string, unknown>;
  const simple = ['new-tab', 'back', 'forward', 'reload', 'stop', 'home'];
  if (typeof data.action !== 'string') throw new Error('Aksi tidak valid.');
  const keys = Object.keys(data);
  if (simple.includes(data.action) && keys.length === 1) return data as BrowserCommand;
  if (data.action === 'navigate' && typeof data.input === 'string' && data.input.length <= 8192 && keys.length === 2) {
    return { action: 'navigate', input: data.input };
  }
  if (['close-tab', 'switch-tab'].includes(data.action) && typeof data.tabId === 'string' && data.tabId.length <= 100 && keys.length === 2) {
    return { action: data.action as 'close-tab' | 'switch-tab', tabId: data.tabId };
  }
  throw new Error('Perintah tidak dikenal atau argumen tidak valid.');
}

export function parseBounds(value: unknown): ViewBounds {
  if (!value || typeof value !== 'object') throw new Error('Area browser tidak valid.');
  const bounds = value as Record<string, unknown>;
  if (Object.keys(bounds).length !== 4 || !['x', 'y', 'width', 'height'].every(key =>
    typeof bounds[key] === 'number' && Number.isFinite(bounds[key]) && Number.isInteger(bounds[key]) && bounds[key] >= 0 && bounds[key] <= 20000)) {
    throw new Error('Area browser tidak valid.');
  }
  return bounds as unknown as ViewBounds;
}
