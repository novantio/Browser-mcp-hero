const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

(async () => {
  const fixture = readFileSync(path.join(__dirname, 'fixtures/automation-reliability.html'), 'utf8');
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
  const env = { ...process.env, HERO_USER_DATA_DIR: userDataDir };
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

    await test('controlled tracker input reaches submitted application state', async () => {
      const guest = await reset();
      await action('browser_type', { selector: '#username', text: 'Hero Agent', clear: true });
      await action('browser_click', { selector: '#login-submit' });
      assert.equal(await guest.locator('#submitted').textContent(), 'Hero Agent');
    });
    await test('controlled textarea supports clear then append and updates application state', async () => {
      const guest = await reset();
      await action('browser_type', { selector: '#notes', text: 'Replaced', clear: true });
      assert.equal(await guest.locator('#note-state').textContent(), 'Replaced');
      await action('browser_type', { selector: '#notes', text: ' plus', clear: false });
      assert.equal(await guest.locator('#notes').inputValue(), 'Replaced plus');
      assert.equal(await guest.locator('#note-state').textContent(), 'Replaced plus');
      await action('browser_type', { selector: '#notes', text: '', clear: true });
      assert.equal(await guest.locator('#note-state').textContent(), '');
    });
    for (const [selector, code] of [['#readonly', 'ELEMENT_NOT_INTERACTABLE'], ['#disabled', 'ELEMENT_NOT_INTERACTABLE'], ['#noneditable', 'ELEMENT_NOT_EDITABLE'], ['[', 'INVALID_SELECTOR']]) {
      await test('typing rejects ' + selector + ' with ' + code, async () => {
        const guest = await reset();
        await expectError('browser_type', { selector, text: 'MUST_NOT_CHANGE', clear: true }, code);
        assert.equal(await guest.locator('#readonly').inputValue(), 'unchanged');
        assert.equal(await guest.locator('#disabled').inputValue(), 'unchanged');
        assert.equal(await guest.locator('#noneditable').textContent(), 'Unchanged text');
      });
    }
    await test('text click chooses nested interactive element over ancestor text', async () => {
      const guest = await reset();
      await action('browser_click', { text: 'Open report' });
      assert.deepEqual(await guest.evaluate(() => window.actions), ['nested']);
    });
    await test('text click chooses exact match before earlier partial match', async () => {
      const guest = await reset();
      await action('browser_click', { text: 'Save' });
      assert.deepEqual(await guest.evaluate(() => window.actions), ['exact']);
    });
    await test('duplicate text is ambiguous and dispatches no click', async () => {
      const guest = await reset();
      await expectError('browser_click', { text: 'Duplicate' }, 'ELEMENT_AMBIGUOUS');
      assert.deepEqual(await guest.evaluate(() => window.actions), []);
    });
    for (const selector of ['#hidden', '#disabled-button', '#occluded']) {
      await test('click rejects noninteractable ' + selector, async () => {
        const guest = await reset();
        await expectError('browser_click', { selector }, 'ELEMENT_NOT_INTERACTABLE');
        assert.deepEqual(await guest.evaluate(() => window.actions), []);
      });
    }
    await test('click invalid selector reports INVALID_SELECTOR', async () => {
      await reset();
      await expectError('browser_click', { selector: '[' }, 'INVALID_SELECTOR');
    });
    for (const [name, script, code] of [
      ['syntax', '(() => { const SENTINEL_PRIVATE_SCRIPT = ; })()', 'SCRIPT_SYNTAX_ERROR'],
      ['runtime', '(() => { throw new Error("SENTINEL_PRIVATE_SCRIPT") })()', 'SCRIPT_EXECUTION_FAILED'],
    ]) {
      await test('evaluate ' + name + ' errors are specific and redact script secrets', async () => {
        await reset();
        const result = await expectError('browser_evaluate', { script }, code);
        assert.ok(!JSON.stringify(result).includes('SENTINEL_PRIVATE_SCRIPT'));
      });
    }

    await test('evaluate supports top-level await and multi-statement scripts natively', async () => {
      await reset();
      const res1 = await action('browser_evaluate', {
        script: 'await new Promise(r => setTimeout(() => r(42), 50));'
      });
      assert.equal(res1, 42);

      const res2 = await action('browser_evaluate', {
        script: 'const a = [10, 20, 30]; a.reduce((acc, v) => acc + v, 0);'
      });
      assert.equal(res2, 60);
    });

    await test('stealth anti-bot cloaks navigator.webdriver, mocks window.chrome and plugins', async () => {
      await reset();
      const stealthCheck = await action('browser_evaluate', {
        script: `({
          webdriver: navigator.webdriver,
          hasChrome: Boolean(window.chrome && window.chrome.runtime),
          pluginCount: navigator.plugins.length,
          hasLanguages: Array.isArray(navigator.languages) && navigator.languages.length > 0,
        })`
      });
      assert.equal(stealthCheck.webdriver, undefined);
      assert.equal(stealthCheck.hasChrome, true);
      assert.ok(stealthCheck.pluginCount >= 1);
      assert.equal(stealthCheck.hasLanguages, true);
    });

    await test('click with expect verifies when condition is met', async () => {
      const guest = await reset();
      await action('browser_type', { selector: '#username', text: 'Verified User', clear: true });
      const res = await action('browser_click', {
        selector: '#login-submit',
        expect: { selector: '#submitted', text: 'Verified User', timeoutMs: 3000 }
      });
      assert.equal(res.ok, true);
      assert.equal(res.status, 'verified');
      assert.equal(await guest.locator('#submitted').textContent(), 'Verified User');
    });

    await test('click with expect returns unverified when condition times out without error', async () => {
      const guest = await reset();
      await action('browser_type', { selector: '#username', text: 'Unverified Test', clear: true });
      const res = await action('browser_click', {
        selector: '#login-submit',
        expect: { selector: '#nonexistent-marker', timeoutMs: 200 }
      });
      assert.equal(res.ok, true);
      assert.equal(res.status, 'unverified');
      assert.ok(res.detail && res.detail.includes('batas waktu'));
      assert.equal(await guest.locator('#submitted').textContent(), 'Unverified Test');
    });

    await test('type with expect verifies field state change', async () => {
      const guest = await reset();
      const res = await action('browser_type', {
        selector: '#notes',
        text: 'Verified Note',
        clear: true,
        expect: { text: 'Verified Note', timeoutMs: 2000 }
      });
      assert.equal(res.ok, true);
      assert.equal(res.status, 'verified');
      assert.equal(await guest.locator('#note-state').textContent(), 'Verified Note');
    });

    await test('rejected action returns not_executed status in error payload', async () => {
      await reset();
      await expectError('browser_click', { selector: '#hidden' }, 'ELEMENT_NOT_INTERACTABLE', 'not_executed');
      await expectError('browser_click', { text: 'Duplicate' }, 'ELEMENT_AMBIGUOUS', 'not_executed');
    });

    await test('observe extracts semantic snapshot with numbered element IDs', async () => {
      const guest = await reset();
      const obs = await action('browser_observe', {});
      assert.ok(obs.url);
      assert.ok(obs.elements && obs.elements.length > 0);
      assert.ok(obs.text && obs.text.includes('[1]'));
      const submitEl = obs.elements.find(el => el.name === 'Sign in');
      assert.ok(submitEl && submitEl.id >= 1);
    });

    await test('type and click by elementId works reliably without CSS selector', async () => {
      const guest = await reset();
      const obs = await action('browser_observe', {});
      const userEl = obs.elements.find(el => el.tag === 'input' && el.role === 'textbox');
      const submitEl = obs.elements.find(el => el.name === 'Sign in');
      assert.ok(userEl && submitEl);

      await action('browser_type', { elementId: userEl.id, text: 'Agent Index', clear: true });
      await action('browser_click', { elementId: submitEl.id });
      assert.equal(await guest.locator('#submitted').textContent(), 'Agent Index');
    });

    await test('select option updates value and triggers change event', async () => {
      const guest = await reset();
      await action('browser_select_option', { selector: '#country', value: 'my' });
      assert.equal(await guest.locator('#selected-country').textContent(), 'my');
      await action('browser_select_option', { selector: '#country', text: 'Singapore' });
      assert.equal(await guest.locator('#selected-country').textContent(), 'sg');
    });

    await test('check and uncheck updates checkbox state and triggers events', async () => {
      const guest = await reset();
      await action('browser_check', { selector: '#agree', checked: true });
      assert.equal(await guest.locator('#agree-state').textContent(), 'true');
      await action('browser_check', { selector: '#agree', checked: false });
      assert.equal(await guest.locator('#agree-state').textContent(), 'false');
    });

    await test('hover triggers mouseenter on target element', async () => {
      const guest = await reset();
      await action('browser_hover', { selector: '#hover-box' });
      assert.equal(await guest.locator('#hover-state').textContent(), 'hovered');
    });

    await test('browser_get_console_logs captures log, warn, error and redacts secrets', async () => {
      await reset();
      await action('browser_evaluate', {
        script: `
          console.log("Normal informational log");
          console.warn("A warning message");
          console.error("Critical error with token: https://api.com?secret_token=PRIVATE_VALUE");
        `,
      });
      await new Promise(r => setTimeout(r, 100));
      const res = await action('browser_get_console_logs', { level: 'all' });
      assert.ok(res.entries.length >= 3);
      const messages = res.entries.map(e => e.message);
      assert.ok(messages.some(m => m.includes('Normal informational log')));
      assert.ok(messages.some(m => m.includes('A warning message')));
      const errorEntry = res.entries.find(e => e.message.includes('Critical error'));
      assert.ok(errorEntry, 'Critical error entry must be present');
      assert.equal(errorEntry.level, 'error');
      assert.ok(!errorEntry.message.includes('PRIVATE_VALUE'), 'Secret token must be redacted');
      assert.ok(errorEntry.message.includes('[REDACTED]'), 'Secret token must be replaced with [REDACTED]');
      assert.ok(res.summary.errorCount >= 1);
    });

    await test('browser_get_network_activity tracks requests, inflight, and failures', async () => {
      await reset();
      await action('browser_evaluate', {
        script: `
          fetch('/api/fail').catch(() => {});
        `,
      });
      await new Promise(r => setTimeout(r, 200));
      const activity = await action('browser_get_network_activity', {});
      assert.ok(activity.summary.totalRecorded >= 1);
      const failed = activity.failedRequests.find(r => r.url.includes('/api/fail'));
      assert.ok(failed, 'Failed request must be recorded');
      assert.equal(failed.status, 500);
    });

    await test('wait with selector state hidden waits until element is hidden', async () => {
      const guest = await reset();
      assert.equal(await guest.locator('#dismiss-target').isVisible(), true);
      setTimeout(() => {
        guest.locator('#dismiss-btn').click().catch(() => {});
      }, 150);
      const waited = await action('browser_wait', { selector: '#dismiss-target', state: 'hidden', timeoutMs: 5000 });
      assert.equal(waited, true);
      assert.equal(await guest.locator('#dismiss-target').isVisible(), false);
    });

    await test('wait with expression polls until condition evaluates to true', async () => {
      const guest = await reset();
      await guest.evaluate(() => {
        window.testFlag = false;
        setTimeout(() => { window.testFlag = true; }, 150);
      });
      const waited = await action('browser_wait', { expression: 'window.testFlag === true', timeoutMs: 5000 });
      assert.equal(waited, true);
    });

    await test('wait with networkIdle waits until background request finishes', async () => {
      const guest = await reset();
      await guest.evaluate(() => {
        fetch('/api/slow').then(() => { window.slowDone = true; });
      });
      const waited = await action('browser_wait', { networkIdle: true, timeoutMs: 5000 });
      assert.equal(waited, true);
      const slowDone = await guest.evaluate(() => Boolean(window.slowDone));
      assert.equal(slowDone, true);
    });

    const capturePixel = async label => {
      const result = await raw('browser_screenshot', { taskId });
      assert.ok(!result.isError, JSON.stringify(result.content));
      const image = result.content.find(item => item.type === 'image');
      assert.ok(image && image.mimeType === 'image/png');
      writeFileSync(path.join(userDataDir, label + '.png'), Buffer.from(image.data, 'base64'));
      return app.evaluate(({ nativeImage }, data) => {
        const image = nativeImage.createFromBuffer(Buffer.from(data, 'base64'));
        const { width, height } = image.getSize();
        if (!width || !height) throw new Error('Empty screenshot');
        const pixel = image.crop({ x: Math.floor(width / 2), y: Math.floor(height / 2), width: 1, height: 1 }).toBitmap();
        return [pixel[2], pixel[1], pixel[0]];
      }, image.data);
    };
    for (const mode of ['visible', 'occluded', 'hidden']) {
      await test('screenshot tracks DOM color changes with window ' + mode, async () => {
        await reset('/colors');
        try {
          if (mode === 'hidden') {
            await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
            await expectError('browser_screenshot', {}, 'SCREENSHOT_UNAVAILABLE');
            assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
            return;
          }
          if (mode === 'occluded') await app.evaluate(async ({ BrowserWindow }) => {
            const main = BrowserWindow.getAllWindows()[0];
            global.reliabilityCover = new BrowserWindow({ ...main.getBounds(), show: false, backgroundColor: '#0000ff' });
            await global.reliabilityCover.loadURL('data:text/html,<body style="background:blue">Cover fixture</body>');
            global.reliabilityCover.show();
          });
          assert.deepEqual(await capturePixel(mode + '-red'), [255, 0, 0]);
          await action('browser_evaluate', { script: 'document.documentElement.style.background = "rgb(0,255,0)"' });
          assert.deepEqual(await capturePixel(mode + '-green'), [0, 255, 0]);
        } finally {
          await app.evaluate(({ BrowserWindow }) => {
            if (global.reliabilityCover) { global.reliabilityCover.destroy(); delete global.reliabilityCover; }
            BrowserWindow.getAllWindows()[0].show();
          });
        }
      });
    }

    await test('browser_inspect_form extracts form structure and fields', async () => {
      const guest = await reset();
      const inspectRes = await action('browser_inspect_form', { formSelector: '#registration-form' });
      assert.ok(inspectRes.forms.length >= 1, 'Should find at least 1 form');
      const regForm = inspectRes.forms.find(f => f.id === 'registration-form');
      assert.ok(regForm, 'Registration form should be detected');
      assert.equal(regForm.method, 'POST');
      assert.ok(regForm.fields.some(f => f.name === 'fullname' && f.required), 'Fullname field must be detected and required');
      assert.ok(regForm.fields.some(f => f.name === 'email' && f.type === 'email'), 'Email field must be detected with email type');
      assert.ok(regForm.fields.some(f => f.name === 'password' && f.type === 'password'), 'Password field must be detected');
      const roleField = regForm.fields.find(f => f.name === 'role');
      assert.ok(roleField && roleField.tag === 'select', 'Role field must be select');
      assert.equal(roleField.options.length, 3);
      assert.ok(regForm.submitButton, 'Submit button must be identified');
      assert.equal(regForm.submitButton.text, 'Daftar Sekarang');
    });

    await test('browser_fill_form fills multi-field form and submits successfully', async () => {
      const guest = await reset();
      const fillRes = await action('browser_fill_form', {
        formSelector: '#registration-form',
        fields: {
          'Nama Lengkap': 'Budi Santoso',
          'Alamat Email': 'budi@example.com',
          'Kata Sandi': 'RahasiaBanget123',
          'Peran Pengguna': 'designer',
          'Biodata Singkat': 'UI/UX specialist',
          'newsletter': true,
        },
        submit: true,
      });
      assert.equal(fillRes.ok, true);
      assert.equal(fillRes.submitted, true);
      assert.equal(fillRes.valid, true);
      assert.equal(fillRes.filled.length, 6);
      assert.equal(fillRes.skipped.length, 0);

      // Verify DOM updates in fixture
      assert.equal(await guest.locator('#reg-result').textContent(), 'REGISTERED: Budi Santoso');
      assert.equal(await guest.locator('#reg-role').inputValue(), 'designer');
      assert.equal(await guest.locator('#reg-bio').inputValue(), 'UI/UX specialist');
      assert.equal(await guest.locator('#reg-newsletter').isChecked(), true);
    });

    await test('browser_fill_form reports skipped non-existent fields gracefully', async () => {
      const guest = await reset();
      const fillRes = await action('browser_fill_form', {
        formSelector: '#registration-form',
        fields: {
          'Nama Lengkap': 'John Doe',
          'FieldYangTidakAda': 'RandomValue',
        },
        submit: false,
      });
      assert.equal(fillRes.ok, true);
      assert.equal(fillRes.submitted, false);
      assert.equal(fillRes.filled.length, 1);
      assert.equal(fillRes.skipped.length, 1);
      assert.equal(fillRes.skipped[0].field, 'FieldYangTidakAda');
      assert.equal(fillRes.skipped[0].reason, 'FIELD_NOT_FOUND');
    });

    await test('browser_find_element locates elements by semantic query and bounding box', async () => {
      const guest = await reset();
      const findRes = await action('browser_find_element', {
        query: 'Konfirmasi Pembayaran',
        role: 'button',
      });
      assert.ok(findRes.elements.length >= 1, 'Should find payment confirmation button');
      const btn = findRes.elements[0];
      assert.ok(btn.score >= 0.7, 'Score should be high');
      assert.equal(btn.role, 'button');
      assert.ok(btn.elementId >= 1, 'Element should have hero elementId');
      assert.ok(btn.boundingBox.width > 0 && btn.boundingBox.height > 0, 'Bounding box must have valid dimensions');

      // Interacting with found element directly via elementId
      await action('browser_click', { elementId: btn.elementId });
      const actions = await guest.evaluate(() => window.actions);
      assert.ok(actions.includes('btn-confirm-payment'), 'Found button was clicked via elementId');
    });

    await test('browser_get_state returns unified state summary', async () => {
      const guest = await reset();
      await guest.locator('#fullname').focus();
      const state = await action('browser_get_state', {});
      assert.ok(state.activeTab, 'Active tab must exist');
      assert.ok(state.activeTab.url.startsWith('http://127.0.0.1:'), 'URL must match');
      assert.equal(state.activeProfile.id, 'default');
      assert.equal(state.taskStatus, 'RUNNING');
      assert.ok(typeof state.network.inflightCount === 'number');
      assert.ok(typeof state.console.errorCount === 'number');
      assert.ok(state.focusedElement, 'Focused element should be captured');
      assert.equal(state.focusedElement.tag, 'input');
    });

    await test('browser_screenshot supports element and region cropping', async () => {
      const guest = await reset();
      // Test selector crop
      const cropElRes = await raw('browser_screenshot', { taskId, selector: '#hover-box' });
      assert.ok(!cropElRes.isError);
      const imgData = cropElRes.content.find(i => i.type === 'image');
      assert.ok(imgData);
      const elDimensions = await app.evaluate(({ nativeImage }, data) => {
        const img = nativeImage.createFromBuffer(Buffer.from(data, 'base64'));
        return img.getSize();
      }, imgData.data);
      assert.ok(elDimensions.width >= 90 && elDimensions.width <= 110, 'Width should match hover-box (100px)');
      assert.ok(elDimensions.height >= 25 && elDimensions.height <= 35, 'Height should match hover-box (30px)');

      // Test region crop
      const cropRegRes = await raw('browser_screenshot', {
        taskId,
        region: { x: 5, y: 5, width: 40, height: 40 },
      });
      assert.ok(!cropRegRes.isError);
      const regData = cropRegRes.content.find(i => i.type === 'image');
      assert.ok(regData);
      const regDimensions = await app.evaluate(({ nativeImage }, data) => {
        const img = nativeImage.createFromBuffer(Buffer.from(data, 'base64'));
        return img.getSize();
      }, regData.data);
      assert.equal(regDimensions.width, 40);
      assert.equal(regDimensions.height, 40);
    });

    await test('browser_detect_challenge detects presence of bot protection widget', async () => {
      const guest = await reset();
      const cleanResult = await action('browser_detect_challenge', {});
      assert.equal(cleanResult.detected, false);

      await guest.locator('#btn-add-challenge').click();
      const detectedResult = await action('browser_detect_challenge', {});
      assert.equal(detectedResult.detected, true);
      assert.equal(detectedResult.provider, 'cloudflare_turnstile');

      await guest.locator('#btn-remove-challenge').click();
      const afterRemoved = await action('browser_detect_challenge', {});
      assert.equal(afterRemoved.detected, false);
    });

    await test('browser_heal_selector repairs broken selector to target element', async () => {
      const guest = await reset();
      const healed = await action('browser_heal_selector', {
        selector: '#btn-order-target-old',
        previousTag: 'button',
        contextSnippet: 'Kirim Pesanan Baru',
      });
      assert.equal(healed.targetSelector, '#btn-order-target-old');
      assert.ok(healed.resolvedSelector.includes('btn-order-target'));
      assert.ok(healed.confidence >= 0.5);
      assert.ok(healed.candidates.length >= 1);
    });

    await test('click automatically heals broken selector when confidence is high', async () => {
      const guest = await reset();
      await action('browser_click', {
        selector: '#btn-order-target-old',
      });
      const actions = await guest.evaluate(() => window.actions);
      assert.ok(actions.includes('btn-order-target'), 'Auto-healed click should successfully trigger order target button');
    });

    await test('browser_upload_file sets files on file input via CDP', async () => {
      const guest = await reset();
      const tempUploadFile = path.join(userDataDir, 'hero-test-upload.txt');
      writeFileSync(tempUploadFile, 'Hero Agent File Upload Content');

      const uploadResult = await action('browser_upload_file', {
        selector: '#file-uploader',
        filePaths: [tempUploadFile],
      });
      assert.equal(uploadResult.ok, true);
      assert.equal(uploadResult.fileCount, 1);
      assert.equal(uploadResult.files[0], 'hero-test-upload.txt');

      const statusText = await guest.locator('#file-upload-status').textContent();
      assert.equal(statusText, 'hero-test-upload.txt');
    });

    await test('browser_wait_for_download times out gracefully when no download occurs', async () => {
      await reset();
      await expectError('browser_wait_for_download', {
        timeoutMs: 1200,
        fileNamePattern: 'missing-report-*.pdf',
      }, 'TIMEOUT');
    });

    await test('browser_create_checkpoint and browser_rollback_checkpoint snapshot and restore form state', async () => {
      const guest = await reset();
      await action('browser_fill_form', {
        formSelector: '#registration-form',
        fields: {
          fullname: 'Alice Wonderland',
          role: 'designer',
          newsletter: true,
        },
      });
      assert.equal(await guest.locator('#fullname').inputValue(), 'Alice Wonderland');
      assert.equal(await guest.locator('#reg-role').inputValue(), 'designer');
      assert.equal(await guest.locator('#reg-newsletter').isChecked(), true);

      const cp = await action('browser_create_checkpoint', { name: 'reg-checkpoint-1' });
      assert.equal(cp.ok, true);
      assert.equal(cp.name, 'reg-checkpoint-1');
      assert.ok(cp.fieldsCount >= 3);

      await action('browser_fill_form', {
        formSelector: '#registration-form',
        fields: {
          fullname: 'Bob The Builder',
          role: 'manager',
          newsletter: false,
        },
      });
      assert.equal(await guest.locator('#fullname').inputValue(), 'Bob The Builder');
      assert.equal(await guest.locator('#reg-role').inputValue(), 'manager');
      assert.equal(await guest.locator('#reg-newsletter').isChecked(), false);

      const rb = await action('browser_rollback_checkpoint', { name: 'reg-checkpoint-1' });
      assert.equal(rb.ok, true);
      assert.equal(rb.name, 'reg-checkpoint-1');
      assert.ok(rb.restoredCount >= 3);

      assert.equal(await guest.locator('#fullname').inputValue(), 'Alice Wonderland');
      assert.equal(await guest.locator('#reg-role').inputValue(), 'designer');
      assert.equal(await guest.locator('#reg-newsletter').isChecked(), true);
    });

    await test('browser_act executes high-level intent with semantic resolution and verification', async () => {
      const guest = await reset();
      const actRes = await action('browser_act', {
        intent: 'click',
        target: 'Tombol Aksi AI',
        expect: {
          selector: '#act-result',
          text: 'ACT_CLICKED',
        },
      });
      assert.equal(actRes.ok, true);
      assert.equal(actRes.intent, 'click');
      assert.equal(actRes.verified, true);
      assert.equal(await guest.locator('#act-result').textContent(), 'ACT_CLICKED');
    });

    const status = await call('browser_get_task_status', { taskId });
    if (status.status === 'RUNNING') await call('browser_complete_task', { taskId });
    console.log('\nReliability checks: ' + passed + ' passed, ' + failures.length + ' failed.');
    writeFileSync(path.join(userDataDir, 'results.json'), JSON.stringify({ passed, failures }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    try { if (client) await client.close(); }
    finally { try { if (app) await app.close(); } finally { await new Promise(resolve => server.close(resolve)); } }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
