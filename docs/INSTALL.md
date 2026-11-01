# Instalasi Hero Browser (untuk AI agent dan manusia)

Dokumen ini ditulis supaya AI agent (Claude Code, Codex, Cursor, Cline, Gemini CLI, opencode, dll.) bisa memasang Hero Browser sendiri. Cukup beri agent link ini:

```text
Pasang Hero Browser mengikuti https://github.com/novantio/Browser-mcp-hero/blob/main/docs/INSTALL.md
```

Ikuti langkah berurutan. Setiap langkah punya perintah verifikasi; jangan lanjut kalau verifikasinya gagal.

## 1. Prasyarat

| Kebutuhan | Cek | Catatan |
|---|---|---|
| Node.js 22 atau lebih baru | `node -v` | Unduh dari https://nodejs.org bila belum ada |
| Git | `git --version` | |
| OS desktop | Windows 10/11, macOS, atau Linux dengan desktop | Hero adalah aplikasi Electron dengan jendela; di Linux tanpa layar jalankan lewat `xvfb-run` |

## 2. Clone dan build

Pilih folder instalasi. Contoh di bawah memakai `~/tools/hero-browser`; di Windows misalnya `C:/tools/hero-browser`. Selalu pakai garis miring `/` pada path.

```sh
git clone https://github.com/novantio/Browser-mcp-hero.git ~/tools/hero-browser
cd ~/tools/hero-browser
npm ci
npm run build
```

Verifikasi:

```sh
node -e "require('./dist/mcp/index.js'); console.log('build OK')"
```

Catat path absolut file server MCP. Langkah berikutnya menyebutnya `HERO_MCP`:

```sh
node -p "require('path').resolve('dist/mcp/index.js').split(require('path').sep).join('/')"
```

## 3. Jalankan aplikasinya sekali

```sh
npm start
```

Jendela Hero Browser terbuka dan panel kanan bawah menampilkan **MCP AKTIF**. Setelah ini server MCP juga bisa menyalakan aplikasi sendiri bila belum berjalan, jadi langkah ini cukup sekali untuk memastikan Electron jalan di mesin ini.

Login ke situs yang dibutuhkan (TikTok, YouTube, Instagram, X, Google, ...) langsung di jendela Hero, per profil. Agent tidak pernah menerima password; sesi login disimpan di profil.

## 4. Daftarkan server MCP ke client

Ganti `HERO_MCP` dengan path dari langkah 2.

### Claude Code

```sh
claude mcp add hero-browser --scope user -- node HERO_MCP
```

Cek: `claude mcp list` menampilkan `hero-browser` dengan status connected.

### Codex CLI (`~/.codex/config.toml`)

```toml
[mcp_servers.hero-browser]
command = "node"
args = ["HERO_MCP"]
```

### Client berbasis JSON (Cursor, Claude Desktop, Cline/Roo, Windsurf, Gemini CLI, Antigravity)

```json
{
  "mcpServers": {
    "hero-browser": {
      "command": "node",
      "args": ["HERO_MCP"]
    }
  }
}
```

Lokasi file konfigurasi per editor ada di [mcp-client-setup.md](mcp-client-setup.md).

### opencode (`opencode.json`)

```json
{
  "mcp": {
    "hero-browser": { "type": "local", "command": ["node", "HERO_MCP"], "enabled": true }
  }
}
```

Muat ulang client setelah mengubah konfigurasi.

### Supaya agent memilih Hero, bukan Playwright

**Otomatis dari server.** Saat terhubung, Hero mengirim *server instructions* ke client MCP. Isinya: pakai Hero untuk situs sungguhan, situs yang butuh login, halaman berat JavaScript, dan situs dengan deteksi bot; pakai Playwright hanya kalau diminta. Claude Code, Cursor, dan client lain memasukkan instruksi ini ke prompt agent. Setelah memasang atau memperbarui Hero, muat ulang server MCP-nya (`/mcp` lalu reconnect di Claude Code, atau restart client).

Kalau agent masih memilih Playwright, tambahkan salah satu atau semua langkah berikut.

**1. Instruksi proyek atau global.** Tambahkan ke `CLAUDE.md` (Claude Code), `AGENTS.md` (Codex, opencode, Cursor), atau `GEMINI.md`:

```markdown
## Browser
Untuk membuka, membaca, atau berinteraksi dengan website, selalu gunakan MCP `hero-browser`
(browser_start_task → browser_navigate → browser_read_text / browser_act).
Jangan memakai Playwright, Puppeteer, atau curl untuk website kecuali saya minta,
atau untuk menjalankan test suite proyek ini.
```

**2. Matikan tool browser lain di Claude Code** (opsional), lewat `.claude/settings.json` di proyek atau `~/.claude/settings.json`:

```json
{
  "permissions": {
    "deny": ["mcp__playwright", "mcp__puppeteer"]
  }
}
```

`mcp__playwright` memblokir semua tool dari server MCP bernama `playwright`. Sesuaikan dengan nama server di `claude mcp list`. Di Cursor dan Cline, cukup nonaktifkan server Playwright di daftar MCP.

## 5. Verifikasi dari dalam agent

Jalankan berurutan:

1. `browser_list_profiles` mengembalikan daftar profil.
2. `browser_start_task` dengan `{ "profileId": "research" }` mengembalikan `id`. Itu `taskId`.
3. `browser_read_text` dengan `{ "taskId": "<id>", "url": "https://example.com" }` mengembalikan markdown berisi "Example Domain".
4. `browser_complete_task` dengan `{ "taskId": "<id>" }`.

Kalau keempatnya berhasil, instalasi selesai.

## 6. Cara pakai yang disarankan

Secara default hanya preset **core** (33 tool) yang aktif supaya hemat token. Tambah tool bila perlu dengan `browser_set_tool_preset` (`"automation"`, `"data"`, atau `"all"`), atau set env `HERO_TOOL_PROFILE=all` pada konfigurasi MCP.

Alur kerja dasar:

1. `browser_list_profiles`: pilih profil yang `loggedInServices`-nya berisi situs target.
2. `browser_start_task({ profileId })`: simpan `taskId` untuk semua perintah berikutnya. Task yang diam lebih dari 10 menit dijeda dan otomatis lanjut pada perintah berikutnya.
3. Untuk **mencari atau membaca informasi**, pakai `browser_read_text`. Hasilnya markdown ringkas ala lynx dengan tautan bernomor `[teks][n]` dan daftar URL di akhir. Untuk membuka tautan, panggil lagi dengan `url` dari daftar itu. Mode `fetch` tidak menjalankan JavaScript, jadi tetap jalan di halaman yang berat.
   Situs yang isinya dibuat oleh JavaScript (TikTok, Threads, X, Instagram) kosong di mode `fetch`; hasilnya berisi `hint`. Untuk situs seperti ini:
   1. Aktifkan mode hemat dengan `browser_set_media_mode({ taskId, mode: "lite" })`. Halaman tetap berjalan, tetapi gambar dan video tidak dimuat (teks dan font tetap), jadi lebih cepat dan hemat kuota.
   2. Buka halamannya dengan `browser_navigate`.
   3. Baca dengan `browser_read_text({ taskId, source: "live" })`.

   Kalau hasilnya berisi `challenge` (popup verifikasi atau deteksi AI, seperti yang sering muncul di TikTok), **berhenti**. Jangan reload atau mengulang. Panggil `browser_request_human_intervention`.
4. Untuk **berinteraksi**, pakai `browser_navigate`, lalu `browser_observe` (elemen bernomor `[n]`; tombol kembar diberi `(dekat: ...)`), lalu `browser_act`, `browser_click` dengan `elementId`, atau `browser_fill_form` untuk formulir.
5. Tambahkan `expect` (`{ "text": "..." }`, `{ "url": "..." }`, atau `{ "selector": "..." }`) pada navigate/click/act agar hasilnya terverifikasi dalam satu langkah.
6. Ketemu CAPTCHA atau login manual: `browser_request_human_intervention`. Untuk situs dengan anti-fraud ketat (marketplace, bank), biarkan **manusia** yang login langsung di jendela Hero; percobaan login berulang oleh agent bisa membuat akun diblokir.
7. **Profil:** `browser_duplicate_profile({ profileId, name })` membuat profil baru yang membawa cookie login profil asal (misal Google a1), `browser_rename_profile`, dan `browser_delete_profile({ profileId, confirm: true })` untuk membersihkan profil sementara. `browser_create_profile` tidak mengganti profil aktif manusia kecuali `switchTo: true`. Bila task berjalan di profil yang belum aktif, panggil `browser_switch_profile` dulu.
8. Selesai: `browser_complete_task`.

## 7. Pemulihan saat ada masalah

| Gejala / kode error | Lakukan |
|---|---|
| `PAGE_UNRESPONSIVE` (JavaScript halaman berat atau macet) | `browser_read_text` (otomatis membaca tanpa JavaScript), lalu `browser_reload` dengan `{ "force": true }` untuk memulihkan tab |
| `ELEMENT_AMBIGUOUS` | Pilih salah satu kandidat di pesan error dan ulangi dengan `elementId`-nya |
| Halaman tampil usang / cache | `browser_reload` dengan `{ "hard": true }` |
| `certificate_warning` saat navigasi | Sertifikat situs memang tidak valid. Minta manusia menyetujui di jendela Hero, atau buka situs lain |
| `BRIDGE_UNAVAILABLE` / browser macet total | `browser_restart_app` (tanpa taskId), tunggu ±10–30 detik, lalu mulai task baru |
| `PROFILE_BUSY` | Profil dipakai task lain: `browser_list_tasks`, lalu selesaikan task itu atau pakai `browser_start_task` dengan `force: true` |

Dari terminal:

```sh
npm run restart   # build ulang + buka ulang Hero yang sedang berjalan (atau menyalakannya)
```

## 8. Memperbarui

```sh
cd ~/tools/hero-browser
git pull
npm ci
npm run restart
```

Data profil dan login tidak terhapus saat update (`%APPDATA%/Hero Browser Profiles/` di Windows, `~/Library/Application Support/Hero Browser Profiles/` di macOS, `~/.config/Hero Browser Profiles/` di Linux). Setelah update, muat ulang server MCP di client (misalnya `/mcp` di Claude Code) supaya daftar tool baru terbaca.
