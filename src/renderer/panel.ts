import { reportBounds } from './app-state.js';
import { element } from './dom.js';

const STORAGE_KEY = 'hero.panelVisible';

function readPreference(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== 'false'; } catch { return true; }
}

/** Shows or hides the right panel; the web page then takes the full width. Remembered across restarts. */
export function setPanelVisible(visible: boolean): void {
  element('side-panel').hidden = !visible;
  const toggle = element('toggle-panel');
  toggle.setAttribute('aria-expanded', String(visible));
  toggle.title = (visible ? 'Sembunyikan panel samping supaya halaman penuh' : 'Tampilkan panel samping') + ' (Ctrl+Shift+B)';
  element('toggle-panel-label').textContent = visible ? 'Sembunyikan panel' : 'Tampilkan panel';
  try { localStorage.setItem(STORAGE_KEY, String(visible)); } catch { /* Preference is optional. */ }
  // Measure after the layout change so the web view gets the new width.
  requestAnimationFrame(reportBounds);
}

export function togglePanel(): void { setPanelVisible(element('side-panel').hidden !== false); }

export function setupPanel(): void {
  setPanelVisible(readPreference());
  element('toggle-panel').addEventListener('click', togglePanel);
  element('collapse-panel').addEventListener('click', () => setPanelVisible(false));
}
