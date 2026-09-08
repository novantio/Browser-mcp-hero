# Penyelesaian audit TODO — 8 September 2026

Lingkup: enam temuan audit terakhir, dengan mempertahankan profil dan login yang sudah ada.

- [x] P1: HTML, outline dan ekstraksi menyaring password/token tersembunyi; DOM asli tidak diubah.
- [x] P1: Audit menyamarkan seluruh isi ketikan, selector kompleks, query token dan raw error.
- [x] P1: Aksi membutuhkan task RUNNING, pemilik sesi yang cocok dan profil/tab yang benar; task dijeda menolak aksi.
- [x] P1: MCP menyediakan start/list/status/pause/resume/complete/cancel task. Intervensi mengembalikan human_required dan resumeToken.
- [x] P2: Kontrak input/output ketat, structuredContent, deadline nyata, dan pembatalan diteruskan ke browser.
- [x] P2: Tidak ada retry otomatis untuk tindakan yang telah dikirim.
- [x] UI: status bridge, kunci profil dan daftar task mengikuti keadaan aktual.
- [x] Dokumentasi: alur MCP, batas jaminan login dan status milestone diselaraskan.

## Bukti

30 unit test dan 31 kelompok E2E lulus. Typecheck lulus. Audit dependensi runtime: 0 kerentanan yang dilaporkan saat pemeriksaan.

tests/security.test.cjs menguji kegagalan dan batas API, termasuk klien MCP nyata dan simulasi aksi yang sudah terjadi sebelum respons gagal.
tests/automation.cjs menjalankan stdio MCP sampai Electron, memverifikasi bahwa ketikan ditolak selama WAITING_FOR_HUMAN serta cancellation melepaskan lock.
tests/persistence.cjs dan tests/sharing.cjs memverifikasi sesi sintetis melalui restart dan pemulihan sesi pribadi.

## Data akun

Tidak ada penghapusan, reset, ekspor atau migrasi data profil pengguna. Jendela akun pengguna tidak ditutup oleh proses perbaikan. Perubahan aplikasi dipakai setelah aplikasi dibuka ulang secara normal; sesi dan identitas partisi tetap sama.

## Batas yang tetap berlaku

Pembatalan tidak mengurungkan klik yang sudah terjadi. Screenshot memuat konten terlihat. Filter DOM menyaring kategori rahasia yang dikenal, bukan semua kemungkinan data sensitif dalam teks bebas. Login nyata tunduk pada kedaluwarsa dan kebijakan situs.

Tidak ada jaminan bahwa semua fitur lanjutan di luar enam temuan audit sudah menjadi fitur produksi; detail batas MVP ada di architecture.md.
