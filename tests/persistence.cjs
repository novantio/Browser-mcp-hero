const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { mkdtempSync, mkdirSync } = require('node:fs');
const path = require('node:path');

// All storage below is synthetic test data served by our own localhost fixture.
const fixture = `<!doctype html><html><head><title>Fixture profil</title></head><body>
<h1>Fixture profil</h1><button id="save">Simpan data uji</button><p id="result"></p>
<script>
const readDb = () => new Promise((resolve, reject) => {
  const req = indexedDB.open('hero-fixture', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('notes');
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db = req.result;
    const get = db.transaction('notes').objectStore('notes').get('marker');
    get.onsuccess = () => { resolve(get.result || 'empty'); db.close(); };
    get.onerror = () => { reject(get.error); db.close(); };
  };
});
async function render() {
  const stored = await readDb();
  const cookie = document.cookie.includes('hero_fixture=persistent');
  const local = localStorage.getItem('hero-fixture') === 'persistent';
  document.getElementById('result').dataset.cookie = String(cookie);
  document.getElementById('result').dataset.local = String(local);
  document.getElementById('result').dataset.database = stored;
  document.getElementById('result').textContent = cookie && local && stored === 'persistent' ? 'Data uji tersimpan' : 'Profil bersih';
}
document.getElementById('save').onclick = async () => {
  document.cookie = 'hero_fixture=persistent; Max-Age=86400; SameSite=Lax; Path=/';
  localStorage.setItem('hero-fixture', 'persistent');
  const req = indexedDB.open('hero-fixture', 1);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('notes', 'readwrite');
    tx.objectStore('notes').put('persistent', 'marker');
    tx.oncomplete = () => { db.close(); render(); };
  };
};
render();
</script></body></html>`;

(async () => {
  mkdirSync('test-results', { recursive: true });
  const dir = mkdtempSync(path.resolve('test-results/persistent-'));
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  let window;
  const errors = [];
  async function launch() {
    app = await electron.launch({ args: ['.', '--user-data-dir=' + dir], env });
    app.context().setDefaultTimeout(10000);
    window = await app.firstWindow();
    window.on('pageerror', error => errors.push(error.message));
    await window.getByRole('heading', { name: /Ke mana kita/ }).waitFor();
    const state = await window.evaluate(() => window.browser.getState());
    assert.equal(state.persistent, true);
    assert.equal(typeof state.profiles[0].id, 'string');
  }
  async function navigate() {
    const address = window.getByRole('textbox', { name: 'Alamat atau pencarian' });
    const target = url + '/?profile=' + await window.getByRole('combobox', { name: 'Profil aktif' }).inputValue();
    await address.fill(target);
    await address.press('Enter');
    await window.getByRole('tab', { name: 'Fixture profil', exact: true }).waitFor();
    return app.context().pages().find(p => p.url() === target);
  }
  async function select(id) {
    await window.getByRole('combobox', { name: 'Profil aktif' }).selectOption(id);
    await window.waitForFunction(id => document.getElementById('profile-select').value === id && document.getElementById('profile-select').disabled === false, id);
    await window.waitForFunction(id => window.browser.getState().then(s => s.activeProfileId === id), id);
  }
  async function quitNormally() {
    const exited = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
    await exited;
    app = null;
  }
  try {
    await launch();
    const { spawn } = require('node:child_process');
    await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), ['.', '--user-data-dir=' + dir], { env, windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Second instance did not exit')); }, 8000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Second instance failed: ' + code)); });
    });
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    console.log('PASS second launch focuses the existing persistent browser');

    await select('instagram');
    let guest = await navigate();
    await guest.getByText('Profil bersih', { exact: true }).waitFor();
    await guest.getByRole('button', { name: 'Simpan data uji' }).click();
    await guest.getByText('Data uji tersimpan', { exact: true }).waitFor();

    const instagramTab = (await window.evaluate(() => window.browser.getState())).activeTabId;
    await select('youtube');
    const crossProfile = await window.evaluate(tabId => window.browser.command({ action: 'close-tab', tabId }), instagramTab);
    assert.equal(crossProfile.ok, false);
    let other = await navigate();
    await other.getByText('Profil bersih', { exact: true }).waitFor();
    await select('instagram');
    await guest.getByText('Data uji tersimpan', { exact: true }).waitFor();
    console.log('PASS live profile switching isolates cookie, localStorage and IndexedDB');

    await quitNormally();
    await launch();
    assert.equal(await window.getByRole('combobox', { name: 'Profil aktif' }).inputValue(), 'instagram');
    guest = await navigate();
    await guest.getByText('Data uji tersimpan', { exact: true }).waitFor();
    await select('youtube');
    other = await navigate();
    await other.getByText('Profil bersih', { exact: true }).waitFor();
    console.log('PASS real restart preserves persistent site data and profile selection');

    await window.getByRole('textbox', { name: 'Nama profil baru' }).fill('Akun kedua');
    await window.getByRole('button', { name: 'Buat profil', exact: true }).click();
    await window.getByRole('heading', { name: /Ke mana kita/ }).waitFor();
    const profileId = await window.getByRole('combobox', { name: 'Profil aktif' }).inputValue();
    assert.notEqual(profileId, 'youtube');
    const temporary = await navigate();
    await temporary.getByRole('button', { name: 'Simpan data uji' }).click();
    await temporary.getByText('Data uji tersimpan', { exact: true }).waitFor();
    console.log('PASS UI creates an independent profile');

    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
    await window.getByRole('button', { name: 'Hapus profil', exact: true }).click();
    await window.waitForFunction(() => document.getElementById('profile-select').disabled === false);
    assert.equal(await window.getByRole('combobox', { name: 'Profil aktif' }).inputValue(), profileId);
    await temporary.getByText('Data uji tersimpan', { exact: true }).waitFor();
    console.log('PASS cancelling profile deletion preserves the live session');

    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await window.getByRole('button', { name: 'Hapus profil', exact: true }).click();
    await window.waitForFunction(() => document.getElementById('profile-select').value === 'default' && !document.getElementById('profile-select').disabled);
    const removed = await app.evaluate(async ({ session }, id) => {
      const ses = session.fromPartition('persist:hero-' + id);
      // Return only test-derived booleans, never cookie values.
      const cookies = await ses.cookies.get({});
      return { noCookies: cookies.length === 0 };
    }, profileId);
    assert.equal(removed.noCookies, true);
    assert.equal(await window.getByRole('combobox', { name: 'Profil aktif' }).locator('option', { hasText: 'Akun kedua' }).count(), 0);
    assert.equal(await app.evaluate(({ webContents, session }, id) => webContents.getAllWebContents().filter(w => w.session === session.fromPartition('persist:hero-' + id)).length, profileId), 0);

    const clearedStorage = await app.evaluate(async ({ WebContentsView, session }, { id, url }) => {
      const probe = new WebContentsView({ webPreferences: { session: session.fromPartition('persist:hero-' + id), sandbox: true, contextIsolation: true, nodeIntegration: false } });
      try {
        await probe.webContents.loadURL(url);
        return await probe.webContents.executeJavaScript(`new Promise(resolve => {
          const check = () => {
            const result = document.getElementById('result');
            if (result?.dataset.database) resolve({ cookie: result.dataset.cookie, local: result.dataset.local, database: result.dataset.database });
            else setTimeout(check, 10);
          };
          check();
        })`);
      } finally { probe.webContents.close(); }
    }, { id: profileId, url });
    assert.deepEqual(clearedStorage, { cookie: 'false', local: 'false', database: 'empty' });
    await select('instagram');
    const kept = await navigate();
    await kept.getByText('Data uji tersimpan', { exact: true }).waitFor();
    console.log('PASS confirmed deletion clears only the selected profile');

    await window.getByRole('button', { name: 'Simpan sekarang', exact: true }).click();
    await window.getByText('Tersimpan di perangkat', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await select('default');
    await window.screenshot({ path: 'test-results/profiles.png' });
    await quitNormally();
    await launch();
    assert.equal(await window.getByRole('combobox', { name: 'Profil aktif' }).locator('option', { hasText: 'Akun kedua' }).count(), 0);
    console.log('PASS deleted profile remains deleted after restart; zero renderer errors');
  } finally {
    if (app) await app.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
