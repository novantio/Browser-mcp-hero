# Desain: Manajemen Profil, Data, dan Transfer Session/Cookie

Tanggal: 2026-10-01
Status: Menunggu review

## Tujuan

Menambahkan kemampuan untuk:

1. **Manajemen profil** yang belum ada: rename, delete via MCP, duplikat (opsional dengan data), dan ringkasan data per profil.
2. **Manajemen data di dalam profil**: lihat dan hapus cookie/storage/IndexedDB per profil (bukan hanya tab aktif).
3. **Transfer session/cookie antar profil**: salin data dari profil A ke profil B, dengan dua mode pengambilan (`live` dari sesi berjalan, `vault` dari disk).
4. Tersedia **lewat MCP (agen) dan UI (manusia)** yang memakai inti logika yang sama.

## Non-tujuan (YAGNI)

- Sinkronisasi dua arah antar profil (hanya salin satu arah A → B).
- Transfer antar mesin/perangkat (bukan remote sync).
- Enkripsi bundle di luar yang sudah diberikan Electron/sistem.
- Parse & remap konten LevelDB key-by-key (offline = byte-copy folder, bukan parse).

## Realita teknis (terverifikasi)

Direktori data: `%APPDATA%/Hero Browser Profiles/Partitions/hero-<profileId>/` (Electron `persist:hero-<profileId>`).

| Data | Lokasi | Format | Cara pindah |
|------|--------|--------|-------------|
| Cookie | `Network/Cookies` | SQLite | API `session.cookies` (paling andal) |
| localStorage | `Local Storage/leveldb/` | LevelDB | live via API per-origin; offline = byte-copy folder |
| sessionStorage | `Session Storage/` | LevelDB | **hanya live** (hilang saat profil ditutup) |
| IndexedDB | `IndexedDB/<origin>.indexeddb.leveldb` (+ `.blob`) | LevelDB | offline = byte-copy folder (gabung) |
| HTTP Cache | `Cache/`, `Code Cache/` | LevelDB | opsional, **default tidak ikut** (bisa ~908 MB) |

Semua LevelDB punya `LOCK` → **wajib profil tertutup** untuk operasi offline/vault.

## Arsitektur

Satu inti logika dipakai bersama MCP bridge dan IPC renderer.

### Komponen

- **`ProfileDataService`** (baru: `src/main/profile-data.ts`)
  Inti manajemen & transfer data profil. Bergantung pada `SessionManager` (partition) dan `ProfileManager` (validasi & izin). Tidak tahu apa-apa soal MCP/IPC.

- **`profile-manager.ts`** (tambah method)
  - `renameProfile(id, name)`
  - `deleteProfile(id)` — pindahkan logika hapus dari UI ke core
  - `duplicateProfile(id, newName)` — metadata; data opsional lewat `ProfileDataService`
  - `dataSummary(id)` — jumlah cookie, origin storage, jumlah IndexedDB origin, ukuran folder partition

- **`session-manager.ts`** (tambah method)
  - `readSessionData(profileId, scope)` — cookie + storage (live) dari partition
  - `writeSessionData(profileId, bundle)` — tulis ke partition tujuan
  - `clearProfileData(profileId, scope)`

- **`mcp-bridge.ts`** (tool baru)
  - `profiles.rename`, `profiles.delete`, `profiles.duplicate`, `profiles.dataSummary`
  - `data.export`, `data.importFrom` (transfer), `data.clear`

- **`renderer`** — panel "Profil & Sesi" diperluas: tombol rename/hapus/duplikat, ringkasan data, dialog transfer antar profil.

### Alur transfer

- **live**: baca cookie/storage dari `session.fromPartition('persist:hero-<src>')` yang hidup → tulis ke partition tujuan.
- **vault (offline)**: baca langsung dari disk `Partitions/hero-<src>/…` tanpa membuka profil; syarat profil sumber **dan** tujuan tidak aktif/terkunci.

## Model data

```ts
type ProfileDataScope = 'cookies' | 'localStorage' | 'sessionStorage' | 'indexedDB' | 'cache';

interface CookieRecord {
  name: string; value: string; domain: string; path: string;
  secure: boolean; httpOnly: boolean;
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
  expirationDate?: number;
}

interface OriginStorage { origin: string; entries: Record<string, string> }

interface ProfileDataBundle {
  mode: 'live' | 'vault';
  included: ProfileDataScope[];
  cookies: CookieRecord[];
  localStorage?: OriginStorage[];
  sessionStorage?: OriginStorage[];   // hanya live
  indexedDBNames?: string[];          // daftar origin yang disalin (vault: folder copy)
  truncated?: boolean;                // bila melebihi batas ukuran
}

interface ProfileDataSummary {
  profileId: string;
  cookieCount: number;
  storageOrigins: number;
  indexedDBOrigins: number;
  partitionBytes: number;
  active: boolean;                    // profil sedang terbuka?
}
```

## Batasan (jujur)

1. **Cookie** — paling andal; inti "login".
2. **localStorage** — live: bisa per-origin; vault: byte-copy folder LevelDB (tidak diparse).
3. **sessionStorage** — hanya `live`; tidak tersedia di `vault`.
4. **IndexedDB** — `vault`: copy folder `IndexedDB/<origin>.*` ke tujuan (gabung, jangan timpa yang ada); `live`: tidak didukung lewat API.
5. **Cache** — default **tidak** ikut; tersedia opsi `includeCache`.
6. **Syarat vault**: profil sumber & tujuan tertutup (LevelDB LOCK). Bila terbuka → tolak dengan pesan jelas dan tawarkan mode `live`.

## Keamanan

- Cookie `value`/token **diredaksi** di respons MCP (pola `redactText` yang ada), tetapi ditulis penuh ke partition tujuan.
- Transfer adalah operasi sensitif → wajib konfirmasi: UI dialog; MCP butuh `confirm: true`.
- Penulisan hanya di dalam `Hero Browser Profiles/`; tidak ada path arbitrer dari input pengguna.
- Transfer antar profil dengan sesi bersama (`sharedWith`) yang sama adalah no-op (ditolak).

## Penanganan error

- `PROFILE_NOT_FOUND`, `PROFILE_LOCKED` (sumber/tujuan aktif pada mode vault), `SAME_PROFILE` (A === B), `SAME_SESSION` (sudah berbagi sesi), `SCOPE_EMPTY` (tidak ada data), `SIZE_LIMIT` (bundle terlalu besar), `TRANSFER_FAILED`.
- Semua error memakai `RpcError` untuk MCP dan `ProfileError` untuk core, dengan pesan manusia yang aman.

## Pengujian

- Unit: `ProfileDataService` — validasi scope, deteksi profil aktif, dedup origin, batas ukuran, penolakan A === B / sesi sama. (Partition di-stub lewat interface tipis agar bisa diuji tanpa Electron.)
- Unit: `profile-manager` — rename (validasi nama/duplikat), delete (default tidak boleh), duplicate (nama unik, limit 20).
- Integrasi: round-trip bundle live pada dua sesi in-memory; vault copy folder pada direktori temp.
- E2E: transfer cookie antar dua profil, verifikasi profil tujuan login (via `profiles.getLogins`).

## Pemecahan & urutan implementasi

1. Core: `ProfileDataService` + tipe + unit test (TDD).
2. `profile-manager`: rename/delete/duplicate/summary + test.
3. `session-manager`: read/write/clear data + test.
4. MCP: contracts + `mcp-bridge` wiring + test kontrak.
5. Renderer: panel UI + dialog konfirmasi.
6. E2E transfer nyata.
