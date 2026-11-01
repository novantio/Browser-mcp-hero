import type { BrowserState } from '../shared/types.js';
import { app, command, onProfileControlsChange } from './app-state.js';
import { element } from './dom.js';

/** Why a profile cannot be deleted right now, or null when it can. */
export function deleteBlocker(state: BrowserState, profileId: string): string | null {
  const profile = state.profiles.find(p => p.id === profileId);
  if (!profile) return 'Profil tidak ditemukan.';
  if (profileId === 'default') return 'Profil Default selalu ada dan tidak bisa dihapus.';
  if (profile.lockOwner) return 'Sedang dipakai tugas AI. Tunggu sampai tugas selesai.';
  if (!profile.sharedWith && profile.sharedProfiles.length > 1) return 'Profil lain memakai login profil ini. Hentikan login bersama dulu.';
  return null;
}

function updateProfileControls(): void {
  const { current, profilePending } = app;
  element<HTMLSelectElement>('profile-select').disabled = profilePending;
  element<HTMLInputElement>('profile-name').disabled = profilePending;
  element<HTMLButtonElement>('create-profile').disabled = profilePending;
  element<HTMLButtonElement>('save-session').disabled = profilePending;
  const selected = current?.profiles.find(profile => profile.id === current?.activeProfileId);
  const blocker = current ? deleteBlocker(current, current.activeProfileId) : 'Memuat…';
  const deleteButton = element<HTMLButtonElement>('delete-profile');
  deleteButton.disabled = profilePending || Boolean(blocker);
  deleteButton.title = blocker ?? 'Hapus profil beserta data situs';

  element<HTMLButtonElement>('open-google').disabled = profilePending;
  element<HTMLButtonElement>('toggle-share').disabled = profilePending;
  element<HTMLButtonElement>('share-all').disabled = profilePending;
  const candidates = [...document.querySelectorAll<HTMLInputElement>('#share-targets input')];
  for (const checkbox of candidates) checkbox.disabled = profilePending || checkbox.dataset.shared === 'true';
  element<HTMLButtonElement>('apply-share').disabled = profilePending || !candidates.some(input => input.checked && input.dataset.shared !== 'true');
  element<HTMLButtonElement>('stop-sharing').disabled = profilePending || Boolean(selected?.lockOwner);
  element('stop-sharing').hidden = !selected || selected.sharedProfiles.length <= 1;
}

export function renderProfiles(state: BrowserState, previousProfileId: string | undefined): void {
  const profileSelect = element<HTMLSelectElement>('profile-select');
  const optionKey = state.profiles.map(profile => profile.id + ':' + profile.name + ':' + (profile.loggedInServices || []).join(',')).join('|');
  if (profileSelect.dataset.options !== optionKey) {
    profileSelect.replaceChildren(...state.profiles.map(profile => {
      const option = document.createElement('option');
      option.value = profile.id;
      const services = profile.loggedInServices && profile.loggedInServices.length
        ? ` [${profile.loggedInServices.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(', ')}]`
        : '';
      option.textContent = profile.name + services;
      return option;
    }));
    profileSelect.dataset.options = optionKey;
  }

  profileSelect.value = state.activeProfileId;
  const profile = state.profiles.find(profile => profile.id === state.activeProfileId);
  element('active-profile-name').textContent = profile?.name ?? 'Profil';
  element('profile-control').textContent = profile?.lockOwner ? 'Dikunci tugas AI' : 'Manual';

  const sessionOwner = state.profiles.find(item => item.id === profile?.sessionProfileId);
  element('sharing-status').textContent = profile && profile.sharedProfiles.length > 1
    ? 'Login bersama dengan ' + (sessionOwner?.name ?? '') + ' · ' + profile.sharedProfiles.length + ' profil'
    : 'Login milik profil ini sendiri';
  element('session-description').textContent = profile && profile.sharedProfiles.length > 1 ? 'Login dipakai bersama' : 'Login dan data terpisah';
  const targets = element('share-targets');
  const targetKey = JSON.stringify([state.activeProfileId, state.profiles.map(p => [p.id, p.name, p.sessionProfileId])]);
  if (targets.dataset.key !== targetKey) {
    targets.replaceChildren(...state.profiles.filter(p => p.id !== state.activeProfileId).map(p => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = p.id;
      checkbox.checked = p.sessionProfileId === profile?.sessionProfileId;
      checkbox.dataset.shared = String(checkbox.checked);
      checkbox.disabled = checkbox.checked;
      checkbox.addEventListener('change', updateProfileControls);
      const text = document.createElement('span');
      text.textContent = p.name;
      label.append(checkbox, text);
      return label;
    }));
    targets.dataset.key = targetKey;
  }
  if (previousProfileId && previousProfileId !== state.activeProfileId) {
    element('share-options').hidden = true;
    element('toggle-share').setAttribute('aria-expanded', 'false');
  }
  updateProfileControls();
}

export function setupProfileControls(): void {
  onProfileControlsChange(updateProfileControls);
  element('profile-select').addEventListener('change', () => {
    element('storage-feedback').textContent = 'Data situs disimpan di perangkat.';
    void command({ action: 'switch-profile', profileId: element<HTMLSelectElement>('profile-select').value });
  });
  element('profile-form').addEventListener('submit', event => {
    event.preventDefault();
    void command({ action: 'create-profile', name: element<HTMLInputElement>('profile-name').value }).then(ok => {
      if (ok) element<HTMLInputElement>('profile-name').value = '';
    });
  });
  element('delete-profile').addEventListener('click', () => {
    if (app.current) void command({ action: 'delete-profile', profileId: app.current.activeProfileId });
  });
  element('save-session').addEventListener('click', () => { void command({ action: 'save-session' }); });
  element('open-google').addEventListener('click', () => { void command({ action: 'open-google' }); });
  element('toggle-share').addEventListener('click', () => {
    const options = element('share-options');
    options.hidden = !options.hidden;
    element('toggle-share').setAttribute('aria-expanded', String(!options.hidden));
  });
  element('share-all').addEventListener('click', () => {
    document.querySelectorAll<HTMLInputElement>('#share-targets input').forEach(input => { if (!input.disabled) input.checked = true; });
    updateProfileControls();
  });
  element('apply-share').addEventListener('click', () => {
    const targetIds = [...document.querySelectorAll<HTMLInputElement>('#share-targets input')].filter(input => input.checked && !input.disabled).map(input => input.value);
    void command({ action: 'share-session', targetIds });
  });
  element('stop-sharing').addEventListener('click', () => { void command({ action: 'stop-sharing' }); });
}
