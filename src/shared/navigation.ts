import type { BrowserCommand, ViewBounds } from './types';

export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

export function isAuthHost(value: string): boolean {
  if (!value || !isWebUrl(value)) return false;
  try {
    const { hostname, pathname } = new URL(value);
    const host = hostname.toLowerCase();
    return host === 'accounts.google.com' ||
           host.endsWith('.accounts.google.com') ||
           host === 'appleid.apple.com' ||
           host === 'login.microsoftonline.com' ||
           host === 'login.live.com' ||
           host === 'access.line.me' ||
           ((host === 'facebook.com' || host.endsWith('.facebook.com')) && /^\/(v[\d.]+\/)?dialog\/oauth|^\/login/.test(pathname)) ||
           (['x.com', 'twitter.com', 'api.twitter.com', 'api.x.com'].includes(host) && /\/oauth2?(\/|$)|^\/i\/oauth2/.test(pathname)) ||
           ((host === 'tiktok.com' || host.endsWith('.tiktok.com')) && /^\/(v2\/)?auth(\/|$)/.test(pathname)) ||
           (host === 'github.com' && /^\/login(\/oauth)?(\/|$)/.test(pathname));
  } catch { return false; }
}

export interface WindowOpenDetails {
  url?: string;
  frameName?: string;
  features?: string;
  disposition?: string;
}

/** Query parameters that only appear on OAuth / "log in with ..." authorization URLs. */
const OAUTH_PARAMS = ['client_id', 'redirect_uri', 'response_type', 'app_id', 'oauth_token'];

/**
 * Whether window.open should become a real child window (keeping window.opener) instead
 * of a tab. Login flows post their result back to the opener; turning them into tabs,
 * or dropping an about:blank window a script fills in later, makes the login fail.
 */
export function isPopupWindow(details: WindowOpenDetails): boolean {
  if (!details.url || details.url === 'about:blank') return true;
  if (details.features && details.features.trim().length > 0) return true;
  if (details.disposition === 'new-window') return true;
  if (details.frameName && details.frameName !== '_blank') return true;
  if (isAuthHost(details.url)) return true;
  try {
    const params = new URL(details.url).searchParams;
    if (OAUTH_PARAMS.some(name => params.has(name))) return true;
  } catch { /* Not a URL: handled by the caller's web-URL guard. */ }
  return false;
}

function prefersHttp(value: string): boolean {
  const host = value.split(/[/?#]/, 1)[0]!.replace(/:\d+$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (/\.local$/.test(host)) return true;
  if (/^\[.*\]$/.test(host)) return host === '[::1]';
  const octets = host.split('.');
  if (octets.length !== 4 || !octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return false;
  const [a, b] = octets.map(Number) as [number, number, number, number];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
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
    const url = `${prefersHttp(input) ? 'http' : 'https'}://${input}`;
    if (!isWebUrl(url)) throw new Error('Alamat tidak valid.');
    return new URL(url).href;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}

export function alternateScheme(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') parsed.protocol = 'http:';
    else if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    else return null;
    return parsed.href;
  } catch { return null; }
}

/** Normalizes a certificate host to lowercase without port or IPv6 brackets. */
export function normalizeCertHost(host: string): string {
  let entry = (host || '').trim().toLowerCase();
  if (!entry) return '';
  if (entry.startsWith('[')) {
    // Bracketed IPv6 literal, optionally followed by a port: [::1]:8443
    entry = entry.slice(1).split(']')[0] ?? '';
  } else if (entry.split(':').length === 2) {
    // A single colon means host:port (a bare IPv6 host has 2+ colons).
    entry = entry.replace(/:\d+$/, '');
  }
  return entry.replace(/^\[|\]$/g, '');
}

export function parseCommand(value: unknown): BrowserCommand {
  if (!value || typeof value !== 'object') throw new Error('Perintah tidak valid.');
  const data = value as Record<string, unknown>;
  const simple = ['new-tab', 'back', 'forward', 'reload', 'stop', 'home', 'save-session', 'open-google', 'stop-sharing'];
  if (typeof data.action !== 'string') throw new Error('Aksi tidak valid.');
  const keys = Object.keys(data);
  if (simple.includes(data.action) && keys.length === 1) return data as BrowserCommand;
  if (data.action === 'navigate' && typeof data.input === 'string' && data.input.length <= 8192 && keys.length === 2) {
    return { action: 'navigate', input: data.input };
  }
  if (['close-tab', 'switch-tab'].includes(data.action) && typeof data.tabId === 'string' && data.tabId.length <= 100 && keys.length === 2) {
    return { action: data.action as 'close-tab' | 'switch-tab', tabId: data.tabId };
  }
  if (data.action === 'create-profile' && typeof data.name === 'string' && data.name.length <= 40 && keys.length === 2) {
    return { action: 'create-profile', name: data.name };
  }
  if (['switch-profile', 'delete-profile'].includes(data.action) && typeof data.profileId === 'string' &&
      /^[a-z0-9][a-z0-9-]{0,63}$/.test(data.profileId) && keys.length === 2) {
    return { action: data.action as 'switch-profile' | 'delete-profile', profileId: data.profileId };
  }

  if (data.action === 'rename-profile' && typeof data.profileId === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(data.profileId) &&
      typeof data.name === 'string' && data.name.length <= 40 && keys.length === 3) {
    return { action: 'rename-profile', profileId: data.profileId, name: data.name };
  }
  if (data.action === 'duplicate-profile' && typeof data.profileId === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(data.profileId) &&
      typeof data.name === 'string' && data.name.length <= 40 && typeof data.copyLogin === 'boolean' && keys.length === 4) {
    return { action: 'duplicate-profile', profileId: data.profileId, name: data.name, copyLogin: data.copyLogin };
  }
  if (data.action === 'share-session' && keys.length === 2 && Array.isArray(data.targetIds) &&
      data.targetIds.length > 0 && data.targetIds.length <= 20 &&
      data.targetIds.every(id => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) &&
      new Set(data.targetIds).size === data.targetIds.length) {
    return { action: 'share-session', targetIds: data.targetIds as string[] };
  }
  if (data.action === 'resume-human-intervention' && typeof data.taskId === 'string' && data.taskId.length <= 100 && keys.length === 2) {
    return { action: 'resume-human-intervention', taskId: data.taskId };
  }
  if (data.action === 'set-media-mode' && (data.mode === 'full' || data.mode === 'no-video' || data.mode === 'lite') && keys.length === 2) {
    return { action: 'set-media-mode', mode: data.mode };
  }
  if (data.action === 'certificate-response' && typeof data.allow === 'boolean' && keys.length === 2) {
    return { action: 'certificate-response', allow: data.allow };
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
