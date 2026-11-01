const assert = require('node:assert/strict');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

/** Reliability cases: clicks, typing, evaluate, stealth, expectations, observe, waits. */
module.exports = async ({ app, url, call, raw, action, expectError, reset, test, taskId, userDataDir }) => {
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
    const obs = await action('browser_observe', { format: 'both' });
    assert.ok(obs.url);
    assert.ok(obs.elements && obs.elements.length > 0);
    assert.ok(obs.text && obs.text.includes('[1]'));
    const submitEl = obs.elements.find(el => el.name === 'Sign in');
    assert.ok(submitEl && submitEl.id >= 1);
  });

  await test('type and click by elementId works reliably without CSS selector', async () => {
    const guest = await reset();
    const obs = await action('browser_observe', { format: 'both' });
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

  await test('browser_scroll scrolls an inner panel found by text and reports atEnd', async () => {
    const guest = await reset();
    // A comment panel with its own scrollbar, like TikTok's.
    await guest.evaluate(() => {
      const panel = document.createElement('div');
      panel.id = 'comment-panel';
      panel.style.cssText = 'height:150px;overflow-y:auto;border:1px solid #000';
      panel.innerHTML = '<p>42 comments</p>' + Array.from({ length: 40 }, (_, i) => `<p>Komentar ${i + 1}</p>`).join('');
      document.body.prepend(panel);
    });
    const first = await action('browser_scroll', { text: '42 comments', amount: 300 });
    assert.equal(first.target, 'element');
    assert.equal(first.before, 0);
    assert.equal(first.after, 300);
    assert.equal(await guest.evaluate(() => document.getElementById('comment-panel').scrollTop), 300);
    const bottom = await action('browser_scroll', { selector: '#comment-panel p', direction: 'bottom' });
    assert.equal(bottom.atEnd, true);
    assert.equal(bottom.after, bottom.max);
    await expectError('browser_scroll', { text: 'teks yang tidak ada di halaman' }, 'ELEMENT_NOT_FOUND');
  });

  await test('browser_scroll without a target scrolls the page instantly', async () => {
    const guest = await reset();
    await guest.evaluate(() => { document.body.style.minHeight = '5000px'; window.scrollTo(0, 0); });
    const result = await action('browser_scroll', { amount: 400 });
    assert.equal(result.target, 'page');
    assert.equal(result.after, 400);
    assert.equal(await guest.evaluate(() => Math.round(window.scrollY)), 400);
  });

};
