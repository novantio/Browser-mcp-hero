# Pembaruan engine Hero Browser

Hero memperbarui Chromium dengan mengunduh runtime Electron yang membawanya. Google Chrome yang terpasang di Windows merupakan aplikasi terpisah.

## Pemakaian

Di panel **ENGINE BROWSER**, opsi **Unduh pembaruan stabil otomatis** aktif secara bawaan. Hero mengecek rilis stabil resmi Electron sekitar 10 detik setelah dibuka jika pemeriksaan terakhir sudah lebih dari 6 jam. Selama aplikasi berjalan, penjadwal mengevaluasi waktu pemeriksaan setiap 30 menit. Tombol **Periksa & unduh pembaruan** dapat dipakai kapan saja.

Pembaruan diunduh dan diuji di latar belakang. Ketika status **Siap** muncul, tutup Hero secara normal lalu buka melalui **start.cmd**, **npm start**, atau **node scripts/start.cjs**. Peluncuran otomatis oleh MCP menggunakan peluncur yang sama. Membuka peluncur saat Hero masih berjalan hanya memfokuskan jendela lama; engine belum berganti sampai aplikasi ditutup.

Menjalankan Electron langsung (misalnya **electron .**) melewati pemilihan engine dari peluncur.

## Penyimpanan sesi

- Updater tidak menghapus, menyalin, atau mengganti cookie, login, partisi profil, maupun pengaturan Share.
- Data akun tetap berada di **%APPDATA%\Hero Browser Profiles** (atau direktori profil khusus yang sudah dikonfigurasi).
- Engine dan preferensi updater disimpan terpisah di **%LOCALAPPDATA%\Hero Browser Engines**.
- Hero menyimpan sesi melalui alur penutupan normal yang sudah ada; updater tidak memaksa restart.
- Pengujian runtime baru menggunakan profil sementara. Arsip gagal dan engine lama tidak dibersihkan otomatis.
- Situs tetap dapat mengakhiri sesi atau meminta login ulang menurut kebijakannya sendiri.

## Verifikasi dan kegagalan

Rilis berasal dari GitHub resmi Electron. Unduhan menggunakan verifikasi SHA-256 dari SHASUMS256.txt. Ekstraksi membatasi ukuran dan jumlah entri, menolak traversal direktori, symlink, nama perangkat Windows, dan alternate data streams.

Sebelum aktivasi, runtime diuji dengan BrowserWindow, WebContentsView, sandbox, dan SQLite/FTS5 pada profil terpisah. Metadata engine terpilih baru diganti secara atomik setelah pemeriksaan berhasil. Gangguan jaringan, pembatalan, atau pengujian gagal mempertahankan pilihan engine sebelumnya.

Peluncur memeriksa lokasi dan checksum executable sebelum memakainya. Metadata atau executable yang rusak menghentikan peluncuran, sehingga aplikasi tidak diam-diam membuka profil dengan runtime lebih lama. Updater tidak menawarkan downgrade otomatis.

## MCP

- **browser_get_engine_status**: versi berjalan, versi yang siap, waktu pemeriksaan, progres, dan status.
- **browser_check_engine_update**: mulai pemeriksaan/unduhan di latar belakang dan segera kembalikan status. Gunakan tool status untuk melihat hasil akhirnya.

Kedua tool tersedia pada preset **all** dan **automation**, tanpa harus membuat task browser.

## Konfigurasi dan cakupan

- **HERO_ENGINE_HOME**: ganti direktori engine/cache/preferences untuk instalasi terpisah atau pengujian.
- **HERO_ENGINE_UPDATES=0**: matikan pemeriksaan otomatis untuk proses itu; pemeriksaan manual tetap tersedia.
- **HERO_USER_DATA_DIR**: tetap diteruskan oleh peluncur untuk profil khusus.
- Didukung untuk aplikasi dari proyek ini pada **Windows x64/arm64**. Pengunduhan berjalan ketika Hero terbuka.
- Distribusi aplikasi packaged/installer belum memakai updater ini. Distribusi tersebut memerlukan mekanisme pembaruan aplikasi bertanda tangan sendiri.

## Pengujian

Jalankan **npm test** dan **npm run test:e2e**. Untuk rangkaian uji lokal tanpa unduhan otomatis, atur **HERO_ENGINE_UPDATES=0** dan **HERO_ENGINE_HOME** ke direktori uji terpisah.

Uji engine mencakup kegagalan verifikasi, pembatalan, pemilihan versi, checksum executable, penolakan entri arsip berbahaya, runtime nyata, panel updater, penyimpanan preferensi, dan kedua tool MCP. Uji antarmuka hanya menggunakan profil serta cookie sintetis. Variabel opsional **HERO_TEST_ENGINE** menerima path executable runtime baru untuk menguji upgrade profil sintetis dari engine bawaan.
