const { _electron: electron } = require('playwright');
const { strict: assert } = require('node:assert');
const { createServer } = require('node:http');
const { mkdirSync } = require('node:fs');
const path = require('node:path');

(async () => {
  mkdirSync('test-results', { recursive: true });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/redirect-blocked') { res.writeHead(302, { Location: 'file:///C:/Windows/win.ini' }); res.end(); return; }
    if (req.url === '/oauth-start') {
      res.end('<!doctype html><html><head><title>Google Login</title></head><body><h1>Google Login</h1><a id="finish-auth" href="/oauth-transform">Pilih Akun</a></body></html>');
      return;
    }
    if (req.url === '/oauth-transform') {
      res.end('<!doctype html><html><head><title>Transform</title></head><body><script>if (window.opener) { window.opener.postMessage({ token: "oauth_success_token" }, "*"); window.close(); }</script></body></html>');
      return;
    }
    const second = req.url === '/second';
    res.end('<!doctype html><html><head><title>' + (second ? 'Halaman kedua' : 'Halaman pertama') + '</title></head><body style="font:20px sans-serif;padding:40px"><h1>' + (second ? 'Halaman kedua' : 'Halaman pertama') + '</h1><a href="/second">Buka halaman kedua</a><p><a href="/second" target="_blank">Buka tab terpisah</a></p><button id="oauth-btn" onclick="window.open(\'/oauth-start\', \'gsi_popup\', \'width=500,height=600\')">Login Google</button><input aria-label="Catatan" placeholder="Ketik di halaman"><a href="file:///C:/Windows/win.ini">Blocked file</a><script>window.addEventListener("message", e => { if (e.data?.token) document.body.setAttribute("data-auth", e.data.token); });</script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ args: ['.', '--user-data-dir=' + path.resolve('test-results/electron-profile')], env, timeout: 30000 });
    const window = await app.firstWindow();
    app.context().setDefaultTimeout(10000);
    const errors = [];
    window.on('pageerror', error => errors.push(error.message));
    await window.getByRole('heading', { name: /Ke mana kita/ }).waitFor();
    assert.equal(await window.getByRole('tab').count(), 1);
    await window.screenshot({ path: 'test-results/home.png' });
    console.log('PASS launch, preload and welcome screen');

    await window.getByRole('button', { name: 'Buka tab baru', exact: true }).click();
    assert.equal(await window.getByRole('tab').count(), 2);
    const address = window.getByRole('textbox', { name: 'Alamat atau pencarian' });
    await address.fill(base);
    await address.press('Enter');
    await window.getByRole('tab', { name: 'Halaman pertama', exact: true }).waitFor();
    await window.waitForFunction(() => document.getElementById('reload').getAttribute('aria-label') === 'Muat ulang');
    const guest = app.context().pages().find(page => page.url().startsWith(base));
    assert.ok(guest, 'Remote tab exists');
    assert.deepEqual(await guest.evaluate(() => ({ node: typeof window.require, bridge: typeof window.browser })), { node: 'undefined', bridge: 'undefined' });
    const remotePreferences = await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(wc => wc.getURL().startsWith('http://127.0.0.1')).map(wc => {
      const p = wc.getLastWebPreferences();
      return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration };
    }));
    assert.deepEqual(remotePreferences[0], { sandbox: true, contextIsolation: true, nodeIntegration: false });
    console.log('PASS real page navigation and remote isolation');

    await guest.getByRole('link', { name: 'Buka halaman kedua', exact: true }).click();
    await window.getByRole('tab', { name: 'Halaman kedua', exact: true }).waitFor();
    await window.getByRole('button', { name: 'Kembali', exact: true }).click();
    await window.getByRole('tab', { name: 'Halaman pertama', exact: true }).waitFor();
    await window.getByRole('button', { name: 'Maju', exact: true }).click();
    await window.getByRole('tab', { name: 'Halaman kedua', exact: true }).waitFor();
    await window.getByRole('button', { name: 'Muat ulang', exact: true }).click();
    await guest.getByRole('heading', { name: 'Halaman kedua' }).waitFor();
    console.log('PASS back, forward and reload');

    await guest.getByRole('textbox', { name: 'Catatan' }).fill('Tetap di tab ini');
    await window.getByRole('tab', { name: 'Tab baru', exact: true }).click();
    await window.getByRole('heading', { name: /Ke mana kita/ }).waitFor();
    await window.getByRole('tab', { name: 'Halaman kedua', exact: true }).click();
    assert.equal(await guest.getByRole('textbox', { name: 'Catatan' }).inputValue(), 'Tetap di tab ini');
    console.log('PASS switching tabs preserves live page state');

    await window.locator('#toggle-panel').click();
    await window.waitForFunction(() => document.getElementById('side-panel').hidden);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1050, 720));
    await window.waitForTimeout(250);
    const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.map(v => v.getBounds()));
    const surface = await window.locator('#browser-surface').boundingBox();
    assert.ok(bounds.some(b => Math.abs(b.width - surface.width) <= 1 && Math.abs(b.height - surface.height) <= 1));
    await window.locator('#toggle-panel').click();
    await window.screenshot({ path: 'test-results/compact.png' });
    console.log('PASS panel toggle and native view resizing');

    await guest.getByRole('textbox', { name: 'Catatan' }).click();
    await app.evaluate(({ webContents }) => {
      const contents = webContents.getAllWebContents().find(wc => wc.getURL().startsWith('http://127.0.0.1'));
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'L', modifiers: ['control'] });
      contents.sendInputEvent({ type: 'keyUp', keyCode: 'L', modifiers: ['control'] });
    });
    await window.waitForFunction(() => document.activeElement.id === 'address');
    await address.fill('javascript:alert(1)');
    await address.press('Enter');
    await window.getByRole('alert').filter({ hasText: 'Hanya alamat HTTP' }).waitFor();
    assert.ok(guest.url().startsWith(base));
    await guest.getByRole('link', { name: 'Blocked file', exact: true }).click();
    assert.ok(guest.url().startsWith(base));
    console.log('PASS address shortcut and blocked unsafe protocols');

    await guest.getByRole('link', { name: 'Buka tab terpisah', exact: true }).click();
    await window.waitForFunction(() => document.querySelectorAll('[role=tab]').length === 3);
    await window.waitForTimeout(200);
    await window.locator('.tab.active .tab-close').click();
    await window.waitForFunction(() => document.querySelectorAll('[role=tab]').length === 2);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    console.log('PASS popup opens a managed tab and closes cleanly');

    await guest.getByRole('button', { name: 'Login Google', exact: true }).click();
    await window.waitForTimeout(500);
    assert.equal(await window.getByRole('tab').count(), 2);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 2);
    const popupPage = app.context().pages().find(p => p.url().includes('/oauth-start'));
    assert.ok(popupPage, 'OAuth popup window exists');
    await popupPage.locator('#finish-auth').click();
    await window.waitForFunction(async () => {
      return (await document.body.getAttribute('data-auth')) || true;
    });
    await window.waitForTimeout(500);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    const authResult = await guest.evaluate(() => document.body.getAttribute('data-auth'));
    assert.equal(authResult, 'oauth_success_token');
    console.log('PASS OAuth popup preserves window.opener, posts message and closes cleanly');

    await address.fill('http://127.0.0.1:1');
    await address.press('Enter');
    await window.getByRole('heading', { name: 'Belum sampai tujuan.' }).waitFor();
    await address.fill(base);
    await address.press('Enter');
    await window.getByRole('tab', { name: 'Halaman pertama', exact: true }).waitFor();
    console.log('PASS navigation failure and recovery');

    while (await window.getByRole('tab').count() > 1) await window.locator('.tab.active .tab-close').click();
    await window.locator('.tab.active .tab-close').click();
    await window.getByRole('heading', { name: /Ke mana kita/ }).waitFor();
    assert.equal(await window.getByRole('tab').count(), 1);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length), 0);
    assert.deepEqual(errors, []);
    console.log('PASS last-tab replacement, view cleanup and zero renderer errors');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 940));
    await window.waitForTimeout(200);
    await window.screenshot({ path: 'test-results/home.png' });
  } finally {
    if (app) await app.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
