export class RpcError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
export function publicError(error: unknown): { code: string; message: string; status?: 'not_executed' } {
  if (error instanceof RpcError) {
    const isPreExecution = Object.hasOwn(pageActionMessages, error.code) ||
      ['INVALID_INPUT', 'ELEMENT_NOT_FOUND', 'ELEMENT_AMBIGUOUS', 'ELEMENT_NOT_INTERACTABLE', 'ELEMENT_NOT_EDITABLE', 'INVALID_SELECTOR'].includes(error.code);
    return {
      code: error.code,
      message: error.message,
      ...(isPreExecution ? { status: 'not_executed' as const } : {}),
    };
  }
  if (error instanceof Error && 'code' in error && error.code === 'PROFILE_BUSY')
    return { code: 'PROFILE_BUSY', message: 'Sesi sedang digunakan tugas lain.' };
  // ProfileManager messages are fixed, user-facing strings (no URLs or secrets): pass them on
  // so an agent learns e.g. "name already used" instead of a generic failure.
  if (error instanceof Error && error.name === 'ProfileError' && 'code' in error && typeof error.code === 'string')
    return { code: error.code, message: error.message };
  // Page errors can contain URLs, selectors or credentials. Do not echo them.
  return { code: 'OPERATION_FAILED', message: 'Operasi gagal. Periksa halaman dan parameter, lalu coba kembali jika aman.' };
}

const pageActionMessages: Record<string, string> = {
  INVALID_SELECTOR: 'Selector CSS tidak valid. Perbaiki selector sebelum mencoba lagi.',
  ELEMENT_NOT_FOUND: 'Elemen target tidak ditemukan pada halaman.',
  ELEMENT_AMBIGUOUS: 'Lebih dari satu elemen cocok. Gunakan selector atau teks yang lebih spesifik.',
  ELEMENT_NOT_EDITABLE: 'Target bukan kolom teks atau textarea yang didukung.',
  ELEMENT_NOT_INTERACTABLE: 'Target tersembunyi, terhalang, nonaktif, atau hanya dapat dibaca.',
  INPUT_VALUE_REJECTED: 'Pengisian telah dilakukan, tetapi nilai akhir tidak cocok. Periksa formulir sebelum mencoba lagi.',
  SCRIPT_SYNTAX_ERROR: 'Sintaks JavaScript tidak valid. Perbaiki skrip sebelum mencoba lagi.',
  SCRIPT_EXECUTION_FAILED: 'Eksekusi skrip halaman gagal. Periksa logika skrip dan keadaan halaman.',
  SCREENSHOT_UNAVAILABLE: 'Screenshot tidak tersedia karena jendela tertutup, diminimalkan, atau disembunyikan.',
  SCREENSHOT_NOT_READY: 'Tampilan halaman belum siap untuk diambil screenshot.',
};
export function assertPageAction(code: unknown): void {
  if (code === null) return;
  if (typeof code === 'string' && Object.hasOwn(pageActionMessages, code)) throw new RpcError(code, pageActionMessages[code]!);
  throw new RpcError('ACTION_FAILED', 'Aksi halaman gagal. Periksa keadaan halaman sebelum mencoba lagi.');
}
