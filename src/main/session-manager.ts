import { session } from 'electron';
import type { Session } from 'electron';
import { ProfileManager } from './profile-manager';
import { DownloadManager } from './download-manager';

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly downloadManager: DownloadManager;

  constructor(private readonly profiles: ProfileManager, downloadManager?: DownloadManager) {
    this.downloadManager = downloadManager || new DownloadManager();
  }

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
    this.downloadManager.attachSession(browserSession);

    // Automatically persist session cookies across restarts by giving them an expiration date
    browserSession.cookies.on('changed', (_event, cookie, _cause, removed) => {
      if (removed) return;
      if (cookie.session) {
        const domain = cookie.domain || '';
        const cleanDomain = domain.startsWith('.') ? domain.slice(1) : domain;
        if (!cleanDomain) return;
        const url = (cookie.secure ? 'https://' : 'http://') + cleanDomain + (cookie.path || '/');
        const expirationDate = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days
        void browserSession.cookies.set({
          url,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite as any,
          expirationDate,
        }).catch(() => { /* ignore */ });
      }
    });

    this.sessions.set(profileId, browserSession);
    return browserSession;
  }

  async flush(): Promise<void> {
    await Promise.all([...this.sessions.values()].map(async browserSession => {
      browserSession.flushStorageData();
      await browserSession.cookies.flushStore();
    }));
  }

  async clearProfile(profileId: string): Promise<void> {
    this.profiles.assertDeletable(profileId);
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
