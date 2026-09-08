import { z } from 'zod';

const id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const short = z.string().min(1).max(2000);
const taskInput = { taskId: id };
const task = z.object({
  id, profileId: id, status: z.enum(['RUNNING', 'PAUSED', 'WAITING_FOR_HUMAN', 'RESUMING', 'COMPLETED', 'FAILED', 'CANCELLED']),
  createdAt: z.number(), updatedAt: z.number(), error: z.string().optional(),
  intervention: z.object({ reason: z.string(), message: z.string(), requestedAt: z.number() }).strict().optional(),
}).strict();
const profile = z.object({
  id, name: z.string(), createdAt: z.number(), sharedWith: id.optional(), lockOwner: id.nullable(),
  sessionProfileId: id, sharedProfiles: z.array(id), isActive: z.boolean(), isLocked: z.boolean(),
}).strict();
const tab = z.object({
  id, title: z.string(), url: z.string(), loading: z.boolean(), canGoBack: z.boolean(), canGoForward: z.boolean(), error: z.string().nullable(),
}).strict();
const ok = z.object({ ok: z.literal(true) }).strict();
const selected = z.object({ activeProfileId: id }).strict();
export interface ToolContract {
  name: string; method: string; description: string;
  input: z.ZodObject; output: z.ZodType;
}
const define = (name: string, method: string, description: string, shape: Record<string, z.ZodType>, output: z.ZodType): ToolContract =>
  ({ name, method, description, input: z.object(shape).strict(), output });

export const toolContracts: ToolContract[] = [
  define('browser_list_profiles', 'profiles.list', 'Daftar profil persisten dan pemilik sesi.', {}, z.array(profile)),
  define('browser_create_profile', 'profiles.create', 'Buat profil baru tanpa menghapus profil atau login lama.', { name: z.string().trim().min(1).max(40) }, selected),
  define('browser_switch_profile', 'profiles.switch', 'Aktifkan profil milik task. Mulai task terlebih dahulu.', { ...taskInput, profileId: id }, selected),
  define('browser_start_task', 'tasks.create', 'Mulai task dan kunci sesi profil. Gunakan ID hasilnya pada setiap perintah browser.', { profileId: id.optional(), taskId: id.optional() }, task),
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
  define('browser_navigate', 'tabs.navigate', 'Navigasi tab aktif milik task.', { ...taskInput, url: short }, z.object({ url: z.string() }).strict()),
  ...['reload', 'back', 'forward'].map(action => define('browser_' + action, 'tabs.' + action, 'Navigasi tab aktif milik task: ' + action, taskInput, ok)),
  define('browser_click', 'automation.click', 'Klik berdasarkan selector atau teks. Berikan tepat satu target.', {
    ...taskInput, selector: short.optional(), text: short.optional(),
  }, ok),
  define('browser_type', 'automation.type', 'Ketik pada input. Isi ketikan tidak dicatat dalam log.', {
    ...taskInput, selector: short, text: z.string().max(20000), clear: z.boolean().optional(), pressEnter: z.boolean().optional(),
  }, ok),
  define('browser_press_key', 'automation.pressKey', 'Tekan tombol navigasi keyboard.', { ...taskInput, key: z.enum(['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'Space']) }, ok),
  define('browser_get_dom', 'automation.getDOM', 'Baca halaman tersaring; nilai formulir, elemen tersembunyi dan script tidak dikirim.', {
    ...taskInput, format: z.enum(['outline', 'text', 'html']).optional(), maxLength: z.number().int().min(1).max(100000).optional(),
  }, z.string().max(100000)),
  define('browser_extract', 'automation.extract', 'Ekstrak elemen berulang sebagai JSON tersaring.', {
    ...taskInput, selector: short, maxItems: z.number().int().min(1).max(200).optional(),
  }, z.array(z.object({ tag: z.string(), text: z.string().max(1000), attributes: z.record(z.string(), z.string()) }).strict()).max(200)),
  define('browser_screenshot', 'automation.screenshot', 'Tangkapan layar tab milik task. Konten yang terlihat pada layar ikut tertangkap.', taskInput, z.string()),
  define('browser_wait', 'automation.waitFor', 'Tunggu durasi, selector, atau teks; tepat satu kondisi.', {
    ...taskInput, ms: z.number().int().min(1).max(60000).optional(), selector: short.optional(), text: short.optional(),
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
];
export function contractFor(method: string): ToolContract | undefined { return toolContracts.find(tool => tool.method === method); }
