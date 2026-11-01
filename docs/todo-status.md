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

## Catatan tindak lanjut (belum dikerjakan)

### Halaman detik.com kadang tidak tergambar (layar putih) — dicatat 1 November 2026

**Gejala:** artikel `news.detik.com` dibuka di tab, tetapi seluruh area halaman tetap kosong. Yang terlihat hanya latar UI Hero (`#f7f8fa`). Status bar terus menampilkan "Memuat halaman…", dan tombol reload berubah menjadi ×. Kondisi ini bisa bertahan lama, bahkan setelah Hero di-restart.

**Yang sudah dipastikan bukan penyebab:**
- View halaman terlihat (`visible: true`) dengan ukuran yang pas. Tidak ada dialog, error, atau peringatan sertifikat.
- `browser_reload { force: true }` dengan renderer baru tidak menolong.
- Membawa jendela ke depan (occlusion) tidak menolong.
- Stealth aktif maupun mati, dan engine Electron 45.2.1: di instance uji yang bersih, detik selalu tampil.
- Isi halaman sebenarnya ada. `browser_screenshot` (capture tab) menampilkan detik lengkap, `evaluate` merespons, dan `readyState` sudah `complete`.

**Pola yang teramati:**
- Hanya terjadi di detik (sekitar 100 skrip, 33 iframe iklan, dan kurang lebih 100 request yang tidak selesai), saat detik dibuka langsung di tab itu.
- Setelah tab membuka halaman lain (example.com, Wikipedia) lalu kembali ke detik, halaman tampil normal.
- `browser_read_text { source: "live" }` sempat gagal dengan `PAGE_UNRESPONSIVE` di halaman ini.
- Dugaan (belum terbukti): skrip atau iklan render-blocking menahan *first paint*.

**Langkah penyelidikan berikutnya:**
1. Rekam timeline pemuatan (CDP `Performance`, event `Page.lifecycleEvent` / `firstContentfulPaint`) saat putih, lalu bandingkan dengan saat tampil normal.
2. Catat request yang masih tertunda saat putih (`browser_get_network_activity`) untuk mencari skrip penahan.
3. Uji dengan Mode tanpa video atau Mode hemat, dan dengan profil baru, untuk melihat pengaruh cache atau cookie profil.

**Pemulihan sementara:** buka halaman lain lalu kembali, atau tekan Ctrl+R. Untuk mengambil data, pakai `browser_read_text { source: "fetch" }`: teks bersih dalam sekitar 0,6 detik dan tidak terpengaruh iklan.

Detail investigasi: komentar koreksi di PR #1 (novantio/Browser-mcp-hero).
