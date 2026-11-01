const assert = require('node:assert/strict');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

/** Reliability cases: per-profile settings (stealth, session cookies, site data) and app dialogs. */
module.exports = async ({ app, url, call, raw, action, expectError, reset, test, taskId, userDataDir }) => {
  await test('stealth can be switched off per profile: pages then see the real browser', async () => {
    const win = await app.firstWindow();
    const setStealth = enabled => win.evaluate(value => window.browser.command({ action: 'set-stealth', profileId: 'default', enabled: value }), enabled);
    try {
      let guest = await reset();
      assert.equal(await guest.evaluate(() => Array.isArray(navigator.plugins)), true, 'stealth on: plugins are the injected fake array');
      assert.deepEqual(await setStealth(false), { ok: true });
      guest = await reset();
      assert.equal(await guest.evaluate(() => Array.isArray(navigator.plugins)), false, 'stealth off: the real PluginArray');
      assert.equal(await guest.evaluate(() => Object.getOwnPropertyDescriptor(navigator, 'webdriver')), undefined, 'no patched getter on navigator');
    } finally {
      await setStealth(true);
    }
  });

  await test('clear site data removes one site in one profile and keeps other sites', async () => {
    const guest = await reset();
    const host = new URL(url).hostname;
    await guest.evaluate(() => { document.cookie = 'flag=suspicious; max-age=86400; path=/'; localStorage.setItem('device', 'flagged'); });
    await app.evaluate(async ({ session }) => {
      await session.fromPartition('persist:hero-default').cookies.set({ url: 'https://other-site.test/', name: 'keep', value: '1', expirationDate: Date.now() / 1000 + 3600 });
    });
    const win = await app.firstWindow();
    // Confirm the "Hapus data situs" dialog without a human.
    await app.evaluate(({ dialog }) => { globalThis.__realBox = dialog.showMessageBox; dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    try {
      const listed = await win.evaluate(() => window.browser.listSiteData('default'));
      assert.ok(listed.some(entry => entry.site === host && entry.cookies >= 1), 'the picker lists the site that has data');
      assert.deepEqual(await win.evaluate(domain => window.browser.command({ action: 'clear-site-data', profileId: 'default', domains: [domain] }), host), { ok: true });
    } finally {
      await app.evaluate(({ dialog }) => { dialog.showMessageBox = globalThis.__realBox; });
    }
    const left = await app.evaluate(async ({ session }, h) => {
      const cookies = await session.fromPartition('persist:hero-default').cookies.get({});
      return { site: cookies.filter(c => c.domain.replace(/^./, '') === h).length, other: cookies.filter(c => c.name === 'keep').length };
    }, host);
    assert.deepEqual(left, { site: 0, other: 1 });
    const fresh = await reset();
    assert.equal(await fresh.evaluate(() => localStorage.getItem('device')), null);
  });

  await test('app dialogs are not covered by the web page view', async () => {
    await reset();
    const win = await app.firstWindow();
    const pageVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.some(v => v.getVisible()));
    assert.equal(await pageVisible(), true, 'page view shows normally');
    await win.click('#manage-profiles');
    await win.waitForFunction(() => !document.getElementById('profiles-modal').hidden);
    await win.waitForTimeout(300);
    assert.equal(await pageVisible(), false, 'page view hidden while the dialog is open');
    await win.click('#done-profiles-modal');
    await win.waitForTimeout(300);
    assert.equal(await pageVisible(), true, 'page view back after closing');
  });

  await test('session cookies are stretched to 30 days only when the profile setting is on', async () => {
    const win = await app.firstWindow();
    const set = enabled => win.evaluate(value => window.browser.command({ action: 'set-session-cookies', profileId: 'default', enabled: value }), enabled);
    const expiryOf = name => app.evaluate(async ({ session }, n) => {
      const cookies = await session.fromPartition('persist:hero-default').cookies.get({ name: n });
      return cookies.map(c => (c.session ? 'session' : 'persistent'));
    }, name);
    try {
      assert.deepEqual(await set(true), { ok: true });
      let guest = await reset();
      await guest.evaluate(() => { document.cookie = 'kept_on=1; path=/'; });
      await new Promise(r => setTimeout(r, 400));
      assert.deepEqual(await expiryOf('kept_on'), ['persistent'], 'stretched, and no duplicate copy is left behind');
      assert.deepEqual(await set(false), { ok: true });
      guest = await reset();
      await guest.evaluate(() => { document.cookie = 'kept_off=1; path=/'; });
      await new Promise(r => setTimeout(r, 400));
      assert.deepEqual(await expiryOf('kept_off'), ['session'], 'left as a normal session cookie');
    } finally {
      await set(true);
    }
  });
};
