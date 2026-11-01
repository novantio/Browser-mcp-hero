import type { BrowserState } from '../shared/types.js';
import type { ProfileSummary } from '../shared/profiles.js';
import { app, command, onProfileControlsChange } from './app-state.js';
import { element, showToast } from './dom.js';
import { deleteBlocker } from './profiles-ui.js';
import { siteDataPicker } from './site-data-picker.js';

type OpenForm = { profileId: string; kind: 'duplicate' | 'rename' | 'clear' } | null;
let openForm: OpenForm = null;
let renderedKey = '';

const FEEDBACK = 'profiles-feedback';

function suggestCopyName(state: BrowserState, profile: ProfileSummary): string {
  const taken = new Set(state.profiles.map(p => p.name.toLocaleLowerCase()));
  const base = profile.name.slice(0, 28);
  for (let n = 1; n < 50; n++) {
    const name = n === 1 ? `${base} (salinan)` : `${base} (salinan ${n})`;
    if (!taken.has(name.toLocaleLowerCase())) return name;
  }
  return base + ' 2';
}

function button(label: string, title: string, onClick: () => void, disabledReason: string | null = null): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.title = disabledReason ?? title;
  b.disabled = Boolean(disabledReason) || app.profilePending;
  b.addEventListener('click', onClick);
  return b;
}

function inlineForm(profile: ProfileSummary, state: BrowserState): HTMLFormElement {
  const form = document.createElement('form');
  form.className = 'profile-inline-form';
  const input = document.createElement('input');
  input.maxLength = 40;
  input.required = true;
  input.setAttribute('aria-label', openForm?.kind === 'rename' ? 'Nama baru' : 'Nama profil salinan');
  input.value = openForm?.kind === 'rename' ? profile.name : suggestCopyName(state, profile);
  form.append(input);
  let copyLogin: HTMLInputElement | null = null;
  if (openForm?.kind === 'duplicate') {
    const label = document.createElement('label');
    copyLogin = document.createElement('input');
    copyLogin.type = 'checkbox';
    copyLogin.checked = true;
    const services = profile.loggedInServices?.length ? ` (${profile.loggedInServices.join(', ')})` : '';
    label.append(copyLogin, document.createTextNode(` Salin login${services}`));
    form.append(label);
  }
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'primary-button';
  submit.textContent = openForm?.kind === 'rename' ? 'Simpan nama' : 'Buat salinan';
  form.append(submit, button('Batal', 'Batal', () => { openForm = null; render(state, true); }));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const name = input.value.trim();
    const action = openForm?.kind === 'rename'
      ? command({ action: 'rename-profile', profileId: profile.id, name }, FEEDBACK)
      : command({ action: 'duplicate-profile', profileId: profile.id, name, copyLogin: copyLogin?.checked ?? true }, FEEDBACK);
    void action.then(ok => {
      if (!ok) return;
      showToast(openForm?.kind === 'rename' ? 'Nama profil diperbarui.' : `Profil “${name}” dibuat${copyLogin?.checked ? ' (cookie login ikut disalin)' : ''} dan langsung dibuka.`);
      openForm = null;
      if (app.current) render(app.current, true);
    });
  });
  requestAnimationFrame(() => { input.focus(); input.select(); });
  return form;
}

function row(profile: ProfileSummary, state: BrowserState): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'profile-row' + (profile.id === state.activeProfileId ? ' active' : '');
  const info = document.createElement('div');
  info.className = 'profile-row-info';
  const name = document.createElement('strong');
  name.textContent = profile.name;
  const badges = document.createElement('span');
  badges.className = 'profile-row-badges';
  const tags: string[] = [];
  if (profile.id === state.activeProfileId) tags.push('Sedang dipakai');
  if (profile.lockOwner) tags.push('Dikunci tugas AI');
  if (profile.sharedProfiles.length > 1) tags.push('Login bersama');
  if (profile.stealth === false) tags.push('Stealth mati');
  if (profile.persistSessionCookies === false) tags.push('Cookie sesi tidak diingat');
  tags.push(profile.loggedInServices?.length ? 'Login: ' + profile.loggedInServices.join(', ') : 'Belum ada login terdeteksi');
  badges.textContent = tags.join(' · ');
  info.append(name, badges);

  const actions = document.createElement('div');
  actions.className = 'profile-row-actions';
  const isActive = profile.id === state.activeProfileId;
  actions.append(
    button(isActive ? 'Aktif' : 'Pakai', 'Buka profil ini', () => { void command({ action: 'switch-profile', profileId: profile.id }, FEEDBACK); }, isActive ? 'Profil ini sedang dipakai.' : null),
    button('Duplikat…', 'Buat profil baru yang membawa login profil ini', () => { openForm = { profileId: profile.id, kind: 'duplicate' }; render(state, true); }),
    button('Ganti nama', 'Ganti nama profil', () => { openForm = { profileId: profile.id, kind: 'rename' }; render(state, true); }),
    button('Hapus data situs…', 'Pilih dari daftar situs yang menyimpan data di profil ini, lalu hapus cookie dan penyimpanannya (seperti "Clear site data" di Chrome). Berguna bila situs terus gagal karena sesi atau penanda lama.', () => { openForm = { profileId: profile.id, kind: 'clear' }; render(state, true); }),
    button(profile.stealth === false ? 'Stealth: mati' : 'Stealth: aktif',
      profile.stealth === false
        ? 'Halaman tampil apa adanya (Chromium/Electron) tanpa pemalsuan identitas browser. Klik untuk menyalakan stealth.'
        : 'Skrip stealth memalsukan beberapa identitas browser (webdriver, plugin, window.chrome). Situs ketat seperti Shopee justru bisa mencurigai pemalsuan ini. Klik untuk mematikan; tab profil ini dimuat ulang.',
      () => { void command({ action: 'set-stealth', profileId: profile.id, enabled: profile.stealth === false }, FEEDBACK); }),
    button(profile.persistSessionCookies === false ? 'Sesi: tidak diingat' : 'Sesi: diingat',
      profile.persistSessionCookies === false
        ? 'Cookie sesi hilang saat Hero ditutup (perilaku browser biasa). Klik agar cookie sesi diingat 30 hari supaya login tidak hilang setelah restart.'
        : 'Cookie sesi diperpanjang 30 hari supaya login bertahan setelah restart. Kekurangannya, status sesi yang buruk (mis. verifikasi gagal) juga ikut tersimpan. Shopee selalu dikecualikan. Klik untuk mematikan.',
      () => { void command({ action: 'set-session-cookies', profileId: profile.id, enabled: profile.persistSessionCookies === false }, FEEDBACK); }),
    button('Hapus', 'Hapus profil beserta login dan data situsnya', () => { void command({ action: 'delete-profile', profileId: profile.id }, FEEDBACK); }, deleteBlocker(state, profile.id)),
  );
  item.append(info, actions);
  if (openForm?.profileId === profile.id) item.append(openForm.kind === 'clear'
    ? siteDataPicker(profile, state, FEEDBACK, () => { openForm = null; if (app.current) render(app.current, true); })
    : inlineForm(profile, state));
  return item;
}

function render(state: BrowserState, force = false): void {
  const key = JSON.stringify([state.activeProfileId, app.profilePending, openForm, state.profiles.map(p => [p.id, p.name, p.lockOwner, p.sharedProfiles, p.loggedInServices, p.stealth, p.persistSessionCookies])]);
  // Keep an open form (and what the user typed) unless something relevant changed.
  if (!force && key === renderedKey) return;
  if (!force && openForm && renderedKey) return;
  renderedKey = key;
  element('profiles-list').replaceChildren(...state.profiles.map(profile => row(profile, state)));
}

export function renderProfilesModal(state: BrowserState): void {
  if (!element('profiles-modal').hidden) render(state);
}

export function openProfilesModal(): void {
  openForm = null;
  element(FEEDBACK).hidden = true;
  element('profiles-modal').hidden = false;
  if (app.current) render(app.current, true);
}

function closeProfilesModal(): void { element('profiles-modal').hidden = true; openForm = null; }

export function setupProfilesModal(): void {
  // A command can finish without a new state push (e.g. a setting on another profile);
  // re-render so buttons disabled while it ran become usable again.
  onProfileControlsChange(() => { if (!element('profiles-modal').hidden && app.current) render(app.current, true); });
  for (const id of ['manage-profiles', 'open-manage-profiles']) element(id).addEventListener('click', openProfilesModal);
  for (const id of ['close-profiles-modal', 'done-profiles-modal']) element(id).addEventListener('click', closeProfilesModal);
  const modal = element('profiles-modal');
  modal.addEventListener('click', event => { if (event.target === modal) closeProfilesModal(); });
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal.hidden) closeProfilesModal(); });
  element('profiles-create').addEventListener('submit', event => {
    event.preventDefault();
    const input = element<HTMLInputElement>('profiles-create-name');
    void command({ action: 'create-profile', name: input.value }, FEEDBACK).then(ok => { if (ok) { input.value = ''; showToast('Profil baru dibuat dan dibuka.'); } });
  });
}
