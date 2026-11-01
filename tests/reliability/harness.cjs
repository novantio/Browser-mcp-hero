// Shared harness for the Electron reliability regression suite: starts the fixture
// server and Hero, connects a real MCP client, runs each suite, then tears down.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

async function runReliabilitySuites(suites) {
  const fixture = readFileSync(path.join(__dirname, '../fixtures/automation-reliability.html'), 'utf8');
  const server = createServer((req, res) => {
    const pathname = req.url.split('?')[0];
    if (pathname === '/api/slow') {
      setTimeout(() => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
      }, 300);
      return;
    }
    if (pathname === '/api/fail') {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'server_error' }));
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(pathname === '/colors' ? '<!doctype html><html style="background:rgb(255,0,0);height:100%"><body style="margin:0"></body></html>' : fixture);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  mkdirSync(path.resolve('test-results'), { recursive: true });
  const userDataDir = mkdtempSync(path.resolve('test-results/reliability-'));
  // The suite exercises every browser tool, so expose all of them (default preset is core).
  const env = { ...process.env, HERO_USER_DATA_DIR: userDataDir, HERO_TOOL_PROFILE: 'all' };
  delete env.ELECTRON_RUN_AS_NODE;
  let app, client;
  const failures = [];
  let passed = 0;
  try {
    app = await electron.launch({ args: ['.', '--user-data-dir=' + userDataDir], env, timeout: 30000 });
    const win = await app.firstWindow();
    app.context().setDefaultTimeout(10000);
    await win.getByRole('heading', { name: /Ke mana kita/ }).waitFor();
    await win.waitForFunction(() => document.querySelector('#mcp-status-badge').textContent === 'MCP AKTIF');
    client = new Client({ name: 'reliability-regression', version: '1.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist/mcp/index.js')], cwd: process.cwd(), env, stderr: 'pipe' });
    transport.stderr.on('data', () => {});
    await client.connect(transport);
    const raw = (name, args = {}) => client.callTool({ name, arguments: args });
    const call = async (name, args = {}) => {
      const result = await raw(name, args);
      assert.ok(!result.isError, name + ': ' + JSON.stringify(result.content));
      assert.ok(result.structuredContent, 'Structured MCP output required');
      return result.structuredContent.result;
    };
    const task = await call('browser_start_task', { profileId: 'default' });
    const taskId = task.id;
    const action = (name, args = {}) => call(name, { taskId, ...args });
    const expectError = async (name, args, expected, expectedStatus) => {
      const result = await raw(name, { taskId, ...args });
      assert.equal(result.isError, true, 'Action should reject without a side effect');
      const payload = JSON.parse(result.content.find(item => item.type === 'text').text);
      assert.equal(payload.code, expected);
      if (expectedStatus) {
        assert.equal(payload.status, expectedStatus);
      }
      return result;
    };
    let navigationId = 0;
    const reset = async (route = '/') => {
      const target = url + route + '?case=' + (++navigationId);
      await action('browser_navigate', { url: target });
      await action('browser_wait', { selector: route === '/colors' ? 'body' : '#username' });
      const guest = app.context().pages().find(page => page.url().startsWith(url));
      assert.ok(guest, 'Fixture browser page exists');
      await guest.waitForURL(target, { waitUntil: 'load' });
      await guest.locator(route === '/colors' ? 'body' : '#username').waitFor({ state: 'attached' });
      return guest;
    };
    const test = async (name, run) => {
      if (process.env.RELIABILITY_FILTER && !new RegExp(process.env.RELIABILITY_FILTER, 'i').test(name)) return;
      try { await run(); passed++; console.log('PASS ' + name); }
      catch (error) { failures.push({ name, message: error.message }); console.error('FAIL ' + name + ': ' + error.message); }
    };


    for (const suite of suites) await suite({ app, url, call, raw, action, expectError, reset, test, taskId, userDataDir });


    const status = await call('browser_get_task_status', { taskId });
    if (status.status === 'RUNNING') await call('browser_complete_task', { taskId });
    console.log('\nReliability checks: ' + passed + ' passed, ' + failures.length + ' failed.');
    writeFileSync(path.join(userDataDir, 'results.json'), JSON.stringify({ passed, failures }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    try { if (client) await client.close(); }
    finally { try { if (app) await app.close(); } finally { await new Promise(resolve => server.close(resolve)); } }
  }
}

module.exports = { runReliabilitySuites };
