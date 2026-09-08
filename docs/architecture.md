# Arsitektur Hero Browser 0.4 — Web Data Operating System

Hero Browser adalah runtime Electron dengan profil persisten, sesi bersama, kontrol MCP, intervensi manusia, dan **Web Data Operating System** untuk ekstraksi data AI, monitoring berkelanjutan, kurasi dataset LLM, serta penelusuran garis silsilah data (data lineage).

## Jalur kontrol

Agent → MCP stdio → runner Node → RPC loopback terautentikasi → TaskManager / JobRunner → BrowserManager → WebContentsView (CDP attached).

- Runner mendaftarkan **78 tool MCP** yang terdiri dari:
  - 28 browser & automation tools (navigasi, klik, ketik, snapshot, tab, profil, task, dialog, intervensi, serta `browser_evaluate` terisolasi).
  - 36 data acquisition, analytics & LLM preparation tools (store, snapshot diff, PII scrubber, search FTS5, schema parse, dataset export, canonical graph, temporal/interaction analytics, embeddings, vector search, job runner).
  - 14 Web Data OS enterprise tools:
    - Multi-strategy extraction (`data_extract_multistrategy`)
    - Selector self-healing (`data_heal_selector`)
    - Schema drift detection (`data_detect_drift`, `data_get_schema_baseline`)
    - Network intelligence & CDP response capture (`data_get_network_exchanges`, `data_get_network_recipe`, `data_replay_network_recipe`)
    - Infinite scroll & streaming collector (`data_collect_stream`)
    - Rate limit & adaptive backoff (`data_check_rate_limit`, `data_report_request_status`)
    - Crawl frontier (`data_frontier_push`, `data_frontier_next`, `data_frontier_stats`)
    - Human curation queue (`data_review_queue_list`, `data_review_queue_curate`)
    - Scraper copilot (`data_copilot_synthesize`, `data_copilot_test`)
    - Data provenance lineage graph (`data_get_lineage`)
- Kontrak input menolak field tambahan dan membatasi ukuran/nilai parameter via Zod schemas. Hasil sukses dikirim sebagai structuredContent: `{ result: ... }`.
- Error tool memakai `isError` dengan kode error dan pesan yang tidak menggemakan isi halaman atau parameter sensitif.
- Bridge hanya mendengarkan loopback `127.0.0.1`. File `mcp-bridge.json` menyimpan token lokal sementara; token tidak pernah masuk log.
- Perintah otomasi yang sudah dikirim tidak dicoba ulang otomatis (idempotency safety).

---

## Lapisan Web Data Operating System

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AI / MCP AGENT & COPILOT                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  Multi-Strategy  │  Selector  │  Drift & Quality  │  Crawl Frontier & RPM   │
│    Extraction    │  Healing   │     Detection     │     Rate Limiter        │
├─────────────────────────────────────────────────────────────────────────────┤
│    Collector Engine (Infinite Scroll)    │     Human Review Queue           │
├─────────────────────────────────────────────────────────────────────────────┤
│  Network Intelligence Layer (CDP Network.enable, Body Capture & Replay)     │
├─────────────────────────────────────────────────────────────────────────────┤
│       Electron Core (Persistent Profiles, Safe DOM, Sanitized Whitelist)    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1. Multi-Strategy Extraction Engine (`ExtractionEngine`)
Menggabungkan 6 strategi ekstraksi dengan skor keyakinan (*confidence score* 0.0 – 1.0):
1. **Network Response:** Memeriksa payload JSON langsung dari intercept CDP tanpa ketergantungan render DOM.
2. **Embedded JSON / Hydration State:** Mengekstrak objek global Next.js (`__NEXT_DATA__`), Nuxt (`__NUXT__`), Redux (`__INITIAL_STATE__`), Apollo (`__APOLLO_STATE__`).
3. **JSON-LD & Meta Tags:** Mengekstrak schema.org Microdata, OpenGraph, dan Twitter Cards.
4. **DOM Selectors:** Menavigasi node CSS dengan atribut yang diizinkan.
5. **Accessibility / ARIA Tree:** Mengekstrak semantic roles (`heading`, `listitem`, `article`, `button`).
6. **Visual Fallback:** Menyiapkan bounding boxes untuk multimodal OCR/VLM.

### 2. Selector Self-Healing (`SelectorHealer`)
Mendeteksi kerusakan selector saat website mengubah markup atau CSS class dinamis (misalnya styled-components atau tailwind hash):
- Menghitung kemiripan semantic attribute (`data-testid`, `data-e2e`, `aria-label`, `role`).
- Menghitung token similarity (Jaccard coefficient) pada teks tombol/label.
- Memeriksa kesesuaian hierarchy tag dan mengembalikan rekomendasi selector baru dengan confidence score serta penjelasan alasan perbaikan (*reason*).

### 3. Schema Drift & Statistical Shift Detector (`DriftDetector`)
Melindungi pipeline data dari perubahan struktur yang tidak disadari:
- Menyimpan *moving baseline* per schema & target domain.
- Menghitung metrik drift:
  - Lonjakan nilai null / missing fields (flagged jika peningkatan null > 40%).
  - Ketidakcocokan tipe data (misalnya string angka berubah menjadi string narasi atau boolean).
  - Pergeseran distribusi nilai numerik (perubahan rata-rata > 4x dari baseline historis).
- Otomatis menandai records yang mencurigakan ke dalam **Human Review Queue**.

### 4. Network Intelligence & CDP Request Replay (`NetworkIntelligence`)
Menggunakan Chrome DevTools Protocol (`webContents.debugger` v1.3):
- Mengaktifkan `Network.enable` saat tab dibuat.
- Mengaitkan request/response dengan tab ID dan aksi browser terkini.
- Menangkap body payload JSON/XHR melalui `Network.getResponseBody`.
- Menghasilkan **Network Recipes**: template cURL/Fetch yang dapat dijalankan secara headless untuk menghemat bandwidth hingga 95% tanpa memuat ulang seluruh aset visual DOM.

### 5. Infinite Scroll & Stream Collector (`CollectorEngine`)
Primitive `browser_collect` untuk scraping feed, linimasa media sosial, dan e-commerce:
- Scrolling otomatis berbasis viewport dengan jeda dinamis (debounce).
- Ekstraksi bertahap (*batch extraction*) pada setiap scroll step.
- In-flight deduplication berdasarkan field kunci (misalnya `id`, `url`, atau `fingerprint`).
- Kondisi terminasi cerdas: mencapai batas `maxItems`, mendeteksi *no new items after N attempts*, atau timeout.

### 6. Crawl Frontier & Adaptive Rate Limiter
- **Crawl Frontier (`CrawlFrontier`):** Priority queue untuk penjelajahan multi-halaman dengan pelacakan URL yang sudah dikunjungi (`visited`), batas kedalaman (`maxDepth`), dan antrean coba ulang (`retryQueue`).
- **Adaptive Rate Limiter (`RateLimiter`):** Mengatur requests per minute (RPM) per host. Otomatis mengaktifkan exponential backoff dengan jitter saat menerima respon status HTTP 429 atau 503.

### 7. Human Review Queue (`ReviewQueue`)
Penyaring human-in-the-loop untuk kualitas data dan kepatuhan:
- Menampung record dengan confidence ekstraksi rendah (< 0.7), data terduga PII, atau anomali schema drift.
- Menyediakan status kurasi: `pending`, `approved`, `rejected`, `merged`, dan `edited`.
- Terintegrasi langsung dengan dashboard UI dan API MCP `data_review_queue_curate`.

### 8. Scraper Copilot (`ScraperCopilot`)
Alat bantu sintesis satu klik untuk agen dan engineer:
- Menerima kontrak tujuan (misal: "ambil nama produk, harga, dan rating") dan URL target.
- Menganalisis respon network yang relevan, state tersemat, dan pola DOM.
- Menghasilkan rekomendasi schema Zod, strategi ekstraksi optimal, dan selector yang andal.
- Menjalankan uji ekstraksi kilat (*dry run*) untuk mengukur akurasi sebelum job crawler dijalankan.

### 9. Content Provenance & Data Lineage (`DataStore.getLineage`)
Memetakan garis keturunan data lengkap dari hilir ke hulu:
- Record ID → Extracted Record → Extraction Strategy & Confidence → Network Request ID & URL → Browser Session / Profile → Timestamp & Origin Hash.
- Menyajikan audit trail yang tak terbantahkan untuk kepatuhan lisensi dan audit AI.

---

## Sanitasi DOM & Keamanan

Fungsi `readSafePage` dan snapshot bekerja pada salinan DOM terlepas:
- Whitelist atribut semantik: `id`, `name`, `class`, `role`, `aria-*`, `data-testid`, `data-e2e`, `data-cy`, `data-qa`, `itemprop`, `datetime`, `href`, `src`, `title`, `alt`.
- Script eksekusi berbahaya, frame eksternal, formulir password, dan token tersembunyi disaring secara otomatis.
- Evaluasi skrip melalui tool `browser_evaluate` diisolasi di sandbox halaman tanpa hak akses Node.js.

## Penyimpanan Profil & Login Persisten

Partisi profil tetap tersimpan di `persist:hero-<profileId>`.
- Identitas profil, sesi bersama (`sharedWith`), dan cookie autentikasi tidak pernah di-reset atau dihilangkan.
- Jendela popup OAuth mempertahankan relasi pembuka (`window.opener`) dengan sesi profil yang aman.

## Status Pengujian & Verifikasi

- **46 Unit & Integration Tests (100% Pass):**
  - RateLimiter (RPM, exponential backoff, jitter)
  - DriftDetector (null spikes, distribution shifts, baseline updates)
  - CrawlFrontier (priority queues, depth limiting, retry queue)
  - ReviewQueue (approve, reject, merge, edit curation lifecycle)
  - NetworkIntelligence (CDP exchanges, body capture, network recipes, action correlation)
  - DataLineage (full traversal from record to network exchange and profile)
  - MCP Tool Contracts (78 tools verified, strict parameter validations)
  - Profile persistence, shared session ownership, task locking, human intervention, and audit logging.

