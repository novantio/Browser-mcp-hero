import { RpcError } from '../shared/rpc-error';

/**
 * executeJavaScript with a deadline. A page whose main thread is busy (heavy JS,
 * infinite loop) would otherwise never settle and keep the MCP bridge busy forever.
 */
export function execWithTimeout(contents: Electron.WebContents, code: string, timeoutMs = 10000): Promise<any> {
  if (contents.isDestroyed() || contents.isCrashed()) {
    return Promise.reject(new RpcError('PAGE_CRASHED', 'Halaman sudah ditutup atau crash. Gunakan browser_reload { force: true }.'));
  }
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RpcError('PAGE_UNRESPONSIVE',
      'Halaman tidak merespons (JavaScript berat atau macet). Baca konten tanpa JavaScript dengan browser_read_text, atau pulihkan tab dengan browser_reload { force: true }.')), timeoutMs);
  });
  return Promise.race([contents.executeJavaScript(code), timeout]).finally(() => clearTimeout(timer));
}
