import type { BrowserState } from '../shared/types.js';
import { app, command } from './app-state.js';
import { element, showToast } from './dom.js';

type Mode = 'full' | 'no-video' | 'lite';
const ORDER: Mode[] = ['full', 'no-video', 'lite'];
const LABEL: Record<Mode, string> = {
  full: 'Gambar & video: aktif',
  'no-video': 'Tanpa video (gambar tetap)',
  lite: 'Mode hemat: tanpa gambar & video',
};
const TOAST: Record<Mode, string> = {
  full: 'Gambar dan video kembali dimuat.',
  'no-video': 'Video dan audio tidak dimuat; gambar dan teks tetap tampil. Halaman dimuat ulang.',
  lite: 'Mode hemat aktif: gambar dan video tidak dimuat (teks tetap tampil). Halaman dimuat ulang.',
};

/** Toolbar switch cycling full -> no video -> no images & video. */
export function renderMediaMode(state: BrowserState): void {
  const mode: Mode = state.mediaMode ?? 'full';
  const button = element('toggle-media');
  button.classList.toggle('active', mode !== 'full');
  button.setAttribute('aria-pressed', String(mode !== 'full'));
  element('toggle-media-label').textContent = LABEL[mode];
}

export function toggleMediaMode(): void {
  const current: Mode = app.current?.mediaMode ?? 'full';
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!;
  void command({ action: 'set-media-mode', mode: next }).then(ok => { if (ok) showToast(TOAST[next]); });
}

export function setupMediaToggle(): void {
  element('toggle-media').addEventListener('click', toggleMediaMode);
}
