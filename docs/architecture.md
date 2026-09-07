# Arsitektur Hero Browser 0.2

## Status

Milestone 1 (browser dasar) dan Milestone 2 (profil persisten) selesai. Pemilihan profil serta lock manager dari Milestone 3 tersedia. Lock belum dihubungkan ke transport agent, karena MCP dan TaskManager belum diimplementasikan.

## Alur

```text
Renderer -> Preload -> IPC + validasi sender -> Command handler
                                                   |
                     +-----------------------------+------------------+
                     |                             |                  |
               BrowserManager               ProfileManager     SessionManager
                     |                        profiles.json     persist:hero-ID
              WebContentsView
                     |
             Snapshot UI tanpa secret
```

BrowserManager menerima ProfileManager dan SessionManager melalui constructor. Tab memiliki ID profil, dan snapshot UI hanya menyertakan tab profil aktif. Pergantian profil menyembunyikan view profil lama tanpa menghancurkannya. Command penutupan/pemilihan tab dari profil lain ditolak.

SessionManager membuat satu partisi persisten per ID profil. Nama profil tidak pernah digunakan sebagai path. Pengaturan sandbox, isolasi dan penolakan permission berlaku sama untuk semua partisi. Popup dari profil yang sedang tidak aktif ditolak agar tidak membuka tab pada identitas yang salah.

ProfileManager menyimpan metadata versi 1 melalui penulisan ke file sementara unik, flush, lalu rename. Perubahan in-memory baru diterapkan setelah penulisan berhasil. Korupsi metadata menghentikan startup dengan pesan yang jelas; data asli dipertahankan.

## Lifecycle data

- Aplikasi persisten memakai userData **Hero Browser Profiles**, terpisah dari runtime 0.1 yang masih memakai partisi memori.
- Parameter eksplisit --user-data-dir tetap didukung untuk tes. sessionData diarahkan ke direktori tersebut.
- Single-instance lock mencegah dua proses versi persisten memakai direktori data yang sama.
- Tombol simpan serta penutupan jendela normal memanggil flushStorageData dan menunggu cookies.flushStore.
- Cookie sesi tanpa tanggal kedaluwarsa tidak diubah menjadi cookie persisten. sessionStorage dan restore tab tidak dijanjikan lintas restart.
- Sesi autentikasi mengikuti aturan situs. Tidak ada boolean authenticated yang ditebak dari jumlah cookie.

## Penghapusan profil

1. Validasi profil ada, bukan Default, dan tidak dikunci.
2. Tampilkan konfirmasi native dengan Batal sebagai pilihan default.
3. Tutup WebContents milik profil target; pindahkan UI ke Default jika perlu.
4. Tutup koneksi, clearData, clearAuthCache, dan flush penyimpanan profil target.
5. Hapus metadata profil hanya setelah penghapusan data Chromium berhasil.

Jika penghapusan data gagal, metadata dipertahankan agar pengguna dapat mencoba lagi. Tidak ada recursive filesystem delete. Native view yang ditutup tidak menyisakan tab aktif pada profil yang dihapus.

## Profile lock

Lock bersifat in-memory, dimiliki satu taskId. Lock berulang oleh owner yang sama idempoten; owner lain mendapat PROFILE_BUSY. Hanya owner yang sama dapat membuka kunci. Penghapusan profil terkunci ditolak.

Lock tidak dipersistenkan karena task belum bisa dipulihkan setelah restart. TaskManager nanti bertanggung jawab memperoleh/melepas lock sepanjang lifecycle otomasi. Browsing manual tetap tersedia untuk human intervention.

## Batas kepercayaan

- Shell dan halaman remote memakai contextIsolation, sandbox dan nodeIntegration false.
- Preload hanya ada pada shell lokal, dengan capability terbatas tanpa evaluate/IPC generik.
- IPC memeriksa WebContents pengirim, main frame, URL shell, dan argumen command.
- HTTP/HTTPS saja; credential di URL dan protokol lokal/eksternal ditolak.
- Halaman ditampilkan melalui WebContentsView. Ukuran view tervalidasi dan dibatasi jendela.
- Nama profil dan judul situs dirender sebagai teks, bukan HTML.
- Cookie, localStorage dan IndexedDB akun tidak dibaca untuk snapshot UI, log, atau status autentikasi.
- Tidak ada solver CAPTCHA atau bypass verifikasi.

## Verifikasi

Unit tests mencakup metadata setelah restart, nama/ID invalid, deduplikasi, snapshot immutability, lock owner, profil Default, korupsi metadata dan batas command IPC.

Tes Electron dasar mencakup navigasi, popup, error recovery, resize, isolasi remote, shortcut dan cleanup. Tes persistence menggunakan data sintetis pada server lokal: cookie dengan Max-Age, localStorage, dan IndexedDB; restart nyata; isolasi antarprofil; lifecycle penghapusan; single-instance. Tidak ada tes yang memakai akun pengguna.

## Berikutnya

- Milestone 4–5: server MCP lokal dan capability browser dengan schema, timeout serta cancellation.
- Milestone 6: TaskManager dan pengikatan lock ke lifecycle task.
- Milestone 7: pause/resume untuk tindakan manusia, tanpa bypass.
- Milestone 8–9: aktivitas nyata dan ekstraksi terstruktur.
- Milestone 10: permission UI, audit tanpa secret, packaging serta hardening.

## Dokumentasi primer

- [Electron Session](https://github.com/electron/electron/blob/main/docs/api/session.md)
- [Electron Cookies / flushStore](https://github.com/electron/electron/blob/main/docs/api/cookies.md)
- [Electron network context: session cookie lifetime](https://github.com/electron/electron/blob/main/shell/browser/net/network_context_service.cc)
- [Electron Web Embeds](https://github.com/electron/electron/blob/main/docs/tutorial/web-embeds.md)
- [Electron Security](https://github.com/electron/electron/blob/main/docs/tutorial/security.md)
- [Playwright Electron](https://github.com/microsoft/playwright/blob/main/docs/src/electron-api/class-electron.md)
