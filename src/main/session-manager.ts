import { session } from 'electron';
import type { Session } from 'electron';
import { randomUUID } from 'node:crypto';
import { ProfileManager } from './profile-manager';
import { DownloadManager } from './download-manager';
import { detectSessionSocialLogins } from './social-detector';
import { CertificateTrustStore } from './certificate-trust';
import { MediaFilter } from './media-filter';
import { normalizeCertHost } from '../shared/navigation';
import { belongsToSite, siteOf } from '../shared/site-domain';
import type { SocialAccountInfo } from '../shared/profiles';

export interface CertificatePrompt {
  requestId: string;
  host: string;
  url: string;
}

type CertificatePromptHandler = (prompt: CertificatePrompt) => void;

/**
 * Sites whose session cookies must stay session-only. Shopee keeps its anti-bot
 * verification state in session cookies; persisting them made a failed verification
 * stick for days.
 */
export function keepSessionOnly(host: string): boolean {
  return host.split('.').includes('shopee');
}

interface PendingCertificate {
  callback: (verificationResult: number) => void;
  host: string;
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly downloadManager: DownloadManager;
  private readonly socialCache = new Map<string, { timestamp: number; accounts: SocialAccountInfo[] }>();
  private readonly trustStore: CertificateTrustStore;
  /** Lite mode (no images/video/fonts) shared by every profile session. */
  readonly media: MediaFilter;
  private readonly pendingCertificates = new Map<string, PendingCertificate>();
  private certificatePromptHandler: CertificatePromptHandler | null = null;
  // Host of the current top-level navigation. Only this host may raise a
  // certificate prompt; sub-resource certs (fonts, CDNs, trackers) never do.
  private expectedMainFrameHosts = new Map<string, string>();

  constructor(private readonly profiles: ProfileManager, downloadManager?: DownloadManager, trustDirectory?: string) {
    this.downloadManager = downloadManager || new DownloadManager();
    this.trustStore = new CertificateTrustStore(trustDirectory || this.downloadManager.userDataDirectory());
    this.media = new MediaFilter(trustDirectory || this.downloadManager.userDataDirectory());
  }

  onCertificatePrompt(handler: CertificatePromptHandler): void {
    this.certificatePromptHandler = handler;
  }

  /** Declares the host the app is intentionally navigating a profile to (main frame). */
  expectMainFrameHost(profileId: string, host: string): void {
    const sessionOwner = this.profiles.getSessionProfileId(profileId);
    const normalized = normalizeCertHost(host);
    if (normalized) this.expectedMainFrameHosts.set(sessionOwner, normalized);
    else this.expectedMainFrameHosts.delete(sessionOwner);
  }

  private expectedHostFor(request: { hostname: string }): boolean {
    const host = normalizeCertHost(request.hostname);
    if (!host) return false;
    for (const expected of this.expectedMainFrameHosts.values()) {
      if (expected === host) return true;
    }
    return false;
  }

  /** Records the user's decision for a pending certificate warning and unblocks the load. */
  resolveCertificate(requestId: string, allow: boolean): boolean {
    const pending = this.pendingCertificates.get(requestId);
    if (!pending) return false;
    this.pendingCertificates.delete(requestId);
    if (allow) {
      this.trustStore.add(pending.host);
      pending.callback(0);
    } else {
      pending.callback(-3);
    }
    return true;
  }

  cancelPendingCertificate(requestId: string): void {
    const pending = this.pendingCertificates.get(requestId);
    if (!pending) return;
    this.pendingCertificates.delete(requestId);
    pending.callback(-3);
  }

  listTrustedCertificateHosts(): string[] { return this.trustStore.list(); }
  addTrustedCertificateHost(host: string): boolean { return this.trustStore.add(host); }
  removeTrustedCertificateHost(host: string): boolean { return this.trustStore.remove(host); }


  getDownloadManager(): DownloadManager {
    return this.downloadManager;
  }

  getSession(profileId: string): Session { return this.getPrivateSession(this.profiles.getSessionProfileId(profileId)); }

  private getPrivateSession(profileId: string): Session {
    this.profiles.requireProfile(profileId);
    const existing = this.sessions.get(profileId);
    if (existing) return existing;
    const browserSession = session.fromPartition('persist:hero-' + profileId);
    const cleanUserAgent = browserSession.getUserAgent().replace(/Electron\/[0-9.]+\s*/g, '');
    browserSession.setUserAgent(cleanUserAgent);
    browserSession.setPermissionRequestHandler((_contents, permission, callback) => {
      if (['fullscreen', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission)) {
        return callback(true);
      }
      callback(false);
    });
    browserSession.setPermissionCheckHandler((_contents, permission) => {
      if (['fullscreen', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission)) {
        return true;
      }
      return false;
    });
    // Certificate handling: accept previously trusted main-frame hosts silently;
    // otherwise ask the app (like a browser's "Proceed" interstitial). Only the
    // host the app explicitly navigated to can prompt; every other certificate
    // (sub-resources such as fonts, CDNs, APIs) uses Chromium's default verdict,
    // so an invalid certificate here never blocks page assets or leaks prompts.
    browserSession.setCertificateVerifyProc((request, callback) => {
      // Electron reports "net::OK" (not the documented "OK"); errorCode is format-independent.
      if (request.errorCode === 0) return callback(-3);
      const host = normalizeCertHost(request.hostname);
      if (host && this.trustStore.has(host)) return callback(0);
      if (!this.certificatePromptHandler || !host || !this.expectedHostFor(request)) return callback(-3);
      const requestId = randomUUID();
      this.pendingCertificates.set(requestId, { callback, host });
      this.certificatePromptHandler({ requestId, host, url: `https://${request.hostname}/` });
    });
    this.downloadManager.attachSession(browserSession);
    this.media.attach(browserSession);

    // Optionally keep session cookies across restarts by giving them a 30-day expiry.
    // Per-profile setting; never for sites whose session state must expire (keepSessionOnly).
    browserSession.cookies.on('changed', (_event, cookie, _cause, removed) => {
      this.socialCache.delete(profileId);
      if (removed || !cookie.session) return;
      const cleanDomain = (cookie.domain || '').replace(/^\./, '');
      if (!cleanDomain || keepSessionOnly(cleanDomain) || !this.profiles.isPersistSessionCookies(profileId)) return;
      // Host-only cookies must be rewritten without a Domain attribute, otherwise Chromium
      // keeps the session cookie and adds a second, domain-wide copy.
      const hostOnly = cookie.hostOnly || cookie.name.startsWith('__Host-');
      void browserSession.cookies.set({
        url: (cookie.secure ? 'https://' : 'http://') + cleanDomain + (cookie.path || '/'),
        name: cookie.name,
        value: cookie.value,
        ...(hostOnly ? {} : { domain: cookie.domain }),
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        expirationDate: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
      }).catch(() => { /* ignore */ });
    });

    this.sessions.set(profileId, browserSession);
    return browserSession;
  }

  async getSocialLogins(profileId: string): Promise<SocialAccountInfo[]> {
    const sessionOwnerId = this.profiles.getSessionProfileId(profileId);
    const cached = this.socialCache.get(sessionOwnerId);
    const now = Date.now();
    if (cached && now - cached.timestamp < 10000) {
      return cached.accounts;
    }
    const browserSession = this.getSession(profileId);
    const accounts = await detectSessionSocialLogins(browserSession);
    this.socialCache.set(sessionOwnerId, { timestamp: now, accounts });
    return accounts;
  }

  async getLoggedInServices(profileId: string): Promise<string[]> {
    const accounts = await this.getSocialLogins(profileId);
    return accounts.filter(a => a.loggedIn).map(a => a.platform);
  }

  getCachedLoggedInServices(profileId: string): string[] {
    const sessionOwnerId = this.profiles.getSessionProfileId(profileId);
    const cached = this.socialCache.get(sessionOwnerId);
    if (!cached) return [];
    return cached.accounts.filter(a => a.loggedIn).map(a => a.platform);
  }

  getCachedSocialLogins(profileId: string): SocialAccountInfo[] {
    const sessionOwnerId = this.profiles.getSessionProfileId(profileId);
    const cached = this.socialCache.get(sessionOwnerId);
    return cached ? cached.accounts : [];
  }


  /**
   * Copies every cookie (this is what carries Google and most site logins) from one
   * profile's session into another, independent one. localStorage/IndexedDB are not
   * copied. Returns how many cookies were written.
   */
  async copyCookies(fromProfileId: string, toProfileId: string): Promise<{ copied: number; failed: number }> {
    const source = this.getSession(fromProfileId);
    const target = this.getSession(toProfileId);
    await source.cookies.flushStore();
    const cookies = await source.cookies.get({});
    let copied = 0, failed = 0;
    for (const cookie of cookies) {
      const host = (cookie.domain || '').replace(/^\./, '');
      if (!host) { failed++; continue; }
      // __Host- cookies must be set without a Domain attribute; host-only cookies too.
      const hostOnly = cookie.hostOnly || cookie.name.startsWith('__Host-');
      try {
        await target.cookies.set({
          url: (cookie.secure ? 'https://' : 'http://') + host + (cookie.path || '/'),
          name: cookie.name, value: cookie.value, path: cookie.path,
          ...(hostOnly ? {} : { domain: cookie.domain }),
          secure: cookie.secure, httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
          ...(cookie.session || cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate }),
        });
        copied++;
      } catch { failed++; }
    }
    await target.cookies.flushStore();
    this.socialCache.delete(this.profiles.getSessionProfileId(toProfileId));
    return { copied, failed };
  }

  async flush(): Promise<void> {
    await Promise.all([...this.sessions.values()].map(async browserSession => {
      browserSession.flushStorageData();
      await browserSession.cookies.flushStore();
    }));
  }

  /**
   * "Clear site data" for one site in one profile: cookies of the domain and its
   * subdomains plus local/session storage, IndexedDB, cache storage and service workers
   * of the matching origins. Logs the profile out of that site.
   */
  /** Sites with stored cookies in a profile, grouped by site (subdomains folded in), most cookies first. */
  async listSiteData(profileId: string): Promise<Array<{ site: string; cookies: number; hosts: string[] }>> {
    const bySite = new Map<string, { cookies: number; hosts: Set<string> }>();
    for (const cookie of await this.getSession(profileId).cookies.get({})) {
      const host = (cookie.domain || '').replace(/^\./, '').toLowerCase();
      if (!host) continue;
      const site = siteOf(host);
      const entry = bySite.get(site) ?? { cookies: 0, hosts: new Set<string>() };
      entry.cookies++;
      entry.hosts.add(host);
      bySite.set(site, entry);
    }
    return [...bySite].map(([site, e]) => ({ site, cookies: e.cookies, hosts: [...e.hosts].sort() }))
      .sort((a, b) => b.cookies - a.cookies || a.site.localeCompare(b.site));
  }

  async clearSiteData(profileId: string, domain: string): Promise<{ cookies: number; origins: string[] }> {
    const browserSession = this.getSession(profileId);
    const host = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    const cookies = (await browserSession.cookies.get({})).filter(cookie => belongsToSite(cookie.domain || '', host));
    const hosts = new Set([host, 'www.' + host, ...cookies.map(cookie => (cookie.domain || '').replace(/^\./, ''))]);
    for (const cookie of cookies) {
      const cookieHost = (cookie.domain || '').replace(/^\./, '');
      await browserSession.cookies.remove(`${cookie.secure ? 'https' : 'http'}://${cookieHost}${cookie.path || '/'}`, cookie.name).catch(() => {});
    }
    const origins = [...hosts].flatMap(h => [`https://${h}`, `http://${h}`]);
    for (const origin of origins) {
      await browserSession.clearStorageData({ origin, storages: ['localstorage', 'indexdb', 'cachestorage', 'serviceworkers', 'filesystem', 'shadercache'] }).catch(() => {});
    }
    await browserSession.cookies.flushStore();
    this.socialCache.delete(this.profiles.getSessionProfileId(profileId));
    return { cookies: cookies.length, origins: [...hosts] };
  }

  async clearProfile(profileId: string): Promise<void> {
    this.profiles.assertDeletable(profileId);
    this.socialCache.delete(profileId);
    const browserSession = this.getPrivateSession(profileId);
    // Caller must dispose every tab belonging to this profile first.
    await browserSession.closeAllConnections();
    await browserSession.clearData();
    await browserSession.clearAuthCache();
    browserSession.flushStorageData();
    await browserSession.cookies.flushStore();
    this.sessions.delete(profileId);
  }
}

