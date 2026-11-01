import type { Session } from 'electron';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { writeAtomic } from './engine-selection';

/** 'lite' keeps pages and their JavaScript working but skips images, video, audio and web fonts. */
export type MediaMode = 'full' | 'lite';

const BLOCKED_TYPES = new Set(['image', 'media', 'font', 'object']);
// Video/audio streamed through fetch/XHR (TikTok, YouTube, Instagram, X players) is not
// typed as "media", so recognise it by URL as well.
const MEDIA_URL = /\.(mp4|m4s|m4a|webm|m3u8|mpd|mov|mkv|flv|mp3|aac|ogg|opus)(\?|$)|[?&]mime_type=(video|audio)_|\/video\/tos\/|\/videoplayback\b/i;
const IMAGE_URL = /\.(jpe?g|png|gif|webp|avif|heic|bmp|ico)(\?|$)/i;

// Verification challenges (slider/rotate puzzles, image grids) must stay solvable by the
// human, so their images and audio are never blocked.
const CHALLENGE_URL = /captcha|recaptcha|hcaptcha|turnstile|challenges\.cloudflare\.com|arkoselabs|funcaptcha|geetest|datadome|perimeterx|px-cdn|\/verify\b|verification/i;

export function shouldBlockMedia(details: { resourceType: string; url: string }): boolean {
  if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') return false;
  if (CHALLENGE_URL.test(details.url)) return false;
  if (BLOCKED_TYPES.has(details.resourceType)) return true;
  if (details.resourceType === 'xhr' || details.resourceType === 'other') return MEDIA_URL.test(details.url) || IMAGE_URL.test(details.url);
  return false;
}

/** Browser-wide media mode, applied to every profile session and remembered across restarts. */
export class MediaFilter {
  private mode: MediaMode = 'full';
  private blocked = 0;
  private readonly file: string;
  private readonly attached = new WeakSet<Session>();

  constructor(directory: string) {
    this.file = path.join(directory, 'media-mode.json');
    try {
      const saved: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      if (saved && typeof saved === 'object' && 'mode' in saved && (saved.mode === 'lite' || saved.mode === 'full')) this.mode = saved.mode;
    } catch { /* First run: full media. */ }
  }

  getMode(): MediaMode { return this.mode; }
  blockedCount(): number { return this.blocked; }

  setMode(mode: MediaMode): void {
    this.mode = mode;
    try { writeAtomic(this.file, { mode }); } catch { /* Still applies for this run. */ }
  }

  attach(session: Session): void {
    if (this.attached.has(session)) return;
    this.attached.add(session);
    session.webRequest.onBeforeRequest((details, callback) => {
      const cancel = this.mode === 'lite' && shouldBlockMedia(details);
      if (cancel) this.blocked++;
      callback({ cancel });
    });
  }
}
