const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

(async () => {
  mkdirSync('test-results', { recursive: true });
  const root = mkdtempSync(path.resolve('test-results/engine-ui-'));
  const userData = path.join(root, 'profiles');
  const engineHome = path.join(root, 'engines');
  const env = { ...process.env, HERO_ENGINE_UPDATES: '0', HERO_ENGINE_HOME: engineHome, HERO_USER_DATA_DIR: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  let app, client;
  const errors = [];
  async function launch(executablePath) {
    app = await electron.launch({ args: ['.', '--user-data-dir=' + userData], env, executablePath, timeout: 30000 });
    app.context().setDefaultTimeout(10000);
    const win = await app.firstWindow();
    win.on('pageerror', error => errors.push(error.message));
    await win.getByRole('heading', { name: /Ke mana kita/ }).waitFor();
    await win.waitForFunction(() => document.querySelector('#mcp-status-badge').textContent === 'MCP AKTIF');
    return win;
  }
  async function closeNormally() {
    const closed = app.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    app = null;
  }
  try {
    let win = await launch();
    const state = await win.evaluate(() => window.browser.getState());
    assert.match(await win.locator('#engine-versions').innerText(), /Chromium .*Electron /);
    assert.equal(state.engineUpdate.currentElectron, require('electron/package.json').version);
    assert.equal(await win.locator('#engine-auto').isChecked(), false);
    await win.locator('#engine-auto').check();
    await win.waitForFunction(() => window.browser.getState().then(s => s.engineUpdate.enabled));
    assert.equal(JSON.parse(readFileSync(path.join(engineHome, 'preferences.json'))).enabled, true);

    // Exercise the actual UI/IPC and MCP routes with an offline release fixture.
    await app.evaluate(() => {
      globalThis.fetch = async () => new Response(JSON.stringify({ tag_name: 'v1.0.0', prerelease: false, draft: false }), { status: 200 });
    });
    await win.locator('#engine-check').click();
    await win.waitForFunction(() => window.browser.getState().then(s => s.engineUpdate.status === 'up_to_date'));
    client = new Client({ name: 'engine-update-regression', version: '1.0' });
    const transport = new StdioClientTransport({
      command: process.execPath, args: [path.resolve('dist/mcp/index.js')], cwd: process.cwd(), env, stderr: 'pipe',
    });
    transport.stderr.on('data', () => {});
    await client.connect(transport);
    for (const name of ['browser_get_engine_status', 'browser_check_engine_update']) {
      const result = await client.callTool({ name, arguments: {} });
      assert.ok(!result.isError, name + ': ' + JSON.stringify(result.content));
      assert.equal(result.structuredContent.result.currentElectron, state.engineUpdate.currentElectron);
    }
    await client.close(); client = null;
    await win.locator('#engine-auto').uncheck();
    await win.waitForFunction(() => window.browser.getState().then(s => !s.engineUpdate.enabled));
    assert.equal(JSON.parse(readFileSync(path.join(engineHome, 'preferences.json'))).enabled, false);
    await app.evaluate(async ({ session }) => {
      await session.fromPartition('persist:hero-default').cookies.set({
        url: 'https://hero-engine.test', name: 'synthetic_login', value: 'keep',
        expirationDate: Date.now() / 1000 + 86400,
      });
    });
    await win.locator('#engine-update-title').scrollIntoViewIfNeeded();
    await win.screenshot({ path: 'test-results/engine-updater.png' });
    await closeNormally();

    // Optional new runtime tests a real upgrade using only the synthetic profile above.
    win = await launch(process.env.HERO_TEST_ENGINE || undefined);
    const after = await win.evaluate(() => window.browser.getState());
    assert.equal(after.engineUpdate.enabled, false);
    const preserved = await app.evaluate(async ({ session }) => {
      const cookies = await session.fromPartition('persist:hero-default').cookies.get({ url: 'https://hero-engine.test' });
      return cookies.some(cookie => cookie.name === 'synthetic_login' && cookie.value === 'keep');
    });
    assert.equal(preserved, true);
    assert.deepEqual(errors, []);
    console.log('PASS updater UI, preferences, real MCP tools and synthetic login preserved across restart');
    console.log('PASS full Hero application on Electron ' + after.engineUpdate.currentElectron + ' / Chromium ' + after.engineUpdate.currentChromium);
    await closeNormally();
  } finally {
    if (client) await client.close();
    if (app) await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
