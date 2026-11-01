import type { BrowserAPI, BrowserCommand, BrowserState } from '../shared/types.js';
import { element, showError } from './dom.js';

declare global { interface Window { browser: BrowserAPI } }

/** Latest state pushed by the main process, plus UI-only flags. */
export const app = {
  current: null as BrowserState | null,
  profilePending: false,
};

const PROFILE_ACTIONS = ['create-profile', 'switch-profile', 'delete-profile', 'rename-profile', 'duplicate-profile', 'set-stealth',
  'save-session', 'share-session', 'stop-sharing', 'open-google'];

const profileControlListeners: Array<() => void> = [];
const refreshProfileControls = () => { for (const listener of profileControlListeners) listener(); };
/** Panel and profile dialog re-enable their buttons once a profile command settles. */
export function onProfileControlsChange(listener: () => void): void { profileControlListeners.push(listener); }

/** Sends a command to the main process. Profile commands are serialized and report into the panel. */
export async function command(value: BrowserCommand, feedbackId = 'profile-feedback'): Promise<boolean> {
  const changesProfile = PROFILE_ACTIONS.includes(value.action);
  if (changesProfile && app.profilePending) return false;
  if (changesProfile) {
    app.profilePending = true;
    refreshProfileControls();
    element(feedbackId).hidden = true;
  }
  if (value.action === 'save-session') element('storage-feedback').textContent = 'Menyimpan…';
  try {
    const result = await window.browser.command(value);
    if (!result.ok) {
      if (changesProfile) {
        element(feedbackId).textContent = result.error;
        element(feedbackId).hidden = false;
      } else showError(result.error);
    }
    if (value.action === 'save-session') element('storage-feedback').textContent = result.ok ? 'Tersimpan di perangkat' : 'Penyimpanan belum selesai.';
    return result.ok;
  } catch {
    showError('Koneksi ke browser terputus. Buka ulang Hero.');
    return false;
  } finally {
    if (changesProfile) {
      app.profilePending = false;
      refreshProfileControls();
      // Restore the actual selection if a switch or deletion was rejected.
      if (app.current) element<HTMLSelectElement>('profile-select').value = app.current.activeProfileId;
    }
  }
}

/** Tells the main process where the web page view goes; the page fills whatever the panel leaves. */
export function reportBounds(): void {
  const rect = element('browser-surface').getBoundingClientRect();
  void window.browser.setBounds({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) })
    .catch(() => showError('Area browser tidak dapat diperbarui.'));
}
