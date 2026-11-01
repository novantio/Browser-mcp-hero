# Navigasi dan penanganan sertifikat TLS

Dokumen ini menjelaskan bagaimana Hero Browser memutuskan URL dari input alamat, dan bagaimana
menangani server internal yang memakai sertifikat TLS tidak valid.

## Resolusi alamat (`resolveAddress`)

Input dari kotak alamat atau tool MCP `browser_navigate` dinormalisasi sebagai berikut:

1. Input berisi skema eksplisit (`http://` / `https://`) dipakai apa adanya (hanya HTTP/HTTPS).
2. Host tanpa skema mendapat skema otomatis:
   - **http** untuk loopback (`localhost`, `127.0.0.1`, `[::1]`), IP privat/link-local
     (`10.x`, `172.16-31.x`, `192.168.x`, `169.254.x`), dan nama `*.local`.
   - **https** untuk domain publik dan IP publik.
3. Input yang bukan alamat (mis. kata kunci) diubah menjadi pencarian Google.

## Fallback skema http <-> https

Tebakan skema tidak selalu benar (mis. layanan HTTP-only di port non-standar, atau layanan
HTTPS-only di LAN). Jika pemuatan **main frame** gagal (`did-fail-load`, selain `ERR_ABORTED`),
Hero otomatis mencoba **sekali** dengan skema lawannya (`http` <-> `https`). Ini menangani
server yang hanya melayani satu skema tanpa perlu dikonfigurasi.

## Sertifikat TLS internal (approve seperti Chrome)

Beberapa server internal (mis. nginx di IP LAN) memaksa HTTPS tetapi memakai sertifikat yang
tidak mencocokkan IP/hostname-nya. Browser menolaknya dengan
`ERR_CERT_COMMON_NAME_INVALID` (**kode -200**). Ini masalah konfigurasi sertifikat di sisi
server, bukan bug Hero.

Hero menanganinya seperti Chrome: alih-alih gagal diam-diam, Hero menampilkan halaman
peringatan **"Koneksi tidak privat"** dengan dua pilihan:

- **Kembali ke aman** — menolak dan membatalkan pemuatan.
- **Lanjutkan (tidak aman)** — menerima sertifikat, lalu memuat ulang halaman.

Setelah Anda menekan **Lanjutkan**, host tersebut disimpan **permanen** di
`trusted-certificates.json` (di direktori data aplikasi, `HERO_USER_DATA_DIR` bila diatur),
sehingga kunjungan berikutnya ke host itu tidak ditanya lagi — persis perilaku pengecualian
yang diingat browser.

Ketika diakses lewat MCP, tool `tabs.navigate` mengembalikan `status: "certificate_warning"`
beserta `certificateWarning.host` agar agen tahu bahwa persetujuan manusia diperlukan di UI.

> Catatan keamanan: menyetujui sertifikat yang tidak valid membuat koneksi ke host tersebut
> rentan terhadap MITM. Setujui hanya untuk jaringan internal tepercaya, dan sebisa mungkin
> perbaiki sertifikat server (tambahkan IP/hostname ke SAN).
