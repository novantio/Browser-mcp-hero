import type { BrowserState } from '../shared/types.js';
import { app, command } from './app-state.js';
import { element, showToast } from './dom.js';

/** Toolbar switch for lite mode: pages load without images, video and web fonts. */
export function renderMediaMode(state: BrowserState): void {
  const lite = state.mediaMode === 'lite';
  const button = element('toggle-media');
  button.classList.toggle('active', lite);
  button.setAttribute('aria-pressed', String(lite));
  element('toggle-media-label').textContent = lite ? 'Mode hemat: tanpa gambar & video' : 'Gambar & video: aktif';
}

export function toggleMediaMode(): void {
  const next = app.current?.mediaMode === 'lite' ? 'full' : 'lite';
  void command({ action: 'set-media-mode', mode: next }).then(ok => {
    if (ok) showToast(next === 'lite'
      ? 'Mode hemat aktif: gambar, video, dan font tidak dimuat. Halaman dimuat ulang.'
      : 'Gambar dan video kembali dimuat.');
  });
}

export function setupMediaToggle(): void {
  element('toggle-media').addEventListener('click', toggleMediaMode);
}
