# Arsitektur dan batas Milestone 1

## Sasaran

Fondasi browser yang bisa dipakai manusia, dengan modul browser terpisah dari UI dan transport MCP yang akan datang. Pekerjaan awal mengikuti instruksi spesifikasi untuk mengimplementasikan Milestone 1 saja dan memverifikasi peluncuran sebelum melanjutkan.

## Alur data

```text
Renderer UI -> Preload API -> IPC tervalidasi -> BrowserManager
                                                |
                                          WebContentsView
                                                |
                                  State -> Renderer UI
```

Satu BrowserWindow menjadi shell tepercaya. Setiap tab web memiliki WebContentsView tersendiri; hanya tab aktif yang terlihat. Posisi view berasal dari area konten yang diukur ResizeObserver, divalidasi di main process, dan dibatasi ukuran jendela. View tidak menggunakan iframe atau elemen webview.

BrowserManager memiliki lifecycle tab dan navigasi. Renderer mengirim command bertipe dan menampilkan snapshot; UI tidak menerima objek WebContents. Navigasi berjalan asinkron agar stop dan pergantian tab tetap responsif. Event Electron menyediakan title, URL, history, loading dan error. Child web contents ditutup secara eksplisit saat tab atau jendela ditutup.

## Batas kepercayaan

- Shell dan remote page memakai contextIsolation, sandbox, nodeIntegration false, dan webSecurity.
- Preload hanya diberikan kepada shell lokal. Tidak ada API evaluate, filesystem, cookie, atau IPC generik yang diekspos.
- Handler IPC memeriksa WebContents pengirim, main frame, dan URL shell yang tepat.
- Input command, ukuran view dan URL diperiksa saat memasuki main process.
- Top-level navigation serta popup dibatasi HTTP/HTTPS dan menolak URL dengan credentials.
- Tidak ada shell.openExternal otomatis, Node di situs, akses profil pengguna lain, atau pengecualian sertifikat.
- Permission check/request ditolak; unduhan dibatalkan pada tahap ini.
- Judul dan pesan dari halaman ditulis memakai textContent, tidak diinterpretasikan sebagai HTML.
- CSP shell hanya mengizinkan script/style lokal. Tidak ada konten situs atau credential di log aktivitas.
- Tidak ada mekanisme pemecahan CAPTCHA atau bypass verifikasi.

## Desain UI

Nama kerja: Hero Browser. Bahasa antarmuka: Indonesia.

Palet: chrome navy #111A2B, surface slate #182439, raised blue #223149, garis #2A3950, teks #EEF3FB, aksen periwinkle #9DBDFF. Status lokal memakai mint #8AD5C4.

Segoe UI untuk kontrol dan heading; Consolas untuk label utilitas; Georgia italic hanya pada monogram h dengan panah jelajah. Area tengah luas, toolbar ringkas, panel sesi di kanan. Panel AI adalah empty state yang jujur, bukan aktivitas simulasi.

## Tahap lanjutan

1. **Milestone 2: ProfileManager / SessionManager.** Metadata profil tervalidasi dan partisi persist terpisah. Uji isolasi antarprofil dan persistence setelah restart. Cookie, localStorage dan IndexedDB mengikuti perilaku Chromium; sessionStorage bukan penyimpanan yang dijamin bertahan setelah restart.
2. **Milestone 3: profil dan locking.** Pemilihan profil, owner task, busy error, serta cleanup lock.
3. **Milestone 4–5: MCP.** Transport lokal, schema input/output, cancel dan timeout; adapter memanggil capability browser tanpa menggabungkan server MCP ke UI.
4. **Milestone 6: TaskManager.** State machine, ownership tab, cancellation dan event.
5. **Milestone 7: HumanInterventionManager.** Pause, alasan tindakan, resume token dan tombol lanjut; halaman tetap interaktif untuk manusia.
6. **Milestone 8: aktivitas AI.** Event nyata beserta task/profile yang bersangkutan.
7. **Milestone 9: ekstraksi.** Output terstruktur dan dibatasi, tanpa cookie/token mentah.
8. **Milestone 10: permission dan audit.** Alur persetujuan capability sensitif, audit tanpa secret, penghapusan profil, hardening serta packaging.

## Sumber dokumentasi

Dokumentasi primer diperiksa melalui Context7 sebelum implementasi:

- [Electron Web Embeds / WebContentsView](https://github.com/electron/electron/blob/main/docs/tutorial/web-embeds.md)
- [Electron Navigation History](https://github.com/electron/electron/blob/main/docs/tutorial/navigation-history.md)
- [Electron Security](https://github.com/electron/electron/blob/main/docs/tutorial/security.md)
- [Electron Context Isolation](https://github.com/electron/electron/blob/main/docs/tutorial/context-isolation.md)
- [Playwright Electron](https://github.com/microsoft/playwright/blob/main/docs/src/electron-api/class-electron.md)
