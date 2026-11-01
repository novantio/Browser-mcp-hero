import type { BrowserState } from '../shared/types.js';
import type { ProfileSummary } from '../shared/profiles.js';
import { siteOf } from '../shared/site-domain.js';
import { command } from './app-state.js';
import { showToast } from './dom.js';

/**
 * "Hapus data situs" picker: lists the sites that really have data in the profile,
 * with a filter and checkboxes, so nothing is typed by hand (a typo would clear the
 * wrong site or nothing at all).
 */
export function siteDataPicker(profile: ProfileSummary, state: BrowserState, feedbackId: string, done: () => void): HTMLFormElement {
  const form = document.createElement('form');
  form.className = 'profile-inline-form site-picker';
  const filter = document.createElement('input');
  filter.type = 'search';
  filter.placeholder = 'Filter situs, mis. shopee';
  filter.setAttribute('aria-label', 'Filter daftar situs');
  const list = document.createElement('div');
  list.className = 'site-picker-list';
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'Situs yang menyimpan data di profil ini');
  list.textContent = 'Memuat daftar situs…';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'primary-button';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Batal';
  cancel.addEventListener('click', done);
  const actions = document.createElement('div');
  actions.className = 'site-picker-actions';
  actions.append(submit, cancel);
  form.append(filter, list, actions);

  const chosen = new Set<string>();
  // Pre-select the site of the tab the user is looking at in this profile.
  const tab = profile.id === state.activeProfileId ? state.tabs.find(t => t.id === state.activeTabId) : undefined;
  let activeSite = '';
  try { if (tab?.url) activeSite = siteOf(new URL(tab.url).hostname); } catch { /* blank tab */ }
  let sites: Array<{ site: string; cookies: number; hosts: string[] }> = [];

  const updateSubmit = () => {
    submit.disabled = chosen.size === 0;
    submit.textContent = chosen.size ? `Hapus data ${chosen.size} situs` : 'Pilih situs dulu';
  };
  const renderList = () => {
    const needle = filter.value.trim().toLowerCase();
    const shown = sites.filter(entry => !needle || entry.site.includes(needle) || entry.hosts.some(h => h.includes(needle)));
    if (!sites.length) { list.textContent = 'Profil ini belum menyimpan data situs apa pun.'; return; }
    if (!shown.length) { list.textContent = `Tidak ada situs yang cocok dengan "${filter.value.trim()}".`; return; }
    list.replaceChildren(...shown.map(entry => {
      const label = document.createElement('label');
      label.className = 'site-picker-row';
      label.title = 'Termasuk: ' + entry.hosts.join(', ');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = chosen.has(entry.site);
      box.addEventListener('change', () => { if (box.checked) chosen.add(entry.site); else chosen.delete(entry.site); updateSubmit(); });
      const name = document.createElement('span');
      name.textContent = entry.site;
      const count = document.createElement('small');
      count.textContent = entry.cookies + ' cookie' + (entry.hosts.length > 1 ? ` · ${entry.hosts.length} subdomain` : '');
      label.append(box, name, count);
      return label;
    }));
  };

  filter.addEventListener('input', renderList);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const domains = [...chosen];
    if (!domains.length) return;
    void command({ action: 'clear-site-data', profileId: profile.id, domains }, feedbackId).then(ok => {
      if (!ok) return;
      showToast('Selesai. Data situs yang dikonfirmasi sudah dihapus; login ulang ke situs itu bila perlu.');
      done();
    });
  });

  updateSubmit();
  void window.browser.listSiteData(profile.id).then(result => {
    sites = result;
    if (activeSite && sites.some(entry => entry.site === activeSite)) { chosen.add(activeSite); filter.value = activeSite; }
    renderList();
    updateSubmit();
    requestAnimationFrame(() => filter.focus());
  }).catch(() => { list.textContent = 'Daftar situs tidak dapat dibaca.'; });
  return form;
}
