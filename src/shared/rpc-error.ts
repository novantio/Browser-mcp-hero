export class RpcError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
export function publicError(error: unknown): { code: string; message: string } {
  if (error instanceof RpcError) return { code: error.code, message: error.message };
  if (error instanceof Error && 'code' in error && error.code === 'PROFILE_BUSY')
    return { code: 'PROFILE_BUSY', message: 'Sesi sedang digunakan tugas lain.' };
  // Page errors can contain URLs, selectors or credentials. Do not echo them.
  return { code: 'OPERATION_FAILED', message: 'Operasi gagal. Periksa halaman dan parameter, lalu coba kembali jika aman.' };
}
