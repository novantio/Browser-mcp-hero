import type { Session } from 'electron';
import { RpcError } from '../shared/rpc-error';
import { htmlToMarkdown } from './html-to-markdown';

export interface ReadTextResult {
  url: string; title: string; status?: number; source: 'fetch' | 'live';
  markdown: string; links: number; truncated: boolean; hint?: string; challenge?: string;
}

/**
 * Downloads a page with the profile's cookies and converts the raw HTML to markdown
 * without running any page JavaScript (works on heavy or hung pages).
 */
export async function fetchAsMarkdown(session: Session, target: string,
  convertOptions: { maxLength?: number; mainOnly?: boolean; includeLinks?: boolean }, signal?: AbortSignal): Promise<ReadTextResult> {
  const response = await session.fetch(target, {
    redirect: 'follow',
    headers: { Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
    signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]),
  }).catch(() => { throw new RpcError('FETCH_FAILED', 'Halaman tidak dapat diunduh. Periksa alamat dan koneksi.'); });
  const contentType = response.headers.get('content-type') || '';
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > 8_000_000) throw new RpcError('OUTPUT_LIMIT', 'Halaman terlalu besar untuk dibaca sebagai teks.');
  const charset = /charset=([^;\s]+)/i.exec(contentType)?.[1]
    || /<meta[^>]+charset=["']?([a-z0-9_-]+)/i.exec(buffer.subarray(0, 4096).toString('latin1'))?.[1] || 'utf-8';
  let body: string;
  try { body = new TextDecoder(charset.toLowerCase()).decode(buffer); } catch { body = buffer.toString('utf8'); }
  const finalUrl = response.url || target;
  if (!/html|xml/i.test(contentType) && !/^\s*</.test(body)) {
    const maxLength = Math.min(Math.max(convertOptions.maxLength ?? 20000, 200), 200000);
    return { url: finalUrl, title: '', status: response.status, source: 'fetch', markdown: body.slice(0, maxLength), links: 0, truncated: body.length > maxLength };
  }
  const page = htmlToMarkdown(body, { ...convertOptions, baseUrl: finalUrl });
  // Single-page apps (TikTok, Threads, X, Instagram) ship an empty shell without JavaScript.
  const hint = page.markdown.replace(/\n---\nTautan:[\s\S]*$/, '').trim().length < 300
    ? 'Isi halaman ini dibuat oleh JavaScript. Pakai browser_set_media_mode { mode: "lite" }, browser_navigate ke URL ini, lalu browser_read_text { source: "live" }.'
    : undefined;
  return { url: finalUrl, status: response.status, source: 'fetch', ...page, ...(hint ? { hint } : {}) };
}
