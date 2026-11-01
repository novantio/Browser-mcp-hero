const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { mkdtempSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const fixture = `<!doctype html><html><head><title>Share fixture</title></head><body>
<h1>Share fixture</h1><button id="a">Login A</button><button id="b">Login B</button><button id="out">Logout</button><p id="state"></p>
<script>
function render() {
  const cookie = document.cookie.split('; ').find(item => item.startsWith('hero_share='))?.split('=')[1] || 'empty';
  document.getElementById('state').textContent = cookie + '/' + (localStorage.getItem('hero_share') || 'empty');
}
function login(value) {
  document.cookie = 'hero_share=' + value + '; Max-Age=86400; SameSite=Lax; Path=/';
  localStorage.setItem('hero_share', value); render();
}
document.getElementById('a').onclick = () => login('A');
document.getElementById('b').onclick = () => login('B');
document.getElementById('out').onclick = () => { document.cookie = 'hero_share=; Max-Age=0; Path=/'; localStorage.removeItem('hero_share'); render(); };
render();
</script></body></html>`;
(async () => {
  mkdirSync('test-results', { recursive: true });
  const dir = mkdtempSync(path.resolve('test-results/share-'));
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  let app, window;
  const errors = [];
  async function launch() {
    app = await electron.launch({ args: ['.', '--user-data-dir=' + dir], env });
    app.context().setDefaultTimeout(10000);
    window = await app.firstWindow();
    window.on('pageerror', error => errors.push(error.message));
    await window.getByRole('heading', { name: /Ke mana kita/ }).waitFor();
    await response(1);
  }
  async function response(value) { await app.evaluate(({ dialog }, value) => { dialog.showMessageBox = async () => ({ response: value, checkboxChecked: false }); }, value); }
  async function select(id) {
    await window.getByRole('combobox', { name: 'Profil aktif' }).selectOption(id);
    await idle();
    await window.waitForFunction(id => window.browser.getState().then(s => s.activeProfileId === id), id);
  }
  async function idle() { await window.waitForFunction(() => !document.getElementById('profile-select').disabled); }
  async function navigate() {
    const id = await window.getByRole('combobox', { name: 'Profil aktif' }).inputValue();
    const target = url + '/?profile=' + id;
    const address = window.getByRole('textbox', { name: 'Alamat atau pencarian' });
    await address.fill(target); await address.press('Enter');
    await window.getByRole('tab', { name: 'Share fixture', exact: true }).waitFor();
    return app.context().pages().find(p => p.url() === target);
  }
  async function share(all = false) {
    if (await window.locator('#share-options').isHidden()) await window.locator('#toggle-share').click();
    if (all) await window.getByRole('button', { name: 'Pilih semua', exact: true }).click();
    else await window.getByRole('checkbox', { name: 'Instagram', exact: true }).check();
    await window.locator('#apply-share').click();
    await idle();
  }
  async function close() {
    const exited = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
    await exited; app = null;
  }
  try {
    await launch();
    await select('instagram');
    let recipient = await navigate();
    await recipient.getByRole('button', { name: 'Login B', exact: true }).click();
    await recipient.getByText('B/B', { exact: true }).waitFor();
    await select('youtube');
    let source = await navigate();
    await source.getByRole('button', { name: 'Login A', exact: true }).click();

    await response(0); await share();
    assert.equal((await window.evaluate(() => window.browser.getState())).profiles.find(p => p.id === 'instagram').sessionProfileId, 'instagram');
    await response(1); await share();
    await select('instagram');
    await window.getByRole('heading', { name: /Ke mana kita/ }).waitFor();
    recipient = await navigate();
    await recipient.getByText('A/A', { exact: true }).waitFor();
    assert.equal((await window.evaluate(() => window.browser.getState())).profiles.find(p => p.id === 'default').sessionProfileId, 'default');
    console.log('PASS cancelled share preserves private sessions; selected share uses real source cookie and storage');

    await recipient.getByRole('button', { name: 'Logout', exact: true }).click();
    await select('youtube');
    await source.reload();
    await source.getByText('empty/empty', { exact: true }).waitFor();
    await select('instagram');
    await window.locator('#stop-sharing').click(); await idle();
    recipient = await navigate();
    await recipient.getByText('B/B', { exact: true }).waitFor();
    console.log('PASS logout affects the shared group; stopping share restores untouched private login');

    await select('youtube');
    await source.getByRole('button', { name: 'Login A', exact: true }).click();
    await share(true);
    assert.ok((await window.evaluate(() => window.browser.getState())).profiles.every(p => p.sessionProfileId === 'youtube'));
    await window.screenshot({ path: 'test-results/share-session.png' });
    await close(); await launch();
    for (const id of ['default', 'instagram', 'research', 'youtube']) {
      await select(id);
      const page = await navigate();
      await page.getByText('A/A', { exact: true }).waitFor();
    }
    console.log('PASS share all and actual restart retain the same source session across every profile');

    assert.equal(await window.getByRole('button', { name: 'Hapus profil', exact: true }).isDisabled(), true);
    await select('instagram');
    await window.getByRole('button', { name: 'Hapus profil', exact: true }).click(); await idle();
    await select('youtube');
    source = await navigate();
    await source.getByText('A/A', { exact: true }).waitFor();
    console.log('PASS shared source cannot be deleted and deleting a recipient preserves the source login');

    await window.locator('#stop-sharing').click(); await idle();
    await select('research');
    const independent = await navigate();
    await independent.getByText('empty/empty', { exact: true }).waitFor();
    console.log('PASS source can stop sharing and return all recipients to their own sessions');

    await select('youtube');
    await app.evaluate(({ session }, url) => {
      session.fromPartition('persist:hero-youtube').webRequest.onBeforeRequest({ urls: ['https://mail.google.com/*'] }, (_details, callback) => callback({ redirectURL: url + '/google-entry' }));
    }, url);
    const count = await window.getByRole('tab').count();
    await window.getByRole('button', { name: 'Gmail / Google', exact: true }).click(); await idle();
    await window.waitForFunction(count => document.querySelectorAll('[role=tab]').length === count + 1, count);
    await window.waitForFunction(url => document.getElementById('address').value === url + '/google-entry', url);
    assert.deepEqual(errors, []);
    console.log('PASS Google entry opens a new tab in the selected session; zero renderer errors');
  } finally {
    if (app) await app.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
