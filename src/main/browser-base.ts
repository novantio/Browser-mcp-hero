import { SelectorHealer } from './data/selector-healer';
import { randomUUID } from 'node:crypto';
import { BrowserWindow, WebContentsView } from 'electron';
import { ProfileManager } from './profile-manager';
import { SessionManager } from './session-manager';
import type { CertificatePrompt } from './session-manager';
import type { BrowserCommand, BrowserState, BrowserTab, ViewBounds } from '../shared/types';
import { NetworkIntelligence } from './data/network-intelligence';
import { ConsoleMonitor } from './console-monitor';
import { execWithTimeout } from './page-exec';

export interface ExpectCondition { selector?: string; text?: string; url?: string; timeoutMs?: number }
export interface TabEntry { state: BrowserTab; view: WebContentsView | null; profileId: string }

/** Tab registry, profile switching, layout and certificate prompts (base of BrowserManager). */
export abstract class BrowserBase {
  protected readonly tabs = new Map<string, TabEntry>();
  protected readonly popups = new Map<string, Set<BrowserWindow>>();
  protected activeTabId = '';
  protected bounds: ViewBounds = { x: 0, y: 124, width: 900, height: 600 };
  protected readonly activeTabs = new Map<string, string>();
  protected disposed = false;
  protected readonly consoleMonitor = new ConsoleMonitor();
  protected network: NetworkIntelligence = new NetworkIntelligence();
  protected readonly healer = new SelectorHealer();
  protected readonly checkpoints = new Map<string, { url: string; timestamp: number; fields: any[] }>();

  constructor(protected readonly window: BrowserWindow, protected readonly publish: (state: BrowserState) => void,
      protected readonly profiles: ProfileManager, protected readonly sessions: SessionManager) {
    this.sessions.onCertificatePrompt(prompt => this.handleCertificatePrompt(prompt));
    this.newTab();
  }

  protected abstract navigate(input: string): void;
  abstract respondToCertificatePrompt(allow: boolean): void;
  protected abstract createView(tab: TabEntry): WebContentsView;

  protected handleCertificatePrompt(prompt: CertificatePrompt): void {
    // Attach the warning to the tab that is loading this host, not blindly to the active tab.
    const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } };
    const candidates = [...this.tabs.values()].filter(entry => hostOf(entry.state.url) === prompt.host);
    const tab = candidates.find(entry => entry.state.id === this.activeTabId) ?? candidates[0] ?? this.tabs.get(this.activeTabId);
    if (!tab) { this.sessions.cancelPendingCertificate(prompt.requestId); return; }
    if (tab.state.certificateWarning) this.sessions.cancelPendingCertificate(tab.state.certificateWarning.requestId);
    tab.state.certificateWarning = { requestId: prompt.requestId, host: prompt.host, url: prompt.url };
    tab.state.loading = false;
    tab.state.error = null;
    this.emit();
  }

  protected run(contents: Electron.WebContents, code: string, timeoutMs = 10000): Promise<any> {
    return execWithTimeout(contents, code, timeoutMs);
  }

  protected clearCertificateWarning(tab: TabEntry): void {
    const warning = tab.state.certificateWarning;
    if (!warning) return;
    tab.state.certificateWarning = null;
    this.sessions.cancelPendingCertificate(warning.requestId);
  }

  getSessions(): SessionManager {
    return this.sessions;
  }


  setNetworkIntelligence(net: NetworkIntelligence): void {
    this.network = net;
    for (const tab of this.tabs.values()) {
      if (tab.view && !tab.view.webContents.isDestroyed()) {
        this.network.attach(tab.view.webContents);
      }
    }
  }

  snapshot(): BrowserState {
    return {
      tabs: [...this.tabs.values()].filter(tab => tab.profileId === this.profiles.activeProfileId).map(tab => ({ ...tab.state })),
      activeTabId: this.activeTabId,
      profiles: this.profiles.listProfiles().map(p => ({
        ...p,
        loggedInServices: this.sessions.getCachedLoggedInServices(p.id),
        socialAccounts: this.sessions.getCachedSocialLogins(p.id),
      })),
      activeProfileId: this.profiles.activeProfileId,
      persistent: true,
      mediaMode: this.sessions.media.getMode(),
    };
  }


  protected emit(): void {
    if (!this.disposed) this.publish(this.snapshot());
  }

  protected active(): TabEntry {
    const tab = this.tabs.get(this.activeTabId);
    if (!tab) throw new Error('Tab tidak ditemukan.');
    return tab;
  }

  newTab(): void {
    if (this.tabs.size >= 30) throw new Error('Maksimal 30 tab. Tutup satu tab terlebih dahulu.');
    const id = randomUUID();
    this.tabs.set(id, { state: { id, title: 'Tab baru', url: '', loading: false, canGoBack: false, canGoForward: false, error: null }, view: null, profileId: this.profiles.activeProfileId });
    this.activeTabId = id;
    this.activeTabs.set(this.profiles.activeProfileId, id);
    this.layout();
    this.emit();
  }

  protected closeTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab || tab.profileId !== this.profiles.activeProfileId) throw new Error('Tab tidak ditemukan di profil aktif.');
    const ids = [...this.tabs.values()].filter(entry => entry.profileId === tab.profileId).map(entry => entry.state.id);
    const index = ids.indexOf(id);
    this.tabs.delete(id);
    const popups = this.popups.get(id);
    if (popups) {
      for (const popup of popups) {
        if (!popup.isDestroyed()) popup.close();
      }
      this.popups.delete(id);
    }
    if (tab.view) {
      this.window.contentView.removeChildView(tab.view);
      tab.view.webContents.close();
    }
    if (ids.length === 1) { this.newTab(); return; }
    if (this.activeTabId === id) this.activeTabId = ids[index + 1] ?? ids[index - 1]!;
    this.activeTabs.set(this.profiles.activeProfileId, this.activeTabId);
    this.layout();
    this.emit();
  }

  execute(command: BrowserCommand): void {
    switch (command.action) {
      case 'new-tab': this.newTab(); this.focusAddress(); return;
      case 'close-tab': this.closeTab(command.tabId); return;
      case 'switch-tab':
        if (this.tabs.get(command.tabId)?.profileId !== this.profiles.activeProfileId) throw new Error('Tab tidak ditemukan di profil aktif.');
        this.activeTabId = command.tabId;
        this.activeTabs.set(this.profiles.activeProfileId, command.tabId);
        this.layout(); this.emit(); return;
      case 'navigate': this.navigate(command.input); return;
      case 'certificate-response': this.respondToCertificatePrompt(command.allow); return;
      case 'home': this.newTab(); this.focusAddress(); return;
    }
    const tab = this.active();
    const contents = tab.view?.webContents;
    if (!contents) return;
    if (command.action === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
    if (command.action === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
    if (command.action === 'reload') {
      tab.state.error = null;
      this.layout();
      contents.reload();
    }
    if (command.action === 'stop') contents.stop();
  }

  /** Creates a profile; `switchTo: false` keeps the human's current profile (used by agents). */
  createProfile(name: string, options: { switchTo?: boolean } = {}): string {
    if (options.switchTo !== false && this.tabs.size >= 30) throw new Error('Tutup satu tab sebelum membuat profil.');
    const profile = this.profiles.createProfile(name);
    if (options.switchTo !== false) this.switchProfile(profile.id);
    else this.emit();
    return profile.id;
  }

  renameProfile(id: string, name: string): void {
    this.profiles.renameProfile(id, name);
    this.emit();
  }

  /**
   * New independent profile from an existing one. With copyLogin the source cookies
   * (Google and other site logins) are copied, so both stay signed in separately.
   */
  /** Clears one site's cookies and storage in a profile, then reloads that profile's tabs on the site. */
  async clearSiteData(profileId: string, domain: string): Promise<{ cookies: number; origins: string[] }> {
    const result = await this.sessions.clearSiteData(profileId, domain);
    for (const tab of this.tabs.values()) {
      if (tab.profileId !== profileId || !tab.view || !tab.state.url) continue;
      let host = '';
      try { host = new URL(tab.state.url).hostname; } catch { continue; }
      if (result.origins.includes(host)) tab.view.webContents.reload();
    }
    this.emit();
    return result;
  }

  async duplicateProfile(sourceId: string, options: { name?: string; copyLogin?: boolean; switchTo?: boolean } = {}): Promise<{ profileId: string; name: string; copiedCookies: number }> {
    this.profiles.requireProfile(sourceId);
    const name = options.name?.trim() || this.profiles.suggestCopyName(sourceId);
    const profileId = this.profiles.createProfile(name).id;
    let copiedCookies = 0;
    if (options.copyLogin !== false) {
      try { copiedCookies = (await this.sessions.copyCookies(sourceId, profileId)).copied; }
      catch (error) { this.profiles.deleteProfile(profileId); throw error; }
    }
    if (options.switchTo) this.switchProfile(profileId);
    else this.emit();
    return { profileId, name, copiedCookies };
  }

  switchProfile(id: string): void {
    if (id === this.profiles.activeProfileId) return;
    if (!this.activeTabs.has(id) && this.tabs.size >= 30) throw new Error('Tutup satu tab sebelum membuka profil lain.');
    this.profiles.switchProfile(id);
    this.updatePopupVisibility();
    const active = this.activeTabs.get(id);
    if (!active) { this.newTab(); return; }
    this.activeTabId = active;
    this.layout();
    this.emit();
  }

  protected updatePopupVisibility(): void {
    for (const [tabId, popupSet] of this.popups) {
      const tab = this.tabs.get(tabId);
      const isCurrent = tab && tab.profileId === this.profiles.activeProfileId;
      for (const popup of popupSet) {
        if (!popup.isDestroyed()) {
          if (isCurrent) {
            if (!popup.isVisible()) popup.show();
          } else {
            if (popup.isVisible()) popup.hide();
          }
        }
      }
    }
  }

  async deleteProfile(id: string): Promise<void> {
    this.profiles.assertDeletable(id);
    for (const [tabId, tab] of this.tabs) {
      if (tab.profileId !== id) continue;
      this.tabs.delete(tabId);
      const popups = this.popups.get(tabId);
      if (popups) {
        for (const popup of popups) {
          if (!popup.isDestroyed()) popup.close();
        }
        this.popups.delete(tabId);
      }
      if (tab.view) {
        this.window.contentView.removeChildView(tab.view);
        tab.view.webContents.close();
      }
    }
    this.activeTabs.delete(id);
    // Keep valid visible state even if clearing or metadata persistence fails.
    if (this.profiles.activeProfileId === id) this.switchProfile('default');
    await this.sessions.clearProfile(id);
    this.profiles.deleteProfile(id);
    this.emit();
  }

  async changeSharedSession(change: () => string[]): Promise<void> {
    await this.sessions.flush();
    const changed = new Set(change());
    for (const [id, tab] of this.tabs) {
      if (!changed.has(tab.profileId)) continue;
      this.tabs.delete(id);
      const popups = this.popups.get(id);
      if (popups) {
        for (const popup of popups) {
          if (!popup.isDestroyed()) popup.close();
        }
        this.popups.delete(id);
      }
      if (tab.view) {
        this.window.contentView.removeChildView(tab.view);
        tab.view.webContents.close();
      }
    }
    for (const id of changed) this.activeTabs.delete(id);
    if (changed.has(this.profiles.activeProfileId)) this.newTab();
    else { this.layout(); this.emit(); }
  }

  setBounds(bounds: ViewBounds): void { this.bounds = bounds; this.layout(); }

  /** Web pages are native views drawn above the app UI; hide them while a UI dialog is open. */
  protected overlayOpen = false;
  setOverlay(open: boolean): void { this.overlayOpen = open; this.layout(); }

  layout(): void {
    const [width = 0, height = 0] = this.window.getContentSize();
    const x = Math.min(this.bounds.x, width);
    const y = Math.min(this.bounds.y, height);
    for (const [id, tab] of this.tabs) {
      if (!tab.view) continue;
      tab.view.setBounds({ x, y, width: Math.max(0, Math.min(this.bounds.width, width - x)), height: Math.max(0, Math.min(this.bounds.height, height - y)) });
      tab.view.setVisible(id === this.activeTabId && tab.profileId === this.profiles.activeProfileId && !tab.state.error && !this.overlayOpen);
    }
  }

  focusAddress(): void {
    this.window.webContents.focus();
    this.window.webContents.send('browser:focus-address');
  }

  dispose(): void {
    this.disposed = true;
    for (const popupSet of this.popups.values()) {
      for (const popup of popupSet) {
        if (!popup.isDestroyed()) popup.close();
      }
    }
    this.popups.clear();
    for (const tab of this.tabs.values()) {
      if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    this.tabs.clear();
  }

  getActiveWebContents(): Electron.WebContents {
    const tab = this.active();
    if (!tab.view) {
      this.createView(tab);
    }
    return tab.view!.webContents;
  }
}
