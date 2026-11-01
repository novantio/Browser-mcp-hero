# Hero Browser

Browser desktop Electron + TypeScript untuk fondasi runtime browser bersama manusia dan AI.

**Versi 0.4:** AI Browser Runtime berbasis Electron + MCP Server (`@modelcontextprotocol/sdk`). Mendukung otomasi browser (navigate, click, type, screenshot, structured extraction), tab browser, profil persisten dengan isolasi data, Share sesi, popup OAuth Google/TikTok/Twitter native, Task Engine dengan ownership lock, dan alur **Human-in-the-loop Challenge Handling** (CAPTCHA/MFA/verifikasi manual).

## Instalasi untuk AI agent

Beri agent Anda (Claude Code, Codex, Cursor, Cline, Gemini CLI, opencode, ...) satu kalimat ini:

```text
Pasang Hero Browser mengikuti https://github.com/novantio/Browser-mcp-hero/blob/main/docs/INSTALL.md
```

📖 **[docs/INSTALL.md](docs/INSTALL.md)** berisi clone, build, pendaftaran MCP per client, verifikasi, cara pakai, dan tabel pemulihan error.

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

Launcher membangun TypeScript lalu membuka Electron. `npm run restart` membangun ulang dan membuka ulang aplikasi yang sedang berjalan (agent bisa memakai tool `browser_restart_app`). Aplikasi tidak memerlukan API key atau server pengembangan. Jika versi persisten sudah terbuka, peluncuran kedua akan memfokuskan jendela tersebut.

Wrapper npm global pada mesin pengembangan awal bermasalah. Launcher langsung di atas tetap dapat dipakai setelah dependensi terpasang.

## Pembaruan engine otomatis

Hero memeriksa rilis stabil Electron secara berkala dan menyiapkan Chromium baru di latar belakang. Panel **ENGINE BROWSER** menampilkan versi, progres, opsi otomatis, dan tombol periksa manual. Engine terverifikasi dipakai saat peluncuran berikutnya melalui **start.cmd** atau **npm start**, tanpa restart paksa atau penghapusan data login.

Fitur ini mendukung Windows x64/arm64 saat aplikasi dijalankan dari proyek. Detail penyimpanan, verifikasi, MCP, dan batas distribusi installer tersedia di [panduan pembaruan engine](docs/engine-updates.md).

## Mulai memakai profil

1. Pilih **Instagram** melalui menu **Profil** di kanan atas.
2. Klik pintasan Instagram, lalu login secara manual.
3. Pilih profil **YouTube**, buka pintasan YouTube, lalu login.
4. Klik **Simpan sekarang** untuk segera menyimpan perubahan yang masih menunggu penulisan ke disk. Penyimpanan Chromium juga berjalan otomatis, dan aplikasi menunggu proses simpan ketika ditutup normal.
5. Buka ulang aplikasi dan pilih profil yang sama untuk memakai data situs tersebut kembali.

Profil bawaan: Default, Instagram, YouTube, Riset. Nama profil adalah label, bukan pembatas situs: setiap profil bisa membuka situs apa pun. Secara default cookie, localStorage, IndexedDB dan cache dipisahkan per profil. Opsi Share menghubungkan profil pilihan ke sesi sumber yang sama. Tab tetap hidup saat berpindah profil selama aplikasi terbuka.

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

ProfileManager memiliki lock berdasarkan owner task dan menolak owner berbeda serta penghapusan profil terkunci. Lock sudah terhubung ke task engine dan setiap aksi MCP. Status task dan aktivitas ditampilkan di UI.

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

## Kelola profil: duplikat login, ganti nama, hapus

Klik **⚙ Kelola** di kanan atas (atau Ctrl+Shift+P). Setiap profil punya tombol **Pakai**, **Duplikat…**, **Ganti nama**, dan **Hapus**. Kalau sebuah tombol tidak bisa dipakai, alasannya muncul saat kursor diarahkan ke tombol itu.

- **Duplikat** membuat profil baru yang terpisah. Kalau **Salin login** dicentang, cookie login profil asal ikut disalin, misalnya profil A yang login Google a1 menghasilkan profil B yang juga login Google a1. localStorage tidak ikut disalin. Karena akunnya sama, logout di satu profil bisa ikut mengakhiri login di profil lain.
- **Pakai login bersama…** (dulu "Share sesi") membuat beberapa profil memakai satu sesi yang sama secara langsung.
- Panel samping bisa disembunyikan dengan **◧ Sembunyikan panel**, tombol **»**, atau Ctrl+Shift+B, supaya halaman web memakai seluruh lebar. Pilihan ini diingat setelah restart.

## Gmail / Google dan Share sesi

1. Pilih profil yang sudah memiliki login Google, misalnya YouTube.
2. Tombol **Gmail / Google** membuka Gmail pada tab baru di sesi profil itu. Jika belum login, masuk melalui halaman Google seperti biasa.
3. Klik **Share sesi**, pilih profil tujuan atau **Pilih semua**, lalu **Gunakan sesi bersama**.
4. Baca konfirmasi profil yang terdampak. Tab tujuan ditutup untuk mengganti sesi; simpan pekerjaan terlebih dahulu.

Share memakai satu sesi Chromium yang sama secara langsung, tanpa ekspor/impor cookie atau password. **Semua login situs** di sesi sumber ikut digunakan, bukan hanya Google. Logout dari satu profil juga berlaku pada anggota sesi bersama. Ini tidak membuat akun Instagram otomatis login dengan akun Google.

Sesi pribadi tujuan tetap disimpan. **Hentikan berbagi** pada profil penerima mengembalikannya ke sesi pribadi tersebut. Pada profil sumber, tombol itu mengembalikan semua penerima ke sesi pribadi masing-masing. Tab profil yang berubah ditutup; buka lagi situs yang ingin digunakan.

Jika tujuan sebelumnya adalah sumber sebuah kelompok, anggota kelompok itu ikut dipindahkan dan dicantumkan dalam konfirmasi. Profil sumber tidak dapat dihapus selama masih dipakai profil lain. Menghapus profil penerima hanya membersihkan sesi pribadinya, bukan sesi sumber.

**Pilih semua** berlaku untuk profil yang ada saat itu. Profil baru tetap pribadi sampai dipilih untuk berbagi. Pilihan berbagi bertahan setelah restart. Login mengikuti aturan situs dan tidak dijamin aktif selamanya.

Tes `tests/sharing.cjs` memverifikasi konfirmasi dibatalkan, berbagi pilihan/semua, logout bersama, pemulihan sesi pribadi, restart, penghapusan penerima, dan pintasan Google. Semuanya menggunakan data sintetis localhost.

## Model Context Protocol (MCP) & Integrasi Editor AI

Hero Browser menyediakan **112 MCP tool**. Secara default hanya preset **core** (32 tool esensial) yang aktif supaya hemat token; agent bisa membuka preset `automation`, `data`, atau `all` dengan `browser_set_tool_preset`, atau set env `HERO_TOOL_PROFILE=all`. Tool-tool ini dapat dihubungkan ke berbagai Code Editor dan AI Client favorit Anda (Cursor, VS Code Cline/Roo, Windsurf, Claude Desktop, Zed, Antigravity, dll).

📖 **[BACA PANDUAN LENGKAP INTEGRASI MULTI-EDITOR (docs/mcp-client-setup.md)](docs/mcp-client-setup.md)**

### Konfigurasi Cepat (Quickstart MCP JSON)

Tambahkan blok berikut ke konfigurasi MCP editor Anda:

```json
{
  "mcpServers": {
    "hero-browser": {
      "command": "node",
      "args": ["/path/ke/hero-browser/dist/mcp/index.js"]
    }
  }
}
```

Claude Code: `claude mcp add hero-browser --scope user -- node /path/ke/hero-browser/dist/mcp/index.js`

| Editor / AI Client | Lokasi File Konfigurasi |
|---|---|
| **Cursor** | `.cursor/mcp.json` di root proyek atau *Cursor Settings → Features → MCP* |
| **VS Code (Cline / Roo)** | `cline_mcp_settings.json` atau via tab MCP Servers di sidebar Cline |
| **Windsurf** | `%USERPROFILE%\.codeium\windsurf\mcp_config.json` |
| **Claude Desktop** | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Antigravity / Gemini** | `mcp_config.json` pada folder workspace |

### Alur Agen Otomasi & Web Data OS

1. `browser_get_profile_logins` atau `browser_list_profiles` untuk mengecek profil mana yang sudah login ke platform target (TikTok, YouTube, Instagram, X, GitHub, dll.) melalui `loggedInServices`.
2. `browser_start_task({ profileId })` menggunakan profil yang sudah login untuk menghasilkan `taskId` dan mengunci sesi.
3. **Membaca informasi:** `browser_read_text({ taskId, url? })` mengubah halaman menjadi markdown ringkas ala lynx dengan tautan bernomor `[teks][n]`. Mode `fetch` mengunduh HTML dengan cookie profil tanpa menjalankan JavaScript, jadi halaman berat tidak membuat agent hang.
4. **Berinteraksi:** `browser_observe` (elemen bernomor; tombol kembar diberi konteks `(dekat: ...)`), lalu `browser_act`, `browser_click` dengan `elementId`, atau `browser_fill_form`. `browser_act` menolak target ambigu dengan `ELEMENT_AMBIGUOUS` beserta kandidatnya, tidak menebak.
5. **Pemulihan:** `PAGE_UNRESPONSIVE` → `browser_read_text` lalu `browser_reload({ force: true })`; cache usang → `browser_reload({ hard: true })`; aplikasi macet total → `browser_restart_app`.
6. Gunakan `browser_set_visibility({ taskId, visible: false })` jika ingin berjalan dalam mode Headless.
7. **Human Intervention & Deteksi CAPTCHA:** Hero Browser otomatis mendeteksi tantangan keamanan bot (TikTok SecSDK slider/rotate/2-objects puzzle, Cloudflare Turnstile, reCAPTCHA, hCaptcha, Arkose, Geetest, DataDome). Saat tantangan terdeteksi, tugas otomatis dialihkan ke manusia (`human_required`) atau agent dapat memanggil `browser_request_human_intervention`. Jendela Hero Browser akan memunculkan banner intervensi (puzzle/bot alert) agar pengguna dapat menyelesaikannya langsung di browser lalu klik "Lanjutkan".

8. **Multi-Strategy Data Extraction:** Panggil `data_extract_multistrategy` untuk ekstraksi data 6 layer otomatis (CDP Network response, embedded hydration JSON, JSON-LD, DOM, dan ARIA).
9. **Selector Self-Healing:** Jika website target mengubah markup / class CSS, `data_heal_selector` otomatis memulihkan selector berdasarkan atribut semantik.
10. `browser_complete_task({ taskId })` melepaskan kunci sesi setelah ekstraksi selesai.

### Ringkasan Katalog MCP Tool

| Domain | Total | Contoh Tool Utama |
|---|---|---|
| **Core Browser & Control** | 28 tools | `browser_navigate`, `browser_click`, `browser_type`, `browser_scroll`, `browser_set_visibility`, `browser_evaluate`, `browser_request_human_intervention` |
| **Data Storage & Analytics** | 36 tools | `data_store_document`, `data_query_documents`, `data_search_records` (FTS5), `data_clean_text`, `data_detect_diff`, `data_create_job`, `data_build_dataset` |
| **Web Data OS Enterprise** | 14 tools | `data_extract_multistrategy`, `data_heal_selector`, `data_detect_drift`, `data_get_network_exchanges`, `data_get_network_recipe`, `data_replay_network_recipe`, `data_collect_stream`, `data_copilot_synthesize`, `data_get_lineage` |

Task dijeda tetap mengunci seluruh kelompok sesi bersama. Jika profil aktif berubah manual, aktifkan kembali profil task sebelum melanjutkan. Operasi bersamaan mendapat BROWSER_BUSY.

### Pembatalan dan data sensitif

Timeout menghentikan request; pembatalan MCP diteruskan ke penantian browser dan task. Klik yang sudah terjadi tidak dapat diurungkan. Runner tidak mengulangi tindakan otomatis saat respons gagal diterima.

Pembacaan DOM bekerja pada salinan tersaring; password, hidden input, nilai formulir dan script tidak dikirim. Audit tidak menyimpan isi ketikan. Screenshot tetap memuat konten yang terlihat pada layar.

Lihat [arsitektur](docs/architecture.md) dan [checklist penyelesaian audit](docs/todo-status.md) untuk bukti pengujian serta batas implementasi.

### Memakai pembaruan tanpa mereset login

Lokasi data dan identitas partisi profil tidak berubah. Ketika siap, klik Simpan sekarang, lalu tutup dan buka aplikasi secara normal untuk memakai kode baru. Jangan hapus profil atau folder data untuk memperbarui aplikasi. Sesi login tetap tunduk pada kebijakan situs.
