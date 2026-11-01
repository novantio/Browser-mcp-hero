# Panduan Integrasi Hero Browser MCP ke Berbagai Code Editor & AI Client

> Instalasi dari nol (clone, build, verifikasi) ada di [INSTALL.md](INSTALL.md). Contoh path di bawah memakai lokasi pengembangan; ganti dengan path `dist/mcp/index.js` di mesin Anda.

Dokumen ini menjelaskan cara menghubungkan **Hero Browser (Web Data OS & AI Browser)** ke berbagai code editor dan AI environment yang mendukung protokol **Model Context Protocol (MCP)**.

---

## Daftar Isi
- [Arsitektur Hero Browser MCP](#arsitektur-hero-browser-mcp)
- [Prasyarat](#prasyarat)
- [1. Konfigurasi di Cursor](#1-konfigurasi-di-cursor)
- [2. Konfigurasi di VS Code (Cline & Roo Code)](#2-konfigurasi-di-vs-code-cline--roo-code)
- [3. Konfigurasi di Windsurf (Codeium)](#3-konfigurasi-di-windsurf-codeium)
- [4. Konfigurasi di Claude Desktop](#4-konfigurasi-di-claude-desktop)
- [5. Konfigurasi di Zed Editor](#5-konfigurasi-di-zed-editor)
- [6. Konfigurasi di Antigravity IDE](#6-konfigurasi-di-antigravity-ide)
- [7. Script / Custom MCP Client (Node.js / Python)](#7-script--custom-mcp-client-nodejs--python)
- [Daftar Tool Unggulan yang Didapat](#daftar-tool-unggulan-yang-didapat)
- [Troubleshooting & Solusi Masalah Umum](#troubleshooting--solusi-masalah-umum)

---

## Arsitektur Hero Browser MCP

Hero Browser beroperasi dengan arsitektur **Hybrid Client-Host**:
```
┌────────────────────────────────────────────────────────┐
│     AI Editor (Cursor / VS Code / Claude / Windsurf)   │
└───────────────────────────┬────────────────────────────┘
                            │ Stdio (stdin/stdout JSON-RPC)
┌───────────────────────────▼────────────────────────────┐
│         Hero MCP Server (dist/mcp/index.js)            │
└───────────────────────────┬────────────────────────────┘
                            │ Local Authenticated RPC (mcp-bridge.json)
┌───────────────────────────▼────────────────────────────┐
│      Hero Browser App (Desktop / Headless Runtime)     │
│   • Multi-Strategy Extraction  • CDP Network Intercept │
│   • Human Intervention Pop-up  • Persistent Sessions   │
└────────────────────────────────────────────────────────┘
```

1. **Jendela Browser Aktif:** Ketika Hero Browser berjalan (`npm start` atau `start_hero.bat`), ia menulis file bridge lokal yang aman di `%APPDATA%/Hero Browser Profiles/mcp-bridge.json` (berisi port RPC lokal dan token autentikasi acak per sesi).
2. **MCP Stdio Server:** `dist/mcp/index.js` membaca file bridge tersebut dan menghubungkan AI Agent Anda langsung ke instance browser aktif dengan latensi rendah.

---

## Prasyarat

1. **Node.js**: v22 atau yang lebih baru terinstal.
2. **Build Project**: Pastikan project sudah di-build setidaknya sekali:
   ```bash
   cd d:\project\node\2026\Browser-mcp-hero
   npm install
   npm run build
   ```
3. **Hero Browser Berjalan**: Jalankan Hero Browser sebelum memanggil tool di editor Anda:
   ```bash
   npm start
   # Atau double-klik start_hero.bat di Windows
   ```

---

## 1. Konfigurasi di Cursor

Cursor mendukung MCP secara native baik via file workspace config maupun Settings GUI.

### Cara A: Melalui `.cursor/mcp.json` (Rekomendasi)
Buat atau edit file `.cursor/mcp.json` di root workspace atau project Anda:

```json
{
  "mcpServers": {
    "hero-browser": {
      "command": "node",
      "args": [
        "D:\\project\\node\\2026\\Browser-mcp-hero\\dist\\mcp\\index.js"
      ]
    }
  }
}
```

> **Catatan Windows:** Gunakan double backslash (`\\`) atau forward slash (`/`) pada path file.

### Cara B: Melalui Cursor Settings GUI
1. Buka **Cursor Settings** (`Ctrl + ,` atau tombol gear di pojok kanan atas).
2. Navigasi ke **Features** → **MCP Servers**.
3. Klik tombol **+ Add New MCP Server**.
4. Masukkan parameter:
   - **Name**: `hero-browser`
   - **Type**: `command` (stdio)
   - **Command**: `node D:/project/node/2026/Browser-mcp-hero/dist/mcp/index.js`
5. Simpan dan pastikan indikator hijau aktif (*Active*).

---

## 2. Konfigurasi di VS Code (Cline & Roo Code)

Untuk pengguna Visual Studio Code yang menggunakan ekstensi agen AI otonom seperti **Cline** atau **Roo Code**:

### A. Ekstensi Cline
1. Buka ekstensi **Cline** di sidebar VS Code.
2. Klik tab **MCP Servers** (ikon terminal/server).
3. Klik tombol **Configure MCP Servers** (ini akan membuka file `cline_mcp_settings.json`).
4. Tambahkan konfigurasi berikut ke dalam objek `mcpServers`:

```json
{
  "mcpServers": {
    "hero-browser": {
      "command": "node",
      "args": [
        "D:/project/node/2026/Browser-mcp-hero/dist/mcp/index.js"
      ],
      "disabled": false,
      "autoApprove": [
        "browser_navigate",
        "browser_get_dom",
        "browser_read_page",
        "data_extract_multistrategy"
      ]
    }
  }
}
```

### B. Ekstensi Roo Code
Langkah sama seperti Cline, buka Roo Code Settings → MCP Servers → Edit `mcp_settings.json`, lalu tambahkan blok `"hero-browser"` seperti di atas.

---

## 3. Konfigurasi di Windsurf (Codeium)

Windsurf menggunakan file konfigurasi global MCP yang terletak di:
- **Windows**: `%USERPROFILE%\.codeium\windsurf\mcp_config.json`
- **macOS / Linux**: `~/.codeium/windsurf/mcp_config.json`

Buka file tersebut dan tambahkan:

```json
{
  "mcpServers": {
    "hero-browser": {
      "command": "node",
      "args": [
        "D:/project/node/2026/Browser-mcp-hero/dist/mcp/index.js"
      ]
    }
  }
}
```
Muat ulang Windsurf (*Reload Window*) untuk memuat tool Hero Browser (default preset core, 33 tool).

---

## 4. Konfigurasi di Claude Desktop

Untuk menggunakan Hero Browser langsung bersama **Claude 3.7 / 3.5 Sonnet** di aplikasi resmi Claude Desktop:

1. Buka file konfigurasi Claude Desktop:
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
2. Masukkan konfigurasi berikut:

```json
{
  "mcpServers": {
    "hero-browser": {
      "command": "node",
      "args": [
        "D:\\project\\node\\2026\\Browser-mcp-hero\\dist\\mcp\\index.js"
      ]
    }
  }
}
```
3. Restart aplikasi Claude Desktop.
4. Anda akan melihat ikon palu (*tool icon*) di pojok chat dengan status *33 tools available* (preset core).

---

## 5. Konfigurasi di Zed Editor

Zed mendukung MCP secara eksperimental. Buka Zed `settings.json` (`Ctrl + ,`):

```json
{
  "experimental": {
    "model_context_protocol": {
      "servers": {
        "hero-browser": {
          "command": "node",
          "args": [
            "D:/project/node/2026/Browser-mcp-hero/dist/mcp/index.js"
          ]
        }
      }
    }
  }
}
```

---

## 6. Konfigurasi di Antigravity IDE

Di Antigravity IDE / Gemini CLI, tambahkan pada file konfigurasi MCP workspace (`mcp_config.json`) atau global:

```json
{
  "mcpServers": {
    "hero-browser": {
      "command": "node",
      "args": [
        "D:/project/node/2026/Browser-mcp-hero/dist/mcp/index.js"
      ]
    }
  }
}
```

---

## 7. Script / Custom MCP Client (Node.js / Python)

Jika Anda membangun custom agent atau skrip otomatisasi sendiri menggunakan SDK resmi:

### Contoh Node.js (@modelcontextprotocol/sdk)
```javascript
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['D:/project/node/2026/Browser-mcp-hero/dist/mcp/index.js'],
  });

  const client = new Client({ name: 'my-agent', version: '1.0' });
  await client.connect(transport);

  // Jalankan browsing & ekstraksi multi-strategi
  const res = await client.callTool({
    name: 'browser_navigate',
    arguments: { url: 'https://news.ycombinator.com' },
  });
  console.log(res);
}
main();
```

### Contoh Python (mcp package)
```python
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

server_params = StdioServerParameters(
    command="node",
    args=["D:/project/node/2026/Browser-mcp-hero/dist/mcp/index.js"]
)

async def run():
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            print(f"Total tools tersedia: {len(tools.tools)}")

if __name__ == "__main__":
    import asyncio
    asyncio.run(run())
```

---

## Daftar Tool Unggulan yang Didapat

Dengan mengintegrasikan Hero Browser MCP, AI Assistant Anda di editor apa pun mendapatkan akses ke **113 tool** (33 aktif secara default di preset core):

| Kategori | Tool Utama | Fungsi |
|---|---|---|
| **Browsing Dasar** | `browser_navigate`, `browser_click`, `browser_type`, `browser_scroll` | Kontrol halaman web penuh dengan interaksi natural |
| **Visibilitas & Human** | `browser_set_visibility`, `browser_request_human_intervention` | Mode headless dengan pop-up intervensi manusia otomatis saat kena CAPTCHA |
| **Akuisisi Multi-Strategi**| `data_extract_multistrategy` | Ekstraksi 6 layer: CDP Network, State Hydration (`__NEXT_DATA__`), JSON-LD, DOM, ARIA |
| **Self-Healing** | `data_heal_selector` | Deteksi dan perbaikan selector yang rusak karena perubahan website |
| **Observabilitas Network** | `data_get_network_exchanges`, `data_get_network_recipe`, `data_replay_network_recipe` | Rekam API request/response internal dan replay tanpa perlu render DOM |
| **Streaming & Frontier** | `data_collect_stream`, `data_frontier_push`, `data_frontier_next` | Infinite scroll collector dengan in-flight deduplication |
| **Data Lineage** | `data_get_lineage` | Silsilah jejak asal usul data dari record hingga network exchange dan profil |

---

## Troubleshooting & Solusi Masalah Umum

1. **Error `Hero Browser belum aktif` atau `Bridge file tidak ditemukan`:**
   - **Penyebab**: Hero Browser belum dijalankan sebelum MCP dipanggil.
   - **Solusi**: Jalankan `npm start` atau double-klik `start_hero.bat`. Pastikan panel status di pojok kanan bawah browser menunjukkan `AI BROWSER RUNTIME: MCP AKTIF`.
2. **Path Windows Mengalami Error Escape:**
   - Di file JSON, selalu gunakan double backslash (`\\`) atau slash biasa (`/`), contoh: `"D:/project/node/2026/Browser-mcp-hero/dist/mcp/index.js"`.
3. **Mengubah Mode Headless menjadi Headful Saat Verifikasi CAPTCHA:**
   - Ketika bot Anda terjebak Cloudflare Turnstile, panggil `browser_request_human_intervention`. Jendela browser akan seketika pop-up ke layar monitor fisik Anda (`setAlwaysOnTop`) untuk Anda klik, lalu kembali melanjutkan otomatis.
