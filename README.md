# Hero Browser

Browser desktop Electron + TypeScript untuk fondasi runtime browser bersama manusia dan AI.

**Versi 0.2:** tab browser, profil persisten, pemilihan/pembuatan/penghapusan profil, dan fondasi profile lock. MCP, task engine, serta human intervention belum tersedia.

## Menjalankan

Prasyarat: Node.js 22 atau lebih baru.

```sh
npm ci
npm start
```

Pada Windows, setelah dependensi terpasang, klik dua kali **start.cmd** atau jalankan:

```sh
node scripts/start.cjs
```

Launcher membangun TypeScript lalu membuka Electron. Aplikasi tidak memerlukan API key atau server pengembangan. Jika versi persisten sudah terbuka, peluncuran kedua akan memfokuskan jendela tersebut.

Wrapper npm global pada mesin pengembangan awal bermasalah. Launcher langsung di atas tetap dapat dipakai setelah dependensi terpasang.

## Mulai memakai profil

1. Pilih **Instagram** melalui menu **Profil** di kanan atas.
2. Klik pintasan Instagram, lalu login secara manual.
3. Pilih profil **YouTube**, buka pintasan YouTube, lalu login.
4. Klik **Simpan sekarang** untuk segera menyimpan perubahan yang masih menunggu penulisan ke disk. Penyimpanan Chromium juga berjalan otomatis, dan aplikasi menunggu proses simpan ketika ditutup normal.
5. Buka ulang aplikasi dan pilih profil yang sama untuk memakai data situs tersebut kembali.

Profil bawaan: Default, Instagram, YouTube, Riset. Nama profil adalah label, bukan pembatas situs: setiap profil bisa membuka situs apa pun. Cookie, localStorage, IndexedDB dan cache dipisahkan per profil. Tab tetap hidup saat berpindah profil selama aplikasi terbuka.

Form **Profil baru** membuat profil tambahan, maksimal 20. **Hapus profil** menampilkan konfirmasi lalu menutup tab dan membersihkan data situs milik profil itu saja. Default tidak dapat dihapus. Penghapusan menggunakan API Chromium; direktori kontainer yang kosong mungkin tetap ada di disk.

## Login dari versi 0.1

Versi pertama memakai partisi memori sementara. Login pada jendela versi 0.1 yang masih terbuka **tidak otomatis berpindah** ke versi 0.2. Tidak tersedia jalur migrasi live pada versi lama.

Versi persisten menggunakan direktori data berbeda agar dapat dibuka bersamaan dengan jendela lama. Login sekali lagi pada profil versi baru. Jangan mengandalkan jendela versi 0.1 untuk menyimpan login setelah ditutup.

## Penyimpanan dan batas sesi

Di Windows, data versi persisten berada di:

```text
%APPDATA%/Hero Browser Profiles/
  profiles.json                Nama, ID, waktu dibuat, dan pilihan profil
  Partitions/hero-<profileId>/  Data situs yang dikelola Chromium
```

Direktori aktual partisi mengikuti Electron. Nama pengguna untuk profil tidak dipakai sebagai path; profil tambahan menggunakan UUID. File metadata ditulis atomik. Metadata rusak dilaporkan dan tidak diganti diam-diam.

**Penyimpanan persisten tidak menjamin login selamanya.** Cookie dengan masa berlaku disimpan oleh Chromium. Cookie sesi tanpa tanggal kedaluwarsa dan sessionStorage tidak dijamin bertahan setelah restart; situs juga dapat mengakhiri login atau meminta verifikasi ulang. Aplikasi tidak memperpanjang masa berlaku cookie, tidak mengekspor token, dan tidak menebak status autentikasi.

Pilihan profil terakhir dipulihkan saat membuka aplikasi. Daftar URL/tab belum dipulihkan setelah restart. Tidak ada penyimpanan password buatan aplikasi atau impor cookie akun lain.

## Browser

- Tab, address bar, pencarian Google, back/forward, reload dan stop.
- Popup HTTP/HTTPS menjadi tab yang dikelola.
- Halaman gagal memuat menampilkan tombol coba lagi.
- Maksimal 30 tab total di semua profil.
- Ctrl/Cmd+L, Ctrl/Cmd+T, Ctrl/Cmd+W, Ctrl/Cmd+R; Alt+Left/Right.
- Panel sesi dapat disembunyikan.

Remote page tidak memiliki Node.js, preload internal, atau akses filesystem. Kamera, mikrofon, geolokasi, notifikasi dan unduhan ditolak sampai permission UI tersedia. Protokol lokal/eksternal tidak dibuka.

ProfileManager memiliki lock berdasarkan owner task dan menolak owner berbeda serta penghapusan profil terkunci. Integrasi lock dengan agent akan diterapkan bersama task engine; belum ada aktivitas AI atau koneksi MCP pada versi ini.

## Pemeriksaan

```sh
npm run typecheck
npm test
npm run test:e2e
```

Alternatif tanpa wrapper npm:

```sh
node scripts/build.cjs
node --test tests/*.test.cjs
node tests/electron.cjs
node tests/persistence.cjs
```

Unit tests memverifikasi URL, IPC, metadata, validasi profil, penghapusan, dan ownership lock.

Tes Electron menggunakan server localhost dan data sintetis di direktori pengujian terpisah. Tes persistence menutup dan membuka ulang Electron; memverifikasi cookie persisten, localStorage, IndexedDB, pemisahan profil, single-instance, pembatalan/penghapusan profil serta kebersihan renderer. Akun Instagram/YouTube pengguna tidak diakses oleh tes.

Screenshot: `test-results/home.png`, `test-results/compact.png`, `test-results/profiles.png`.

## Struktur

```text
src/main/
  index.ts               Lifecycle, single-instance, IPC dan konfirmasi hapus
  browser-manager.ts     Tab dan navigasi per profil
  profile-manager.ts     Metadata persisten dan ownership lock
  session-manager.ts     Partisi Chromium, flush, dan penghapusan data
src/preload/index.ts     API UI terbatas
src/renderer/           Antarmuka browser
src/shared/             Tipe dan validasi input
tests/                  Unit dan integrasi Electron
docs/architecture.md    Arsitektur dan roadmap
```

Electron 44.2.0, TypeScript 7.0.2, Playwright 1.63.0. Dependensi dikunci di `package-lock.json`.
