import { z } from 'zod';
import {
  id, short, taskInput, task, socialAccount, profile, tab, ok, expectCondition, actionResult, observedElement, observeResult, consoleEntry, consoleLogsResult, networkActivityEntry, networkActivityResult, formField, formSubmitButton, inspectFormResult, fillFormResult, foundElement, findElementResult, getStateResult, healSelectorResult, detectChallengeResult, uploadFileResult, waitForDownloadResult, createCheckpointResult, rollbackCheckpointResult, actResult, profileLoginSummary, getProfileLoginsResult, cookieEntry, getCookiesResult, setCookieResult, getStorageResult, setStorageResult, dragAndDropResult, selected, engineState,
} from './mcp-schemas';

export interface ToolContract {
  name: string; method: string; description: string;
  input: z.ZodObject; output: z.ZodType;
}
const define = (name: string, method: string, description: string, shape: Record<string, z.ZodType>, output: z.ZodType): ToolContract =>
  ({ name, method, description, input: z.object(shape).strict(), output });

export const toolContracts: ToolContract[] = [
  define('browser_get_engine_status', 'engine.status', 'Versi Electron/Chromium dan status pembaruan engine.', {}, engineState),
  define('browser_check_engine_update', 'engine.check', 'Periksa dan siapkan rilis stabil resmi di latar belakang, tanpa menutup sesi aktif.', {}, engineState),
  define('browser_list_profiles', 'profiles.list', 'Daftar profil persisten dan status login sosial media (TikTok, YouTube, Instagram, X, Facebook, dll.). PENTING: Periksa field "loggedInServices" sebelum memulai tugas browser untuk memilih profileId yang sudah login.', {}, z.array(profile)),
  define('browser_get_profile_logins', 'profiles.getLogins', 'Daftar semua akun sosial media yang sedang login (TikTok, YouTube, Instagram, X/Twitter, Facebook, GitHub, dll.) di setiap profil browser beserta rekomendasi profileId yang harus digunakan.', { profileId: id.optional() }, getProfileLoginsResult),
  define('browser_create_profile', 'profiles.create', 'Buat profil baru (kosong) tanpa menghapus profil atau login lama. Profil aktif manusia TIDAK diganti kecuali switchTo: true. Tidak memerlukan taskId.', { name: z.string().trim().min(1).max(40), switchTo: z.boolean().optional() }, z.object({ activeProfileId: id, profileId: id }).strict()),
  define('browser_duplicate_profile', 'profiles.duplicate', 'Duplikat profil menjadi profil baru yang independen. copyLogin (default true) menyalin cookie sehingga login Google/situs lain ikut terbawa; localStorage tidak disalin. Logout di salah satu profil bisa ikut mengakhiri sesi di profil lain karena akunnya sama. name opsional (default "<nama> (salinan)").', { profileId: id, name: z.string().trim().min(1).max(40).optional(), copyLogin: z.boolean().optional(), switchTo: z.boolean().optional() }, z.object({ profileId: id, name: z.string(), copiedCookies: z.number().int() }).strict()),
  define('browser_rename_profile', 'profiles.rename', 'Ganti nama profil.', { profileId: id, name: z.string().trim().min(1).max(40) }, z.object({ ok: z.literal(true), profileId: id, name: z.string() }).strict()),
  define('browser_delete_profile', 'profiles.delete', 'Hapus profil beserta seluruh data situs dan loginnya (tidak bisa dibatalkan). Wajib confirm: true. Default, profil yang dipakai task, dan sumber login bersama tidak bisa dihapus. Pakai untuk membersihkan profil sementara buatan agent.', { profileId: id, confirm: z.literal(true) }, z.object({ ok: z.literal(true), profileId: id, activeProfileId: id }).strict()),
  define('browser_switch_profile', 'profiles.switch', 'Aktifkan profil milik task. Mulai task terlebih dahulu.', { ...taskInput, profileId: id }, selected),
  define('browser_unlock_profile', 'profiles.unlock', 'Buka paksa kunci profil yang menggantung (stale lock) jika task klien sebelumnya terputus atau crash.', { profileId: id }, z.object({ ok: z.literal(true), profileId: id }).strict()),
  define('browser_start_task', 'tasks.create', 'Mulai task dan kunci sesi profil. Gunakan ID hasilnya pada setiap perintah browser. Bila profileId bukan profil yang sedang aktif, panggil browser_switch_profile { taskId, profileId } sebelum navigasi. PENTING: Jika ingin membuka platform tertentu (misal TikTok), periksa browser_list_profiles lalu gunakan profileId yang memiliki sesi login platform tersebut. Mendukung batas inaktivitas (ttlSeconds, default 600 detik; task yang dijeda karena inaktivitas otomatis lanjut pada perintah berikutnya), retensi sesi (retentionSeconds, default 1800 detik / 30 menit), deskripsi task opsional, dan opsi force unlock.', {
    profileId: id.optional(),
    taskId: id.optional(),
    task: z.string().max(2000).optional(),
    description: z.string().max(2000).optional(),
    context: z.string().max(2000).optional(),
    ttlSeconds: z.number().int().min(1).max(86400).optional(),
    retentionSeconds: z.number().int().min(10).max(604800).optional(),
    force: z.boolean().optional(),
  }, task),

  define('browser_restart_app', 'app.restart', 'Restart aplikasi Hero Browser (build ulang lalu buka kembali) bila browser macet total atau setelah pembaruan kode. Sesi login dan profil tetap tersimpan; task berjalan berakhir sehingga mulai task baru setelahnya. Tidak memerlukan taskId.', {}, z.object({ ok: z.literal(true), restarting: z.literal(true), message: z.string() }).strict()),
  define('browser_list_tasks', 'tasks.list', 'Daftar tugas dan statusnya.', {}, z.array(task)),
  define('browser_get_task_status', 'tasks.get', 'Baca status task.', taskInput, task),
  define('browser_pause_task', 'tasks.pause', 'Jeda task dan hentikan penantian yang sedang berjalan.', taskInput, task),
  define('browser_resume_task', 'tasks.resumeIntervention', 'Lanjutkan task. Untuk intervensi manusia, sertakan resumeToken dari permintaan intervensi.', { ...taskInput, resumeToken: id.optional() }, task),
  define('browser_complete_task', 'tasks.complete', 'Akhiri task dan lepaskan kunci sesi.', taskInput, task),
  define('browser_cancel_task', 'tasks.cancel', 'Batalkan task dan penantian yang berjalan, lalu lepaskan sesi.', taskInput, task),
  define('browser_request_human_intervention', 'tasks.requestIntervention', 'Jeda task dan kembalikan human_required segera. Pengguna menyelesaikan tindakan di browser lalu melanjutkan.', {
    ...taskInput, reason: z.string().min(1).max(200), message: short, timeoutMs: z.number().int().min(5000).max(1800000).optional(),
  }, z.object({ status: z.literal('human_required'), taskId: id, reason: z.string(), message: z.string(), resumeToken: id }).strict()),
  define('browser_list_tabs', 'tabs.list', 'Daftar tab pada profil task yang aktif.', taskInput, z.array(tab)),
  define('browser_new_tab', 'tabs.new', 'Buka tab pada profil task.', { ...taskInput, url: short.optional() }, z.array(tab)),
  define('browser_close_tab', 'tabs.close', 'Tutup tab tertentu pada profil task.', { ...taskInput, tabId: id }, z.array(tab)),
  define('browser_switch_tab', 'tabs.switch', 'Aktifkan tab pada profil task.', { ...taskInput, tabId: id }, z.array(tab)),
  define('browser_navigate', 'tabs.navigate', 'Navigasi tab aktif milik task. Bila status "certificate_warning", sertifikat TLS host tidak valid dan persetujuan manusia diperlukan di UI Hero Browser (mirip "Proceed" di Chrome).', { ...taskInput, url: short, expect: expectCondition.optional() }, z.object({ url: z.string(), status: z.enum(['verified', 'unverified', 'certificate_warning']).optional(), certificateWarning: z.object({ host: z.string() }).optional(), hint: z.string().optional() }).strict()),
  define('browser_reload', 'tabs.reload', 'Muat ulang tab aktif. hard: abaikan cache. force: pulihkan tab yang macet/crash (JavaScript berat, PAGE_UNRESPONSIVE) dengan mematikan renderer lalu memuat ulang URL.', {
    ...taskInput, hard: z.boolean().optional(), force: z.boolean().optional(),
  }, z.object({ ok: z.literal(true), url: z.string(), recovered: z.boolean() }).strict()),
  ...['back', 'forward'].map(action => define('browser_' + action, 'tabs.' + action, 'Navigasi tab aktif milik task: ' + action, taskInput, ok)),
  define('browser_observe', 'automation.observe', 'Ambil snapshot semantik elemen interaktif bernomor [1], [2] untuk diklik/diisi. Elemen kembar diberi konteks "(dekat: ...)". format: "text" (default, hemat token), "json" (array elements), "both". Untuk MEMBACA isi halaman gunakan browser_read_text.', {
    ...taskInput, maxLength: z.number().int().min(100).max(100000).optional(), format: z.enum(['text', 'json', 'both']).optional(),
  }, observeResult),
  define('browser_set_media_mode', 'browser.setMediaMode', 'Mode hemat: "lite" memuat halaman TANPA gambar, video, dan audio (font dan teks tetap dimuat), tetapi JavaScript tetap jalan sehingga komentar TikTok/YouTube, thread, dan hasil pencarian tetap muncul (lebih cepat dan hemat kuota). "full" mengembalikan media. Berlaku untuk semua tab/profil dan diingat; tab aktif dimuat ulang (reload: false untuk tidak). Untuk mencari informasi di situs berat-JavaScript: set lite, browser_navigate, lalu browser_read_text { source: "live" }.', {
    ...taskInput, mode: z.enum(['full', 'lite']), reload: z.boolean().optional(),
  }, z.object({ mode: z.enum(['full', 'lite']), blockedRequests: z.number().int(), reloaded: z.boolean() }).strict()),
  define('browser_read_text', 'automation.readText', 'Baca halaman sebagai markdown ringkas ala lynx: judul, paragraf, daftar, tabel, dan tautan bernomor [teks][n] dengan daftar URL di akhir. Paling hemat token untuk mencari informasi. source "fetch" mengunduh HTML dengan cookie profil TANPA menjalankan JavaScript (aman untuk halaman berat/hang); "live" membaca DOM tab saat ini (untuk SPA); "auto" (default) = live untuk tab aktif bila url kosong, fetch bila url diisi, dan otomatis fallback ke fetch bila halaman tidak merespons. url opsional; tidak mengubah tab.', {
    ...taskInput,
    url: short.optional(),
    source: z.enum(['auto', 'fetch', 'live']).optional(),
    maxLength: z.number().int().min(200).max(200000).optional(),
    mainOnly: z.boolean().optional(),
    includeLinks: z.boolean().optional(),
  }, z.object({
    url: z.string(), title: z.string(), status: z.number().int().optional(), source: z.enum(['fetch', 'live']),
    markdown: z.string(), links: z.number().int(), truncated: z.boolean(), hint: z.string().optional(), challenge: z.string().optional(),
  }).strict()),
  define('browser_click', 'automation.click', 'Klik berdasarkan elementId, selector, atau teks. Berikan tepat satu target.', {
    ...taskInput, elementId: z.number().int().min(1).optional(), selector: short.optional(), text: short.optional(), expect: expectCondition.optional(),
  }, actionResult),
  define('browser_type', 'automation.type', 'Ketik pada input berdasarkan elementId atau selector. Isi ketikan tidak dicatat dalam log.', {
    ...taskInput, elementId: z.number().int().min(1).optional(), selector: short.optional(), text: z.string().max(20000), clear: z.boolean().optional(), pressEnter: z.boolean().optional(), expect: expectCondition.optional(),
  }, actionResult),
  define('browser_select_option', 'automation.selectOption', 'Pilih opsi dropdown select berdasarkan value, text, atau index.', {
    ...taskInput, elementId: z.number().int().min(1).optional(), selector: short.optional(), value: z.string().max(500).optional(), text: z.string().max(500).optional(), index: z.number().int().min(0).max(10000).optional(), expect: expectCondition.optional(),
  }, actionResult),
  define('browser_check', 'automation.check', 'Centang atau hapus centang pada checkbox atau radio button.', {
    ...taskInput, elementId: z.number().int().min(1).optional(), selector: short.optional(), checked: z.boolean().default(true), expect: expectCondition.optional(),
  }, actionResult),
  define('browser_hover', 'automation.hover', 'Arahkan kursor mouse ke elemen untuk memicu hover state.', {
    ...taskInput, elementId: z.number().int().min(1).optional(), selector: short.optional(), text: short.optional(),
  }, ok),
  define('browser_inspect_form', 'automation.inspectForm', 'Inspeksi form dan ekstrak daftar fields, tipe input, opsi select, dan tombol submit.', {
    ...taskInput, formSelector: short.optional(), formElementId: z.number().int().min(1).optional(),
  }, inspectFormResult),
  define('browser_fill_form', 'automation.fillForm', 'Isi multi-field form (input, textarea, select, checkbox, radio) secara simultan dengan resolusi cerdas.', {
    ...taskInput, formSelector: short.optional(), formElementId: z.number().int().min(1).optional(),
    fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    submit: z.boolean().optional(), validate: z.boolean().optional(),
  }, fillFormResult),
  define('browser_find_element', 'automation.findElement', 'Cari elemen interaktif berdasarkan deskripsi semantik/intensi dan dapatkan elementId serta bounding box.', {
    ...taskInput, query: short, role: z.string().max(50).optional(), tag: z.string().max(50).optional(), maxResults: z.number().int().min(1).max(20).optional(),
  }, findElementResult),
  define('browser_get_state', 'automation.getState', 'Ambil ringkasan status terpadu browser (tab aktif, fokus keyboard, status jaringan, log konsol).', taskInput, getStateResult),
  define('browser_press_key', 'automation.pressKey', 'Tekan tombol navigasi keyboard.', { ...taskInput, key: z.enum(['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'Space']) }, ok),
  define('browser_get_dom', 'automation.getDOM', 'Baca halaman tersaring; nilai formulir, elemen tersembunyi dan script tidak dikirim.', {
    ...taskInput, format: z.enum(['outline', 'text', 'html']).optional(), maxLength: z.number().int().min(1).max(100000).optional(),
  }, z.string().max(100000)),
  define('browser_extract', 'automation.extract', 'Ekstrak elemen berulang sebagai JSON tersaring.', {
    ...taskInput, selector: short, maxItems: z.number().int().min(1).max(200).optional(),
  }, z.array(z.object({ tag: z.string(), text: z.string().max(1000), attributes: z.record(z.string(), z.string()) }).strict()).max(200)),
  define('browser_screenshot', 'automation.screenshot', 'Tangkapan layar tab milik task. Mendukung crop berdasarkan elementId, selector, atau region.', {
    ...taskInput,
    elementId: z.number().int().min(1).optional(),
    selector: short.optional(),
    region: z.object({
      x: z.number().int().min(0),
      y: z.number().int().min(0),
      width: z.number().int().min(1).max(10000),
      height: z.number().int().min(1).max(10000),
    }).strict().optional(),
  }, z.string()),
  define('browser_get_console_logs', 'automation.getConsoleLogs', 'Ambil log konsol browser (log, warn, error) dari tab task untuk mendiagnosis kegagalan halaman.', {
    ...taskInput, level: z.enum(['info', 'warn', 'error', 'debug', 'all']).optional(), limit: z.number().int().min(1).max(200).optional(), clear: z.boolean().optional(),
  }, consoleLogsResult),
  define('browser_get_network_activity', 'automation.getNetworkActivity', 'Ambil ringkasan aktivitas jaringan (inflight requests, request gagal 4xx/5xx, dan request terbaru) dari tab task.', {
    ...taskInput, filter: z.string().max(200).optional(), onlyFailed: z.boolean().optional(), limit: z.number().int().min(1).max(200).optional(),
  }, networkActivityResult),
  define('browser_wait', 'automation.waitFor', 'Tunggu durasi, selector, teks, network idle, atau fungsi evaluasi; tepat satu kondisi utama.', {
    ...taskInput, ms: z.number().int().min(1).max(60000).optional(), selector: short.optional(), text: short.optional(),
    state: z.enum(['visible', 'hidden', 'attached', 'detached']).optional(),
    networkIdle: z.boolean().optional(),
    expression: z.string().min(1).max(2000).optional(),
    timeoutMs: z.number().int().min(500).max(60000).optional(),
  }, z.boolean()),
  define('browser_scroll', 'automation.scroll', 'Gulir halaman task.', {
    ...taskInput, direction: z.enum(['up', 'down', 'top', 'bottom']).optional(), amount: z.number().int().min(1).max(10000).optional(),
  }, ok),
  define('browser_evaluate', 'automation.evaluate', 'Jalankan ekspresi JavaScript aman pada halaman aktif tab task.', {
    ...taskInput, script: z.string().min(1).max(20000),
  }, z.unknown()),
  define('browser_set_visibility', 'browser.setVisibility', 'Tampilkan atau sembunyikan jendela browser (mode headless/background).', {
    ...taskInput, visible: z.boolean(),
  }, ok),
  define('browser_heal_selector', 'automation.healSelector', 'Analisis dan perbaiki CSS selector yang rusak menggunakan kesamaan semantik dan teks.', {
    ...taskInput, selector: short, previousTag: z.string().max(30).optional(), contextSnippet: z.string().max(200).optional(),
  }, healSelectorResult),
  define('browser_detect_challenge', 'automation.detectChallenge', 'Deteksi apakah halaman terhadang tantangan keamanan bot (TikTok SecSDK/CAPTCHA, Cloudflare Turnstile, reCAPTCHA, hCaptcha, Arkose, Geetest, DataDome). Opsi autoIntervene otomatis membuat tiket intervensi manusia jika terdeteksi.', { ...taskInput, autoIntervene: z.boolean().optional() }, detectChallengeResult),

  define('browser_upload_file', 'automation.uploadFile', 'Unggah file lokal ke elemen input[type=file] menggunakan protokol native CDP.', {
    ...taskInput, elementId: z.number().int().min(1).optional(), selector: short.optional(), filePaths: z.array(z.string().min(1)).min(1),
  }, uploadFileResult),
  define('browser_wait_for_download', 'automation.waitForDownload', 'Tunggu hingga unduhan file selesai pada sesi browser dan dapatkan path lokalnya.', {
    ...taskInput, timeoutMs: z.number().int().min(1000).max(120000).optional(), fileNamePattern: z.string().max(200).optional(),
  }, waitForDownloadResult),
  define('browser_create_checkpoint', 'automation.createCheckpoint', 'Simpan snapshot kondisi isian formulir dan URL halaman aktif untuk rollback.', {
    ...taskInput, name: z.string().max(100).optional(),
  }, createCheckpointResult),
  define('browser_rollback_checkpoint', 'automation.rollbackCheckpoint', 'Kembalikan kondisi isian formulir dari checkpoint yang telah disimpan.', {
    ...taskInput, name: z.string().max(100),
  }, rollbackCheckpointResult),
  define('browser_act', 'automation.act', 'Eksekusi aksi tingkat tinggi (klik, ketik, pilih, centang) dengan auto-healing dan verifikasi hasil dalam 1 siklus. target: elementId (mis. "12"), selector CSS, atau deskripsi ("tombol Tambah untuk Teh Tubruk"; teks sekitar elemen ikut dinilai). Bila beberapa elemen sama cocok, aksi TIDAK dijalankan dan error ELEMENT_AMBIGUOUS mencantumkan kandidat; ulangi dengan elementId.', {
    ...taskInput,
    intent: z.enum(['click', 'type', 'select', 'check', 'submit', 'hover']),
    target: short,
    text: z.string().max(20000).optional(),
    value: z.string().max(1000).optional(),
    checked: z.boolean().optional(),
    expect: expectCondition.optional(),
    autoHeal: z.boolean().optional(),
    autoChallengeIntervention: z.boolean().optional(),
  }, actResult),
  define('browser_get_cookies', 'cookies.get', 'Ambil cookies dari sesi tab aktif (termasuk HttpOnly/session cookies untuk analisis autentikasi).', {
    ...taskInput, url: short.optional(), name: z.string().max(200).optional(), domain: z.string().max(200).optional(),
  }, getCookiesResult),
  define('browser_set_cookie', 'cookies.set', 'Setel atau suntikkan cookie ke sesi browser aktif (misal sessionid TikTok/auth token).', {
    ...taskInput, url: short.optional(), name: z.string().min(1).max(200), value: z.string().max(10000), domain: z.string().max(200).optional(), path: z.string().max(500).optional(), secure: z.boolean().optional(), httpOnly: z.boolean().optional(), sameSite: z.enum(['unspecified', 'no_restriction', 'lax', 'strict']).optional(), expirationDate: z.number().optional(),
  }, setCookieResult),
  define('browser_get_storage', 'storage.get', 'Baca nilai dari localStorage atau sessionStorage pada tab aktif.', {
    ...taskInput, type: z.enum(['local', 'session']).default('local'), key: z.string().max(200).optional(),
  }, getStorageResult),
  define('browser_set_storage', 'storage.set', 'Ubah, hapus, atau bersihkan entri localStorage atau sessionStorage pada tab aktif.', {
    ...taskInput, type: z.enum(['local', 'session']).default('local'), action: z.enum(['set', 'remove', 'clear']).default('set'), key: z.string().max(200).optional(), value: z.string().max(50000).optional(),
  }, setStorageResult),
  define('browser_drag_and_drop', 'automation.dragAndDrop', 'Simulasikan gesture drag and drop mouse (misal menggeser slider puzzle CAPTCHA) dari target awal ke tujuan.', {
    ...taskInput,
    from: z.object({ elementId: z.number().int().min(1).optional(), selector: short.optional(), x: z.number().optional(), y: z.number().optional() }).strict(),
    to: z.object({ elementId: z.number().int().min(1).optional(), selector: short.optional(), x: z.number().optional(), y: z.number().optional() }).strict(),
    steps: z.number().int().min(1).max(100).optional(),
  }, dragAndDropResult),
];
export function contractFor(method: string): ToolContract | undefined { return toolContracts.find(tool => tool.method === method); }
