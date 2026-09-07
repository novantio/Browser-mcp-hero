# Hero Browser

Browser desktop berbasis Electron + TypeScript untuk fondasi runtime browser bersama manusia dan AI.

**Milestone 1 selesai:** browser dengan tab dan address bar. Profil persisten, MCP, penguncian profil, task engine, dan human intervention belum diimplementasikan.

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

Launcher membangun TypeScript lalu membuka Electron. Tidak memerlukan server pengembangan, API key, atau koneksi MCP. Electron dapat mengunduh binary saat pertama kali dijalankan.

Di mesin pengembangan awal, wrapper npm global menunjuk ke instalasi yang hilang. Dependensi dipasang melalui CLI npm yang tersedia di direktori instalasi Node. Launcher di atas tidak memerlukan wrapper npm global setelah instalasi dependensi.

## Fitur yang dapat dipakai

- Buka, pilih, dan tutup tab; menutup tab terakhir menampilkan tab baru.
- Masukkan URL atau istilah pencarian; pencarian menggunakan Google.
- Back, forward, reload, hentikan pemuatan, dan pemulihan halaman gagal dimuat.
- Tautan ke jendela baru menjadi tab di jendela yang sama.
- Konten halaman tetap hidup ketika berpindah tab.
- Panel sesi dengan jumlah tab nyata dan pilihan sembunyikan/tampilkan.
- Shortcut Ctrl/Cmd+L, Ctrl/Cmd+T, Ctrl/Cmd+W, Ctrl/Cmd+R; Alt+Left/Right.
- Maksimal 30 tab untuk membatasi penggunaan sumber daya.

## Batas tahap ini

Sesi situs dibagi oleh tab dalam **partisi sementara**. State halaman bertahan selama tab masih terbuka; sesi tidak dijanjikan bertahan setelah aplikasi ditutup. Pilihan ini disengaja karena profil persisten adalah Milestone 2. Status autentikasi tidak ditebak dari jumlah cookie.

MCP dan asisten AI pada panel ditandai sebagai belum tersedia. Belum ada koneksi agent, penyimpanan password, bookmark, restore tab, installer, atau pembaruan otomatis. Kamera, mikrofon, geolokasi, notifikasi, dan unduhan ditolak sampai alur perizinan tersedia. Navigasi dibatasi ke HTTP/HTTPS; protokol lokal/aplikasi eksternal tidak dibuka.

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
```

Tes integrasi menjalankan Electron asli, server fixture lokal, dan direktori data pengujian terpisah di `test-results/electron-profile`. Tes memverifikasi navigasi, state antartab, popup, ukuran native view, shortcut native, isolasi remote, URL terlarang, pemulihan kegagalan, serta cleanup tab. Screenshot disimpan di `test-results/home.png` dan `test-results/compact.png`.

Tes situs lokal tidak menjamin kompatibilitas semua situs, login pihak ketiga, DRM, atau mekanisme verifikasi web.

## Struktur

```text
src/
  main/
    index.ts               Lifecycle jendela dan validasi pengirim IPC
    browser-manager.ts     Lifecycle tab, navigasi dan native view
  preload/
    index.ts               API terbatas untuk UI aplikasi
  renderer/
    index.html             Browser chrome, tab baru dan panel sesi
    index.ts               Rendering state dan interaksi UI
    styles.css             Tema serta tata letak
  shared/
    types.ts               Kontrak state, command dan preload
    navigation.ts          Validasi command, URL dan area view
scripts/                   Build dan launcher
tests/                     Unit serta integrasi Electron
docs/architecture.md       Keputusan arsitektur dan roadmap
```

Versi terpasang dikunci dalam `package-lock.json`: Electron 44.2.0, TypeScript 7.0.2, Playwright 1.63.0.
