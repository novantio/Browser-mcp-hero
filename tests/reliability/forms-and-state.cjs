const assert = require('node:assert/strict');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

/** Reliability cases: waits, forms, element finding, state, screenshots, healing, files, checkpoints, act. */
module.exports = async ({ app, url, call, raw, action, expectError, reset, test, taskId, userDataDir }) => {
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
};
