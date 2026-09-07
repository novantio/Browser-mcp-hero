import { session } from 'electron';
import type { Session } from 'electron';
import { ProfileManager } from './profile-manager';

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  constructor(private readonly profiles: ProfileManager) {}

  getSession(profileId: string): Session {
    this.profiles.requireProfile(profileId);
    const existing = this.sessions.get(profileId);
    if (existing) return existing;
    const browserSession = session.fromPartition('persist:hero-' + profileId);
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.on('will-download', event => event.preventDefault());
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
    const browserSession = this.getSession(profileId);
    // Caller must dispose every tab belonging to this profile first.
    await browserSession.closeAllConnections();
    await browserSession.clearData();
    await browserSession.clearAuthCache();
    browserSession.flushStorageData();
    await browserSession.cookies.flushStore();
    this.sessions.delete(profileId);
  }
}
