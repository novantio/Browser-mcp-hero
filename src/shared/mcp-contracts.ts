import { z } from 'zod';

const id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const short = z.string().min(1).max(2000);
const taskInput = { taskId: id };
const task = z.object({
  id, profileId: id, status: z.enum(['RUNNING', 'PAUSED', 'WAITING_FOR_HUMAN', 'RESUMING', 'COMPLETED', 'FAILED', 'CANCELLED']),
  createdAt: z.number(), updatedAt: z.number(), ttlMs: z.number().optional(), retentionMs: z.number().optional(),
  pausedReason: z.enum(['manual', 'inactivity', 'preempted']).optional(), error: z.string().optional(),
  intervention: z.object({ reason: z.string(), message: z.string(), requestedAt: z.number() }).strict().optional(),
}).strict();
const socialAccount = z.object({
  platform: z.string(),
  name: z.string(),
  loggedIn: z.boolean(),
  username: z.string().optional(),
}).strict();

const profile = z.object({
  id, name: z.string(), createdAt: z.number(), sharedWith: id.optional(), lockOwner: id.nullable(),
  sessionProfileId: id, sharedProfiles: z.array(id), isActive: z.boolean(), isLocked: z.boolean(),
  loggedInServices: z.array(z.string()).optional(),
  socialAccounts: z.array(socialAccount).optional(),
}).strict();

const tab = z.object({
  id, title: z.string(), url: z.string(), loading: z.boolean(), canGoBack: z.boolean(), canGoForward: z.boolean(), error: z.string().nullable(),
  certificateWarning: z.object({ requestId: id, host: z.string(), url: z.string() }).strict().nullable().optional(),
}).strict();
const ok = z.object({ ok: z.literal(true) }).strict();
const expectCondition = z.object({
  selector: short.optional(),
  text: short.optional(),
  url: short.optional(),
  timeoutMs: z.number().int().min(100).max(30000).optional(),
}).strict();
const actionResult = z.object({
  ok: z.literal(true),
  status: z.enum(['verified', 'unverified', 'not_executed']).optional(),
  detail: z.string().optional(),
  healed: z.boolean().optional(),
}).strict();
const observedElement = z.object({
  id: z.number().int().min(1),
  tag: z.string(),
  role: z.string(),
  name: z.string(),
  type: z.string().optional(),
  value: z.string().optional(),
  checked: z.boolean().optional(),
  disabled: z.boolean().optional(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  selected: z.string().optional(),
  href: z.string().optional(),
  context: z.string().optional(),
}).strict();
const observeResult = z.object({
  url: z.string(),
  title: z.string(),
  loading: z.boolean(),
  elements: z.array(observedElement).optional(),
  text: z.string(),
}).strict();
const consoleEntry = z.object({
  level: z.enum(['info', 'warn', 'error', 'debug']),
  message: z.string(),
  source: z.string().optional(),
  line: z.number().int().optional(),
  timestamp: z.number(),
  tabId: z.string().optional(),
}).strict();
const consoleLogsResult = z.object({
  entries: z.array(consoleEntry),
  summary: z.object({
    total: z.number().int(),
    errorCount: z.number().int(),
    warnCount: z.number().int(),
    infoCount: z.number().int(),
  }).strict(),
}).strict();
const networkActivityEntry = z.object({
  id: z.string(),
  url: z.string(),
  method: z.string(),
  status: z.number().int().optional(),
  mimeType: z.string().optional(),
  durationMs: z.number(),
}).strict();
const networkActivityResult = z.object({
  inflightCount: z.number().int(),
  inflightRequests: z.array(z.object({
    id: z.string(),
    url: z.string(),
    method: z.string(),
    durationMs: z.number(),
  }).strict()),
  failedRequests: z.array(networkActivityEntry),
  recentRequests: z.array(networkActivityEntry),
  summary: z.object({
    totalRecorded: z.number().int(),
    inflightCount: z.number().int(),
    failedCount: z.number().int(),
  }).strict(),
}).strict();
const formField = z.object({
  name: z.string(),
  id: z.string(),
  elementId: z.number().int().min(1),
  tag: z.enum(['input', 'select', 'textarea']),
  type: z.string().optional(),
  label: z.string(),
  value: z.string().optional(),
  placeholder: z.string().optional(),
  required: z.boolean(),
  disabled: z.boolean(),
  readOnly: z.boolean(),
  checked: z.boolean().optional(),
  options: z.array(z.object({
    value: z.string(),
    text: z.string(),
    selected: z.boolean(),
  }).strict()).optional(),
}).strict();

const formSubmitButton = z.object({
  elementId: z.number().int().min(1).optional(),
  text: z.string().optional(),
  tag: z.string(),
  selector: z.string().optional(),
}).strict();

const inspectFormResult = z.object({
  forms: z.array(z.object({
    id: z.string(),
    name: z.string().optional(),
    action: z.string().optional(),
    method: z.string().optional(),
    elementId: z.number().int().min(1).optional(),
    fields: z.array(formField),
    submitButton: formSubmitButton.optional(),
  }).strict()),
}).strict();

const fillFormResult = z.object({
  ok: z.boolean(),
  filled: z.array(z.object({
    field: z.string(),
    elementId: z.number().int().min(1).optional(),
    matchedBy: z.string(),
    type: z.string(),
  }).strict()),
  skipped: z.array(z.object({
    field: z.string(),
    reason: z.string(),
  }).strict()),
  submitted: z.boolean(),
  valid: z.boolean(),
  summary: z.string(),
}).strict();

const foundElement = z.object({
  elementId: z.number().int().min(1),
  score: z.number(),
  name: z.string(),
  role: z.string(),
  tag: z.string(),
  selector: z.string().optional(),
  boundingBox: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }).strict(),
  attributes: z.record(z.string(), z.string()),
  context: z.string().optional(),
}).strict();

const findElementResult = z.object({
  query: z.string(),
  elements: z.array(foundElement),
}).strict();

const getStateResult = z.object({
  activeTab: tab.nullable(),
  tabs: z.array(tab),
  activeProfile: z.object({
    id: z.string(),
    name: z.string(),
    isLocked: z.boolean(),
  }).strict(),
  taskStatus: z.string(),
  focusedElement: z.object({
    elementId: z.number().int().min(1).optional(),
    tag: z.string(),
    role: z.string().optional(),
    name: z.string().optional(),
    id: z.string().optional(),
  }).strict().nullable(),
  network: z.object({
    inflightCount: z.number().int(),
  }).strict(),
  console: z.object({
    errorCount: z.number().int(),
    warnCount: z.number().int(),
  }).strict(),
}).strict();

const healSelectorResult = z.object({
  targetSelector: z.string(),
  resolvedSelector: z.string(),
  confidence: z.number(),
  strategyUsed: z.string(),
  candidates: z.array(z.object({
    selector: z.string(),
    confidence: z.number(),
    tag: z.string(),
    sampleText: z.string(),
  }).strict()),
}).strict();

const detectChallengeResult = z.object({
  detected: z.boolean(),
  provider: z.string().optional(),
  details: z.string().optional(),
  status: z.string().optional(),
  taskId: id.optional(),
  resumeToken: id.optional(),
}).strict();

const uploadFileResult = z.object({
  ok: z.literal(true),
  fileCount: z.number().int(),
  files: z.array(z.string()),
}).strict();

const waitForDownloadResult = z.object({
  ok: z.literal(true),
  fileName: z.string(),
  filePath: z.string(),
  sizeBytes: z.number(),
  mimeType: z.string(),
}).strict();

const createCheckpointResult = z.object({
  ok: z.literal(true),
  name: z.string(),
  url: z.string(),
  fieldsCount: z.number().int(),
  timestamp: z.number(),
}).strict();

const rollbackCheckpointResult = z.object({
  ok: z.literal(true),
  name: z.string(),
  url: z.string(),
  restoredCount: z.number().int(),
}).strict();

const actResult = z.object({
  ok: z.boolean(),
  intent: z.string(),
  targetResolved: z.object({
    elementId: z.number().int().min(1).optional(),
    name: z.string(),
    role: z.string(),
    selector: z.string().optional(),
  }).strict().optional(),
  healed: z.boolean().optional(),
  verified: z.boolean().optional(),
  challengeDetected: z.boolean().optional(),
  message: z.string(),
  status: z.string().optional(),
  resumeToken: id.optional(),
}).strict();

const profileLoginSummary = z.object({
  profileId: id,
  profileName: z.string(),
  isActive: z.boolean(),
  loggedInServices: z.array(z.string()),
  socialAccounts: z.array(socialAccount),
}).strict();

const getProfileLoginsResult = z.object({
  profiles: z.array(profileLoginSummary),
  recommendations: z.record(z.string(), id),
}).strict();


const cookieEntry = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string().optional(),
  path: z.string().optional(),
  secure: z.boolean().optional(),
  httpOnly: z.boolean().optional(),
  sameSite: z.string().optional(),
  expirationDate: z.number().optional(),
}).strict();

const getCookiesResult = z.object({
  cookies: z.array(cookieEntry),
  count: z.number().int(),
}).strict();

const setCookieResult = z.object({
  ok: z.literal(true),
  name: z.string(),
  domain: z.string().optional(),
}).strict();

const getStorageResult = z.object({
  type: z.enum(['local', 'session']),
  entries: z.record(z.string(), z.string()),
  count: z.number().int(),
}).strict();

const setStorageResult = z.object({
  ok: z.literal(true),
  action: z.enum(['set', 'remove', 'clear']),
  type: z.enum(['local', 'session']),
}).strict();

const dragAndDropResult = z.object({
  ok: z.literal(true),
  from: z.object({ x: z.number(), y: z.number() }).strict(),
  to: z.object({ x: z.number(), y: z.number() }).strict(),
}).strict();

const selected = z.object({ activeProfileId: id }).strict();
export interface ToolContract {
  name: string; method: string; description: string;
  input: z.ZodObject; output: z.ZodType;
}
const define = (name: string, method: string, description: string, shape: Record<string, z.ZodType>, output: z.ZodType): ToolContract =>
  ({ name, method, description, input: z.object(shape).strict(), output });

const engineState = z.object({
  status:z.enum(['idle','checking','downloading','verifying','ready','up_to_date','error','unsupported']),
  enabled:z.boolean(),currentElectron:z.string(),currentChromium:z.string(),latestElectron:z.string().nullable(),readyElectron:z.string().nullable(),
  progress:z.number().nullable(),lastCheckedAt:z.number().nullable(),message:z.string(),
}).strict();
export const toolContracts: ToolContract[] = [
  define('browser_get_engine_status', 'engine.status', 'Versi Electron/Chromium dan status pembaruan engine.', {}, engineState),
  define('browser_check_engine_update', 'engine.check', 'Periksa dan siapkan rilis stabil resmi di latar belakang, tanpa menutup sesi aktif.', {}, engineState),
  define('browser_list_profiles', 'profiles.list', 'Daftar profil persisten dan status login sosial media (TikTok, YouTube, Instagram, X, Facebook, dll.). PENTING: Periksa field "loggedInServices" sebelum memulai tugas browser untuk memilih profileId yang sudah login.', {}, z.array(profile)),
  define('browser_get_profile_logins', 'profiles.getLogins', 'Daftar semua akun sosial media yang sedang login (TikTok, YouTube, Instagram, X/Twitter, Facebook, GitHub, dll.) di setiap profil browser beserta rekomendasi profileId yang harus digunakan.', { profileId: id.optional() }, getProfileLoginsResult),
  define('browser_create_profile', 'profiles.create', 'Buat profil baru tanpa menghapus profil atau login lama.', { name: z.string().trim().min(1).max(40) }, selected),
  define('browser_switch_profile', 'profiles.switch', 'Aktifkan profil milik task. Mulai task terlebih dahulu.', { ...taskInput, profileId: id }, selected),
  define('browser_unlock_profile', 'profiles.unlock', 'Buka paksa kunci profil yang menggantung (stale lock) jika task klien sebelumnya terputus atau crash.', { profileId: id }, z.object({ ok: z.literal(true), profileId: id }).strict()),
  define('browser_start_task', 'tasks.create', 'Mulai task dan kunci sesi profil. Gunakan ID hasilnya pada setiap perintah browser. PENTING: Jika ingin membuka platform tertentu (misal TikTok), periksa browser_list_profiles lalu gunakan profileId yang memiliki sesi login platform tersebut. Mendukung batas inaktivitas (ttlSeconds, default 600 detik; task yang dijeda karena inaktivitas otomatis lanjut pada perintah berikutnya), retensi sesi (retentionSeconds, default 1800 detik / 30 menit), deskripsi task opsional, dan opsi force unlock.', {
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
  define('browser_read_text', 'automation.readText', 'Baca halaman sebagai markdown ringkas ala lynx: judul, paragraf, daftar, tabel, dan tautan bernomor [teks][n] dengan daftar URL di akhir. Paling hemat token untuk mencari informasi. source "fetch" mengunduh HTML dengan cookie profil TANPA menjalankan JavaScript (aman untuk halaman berat/hang); "live" membaca DOM tab saat ini (untuk SPA); "auto" (default) = live untuk tab aktif bila url kosong, fetch bila url diisi, dan otomatis fallback ke fetch bila halaman tidak merespons. url opsional; tidak mengubah tab.', {
    ...taskInput,
    url: short.optional(),
    source: z.enum(['auto', 'fetch', 'live']).optional(),
    maxLength: z.number().int().min(200).max(200000).optional(),
    mainOnly: z.boolean().optional(),
    includeLinks: z.boolean().optional(),
  }, z.object({
    url: z.string(), title: z.string(), status: z.number().int().optional(), source: z.enum(['fetch', 'live']),
    markdown: z.string(), links: z.number().int(), truncated: z.boolean(),
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
