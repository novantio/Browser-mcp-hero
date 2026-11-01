const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveAddress, isWebUrl, parseCommand, parseBounds, isAuthHost, isPopupWindow, alternateScheme, normalizeCertHost } = require('../dist/shared/navigation');

test('normalizes URLs and search terms without leaking credentials to navigation', () => {
  assert.equal(resolveAddress(' example.com '), 'https://example.com/');
  assert.equal(resolveAddress('https://example.com/a?q=one'), 'https://example.com/a?q=one');
  assert.equal(resolveAddress('localhost:3210/test'), 'http://localhost:3210/test');
  assert.equal(resolveAddress('127.0.0.1:3210'), 'http://127.0.0.1:3210/');
  assert.equal(resolveAddress('browser manusia & AI'), 'https://www.google.com/search?q=browser%20manusia%20%26%20AI');

  // Private/LAN hosts default to http (they commonly serve plain HTTP, e.g. Elasticsearch :9200)
  assert.equal(resolveAddress('10.6.13.92:9200'), 'http://10.6.13.92:9200/');
  assert.equal(resolveAddress('10.6.13.92:9200/index'), 'http://10.6.13.92:9200/index');
  assert.equal(resolveAddress('192.168.1.5'), 'http://192.168.1.5/');
  assert.equal(resolveAddress('172.16.0.10:8080'), 'http://172.16.0.10:8080/');
  assert.equal(resolveAddress('172.31.255.254'), 'http://172.31.255.254/');
  assert.equal(resolveAddress('169.254.10.1'), 'http://169.254.10.1/');
  assert.equal(resolveAddress('myserver.local'), 'http://myserver.local/');
  // Public hosts keep https
  assert.equal(resolveAddress('google.com'), 'https://google.com/');
  assert.equal(resolveAddress('8.8.8.8'), 'https://8.8.8.8/');
  assert.equal(resolveAddress('172.32.0.1'), 'https://172.32.0.1/');
  // An explicit scheme is always honored
  assert.equal(resolveAddress('http://10.6.13.92:9200'), 'http://10.6.13.92:9200/');
  assert.equal(resolveAddress('https://10.6.13.92:9200'), 'https://10.6.13.92:9200/');
  for (const input of ['', 'javascript:alert(1)', 'file:///C:/Windows', 'data:text/html,hello', 'https://user:password@example.com', 'chrome://settings']) {
    assert.throws(() => resolveAddress(input), undefined, input);
  }
});

test('navigation policy rejects external protocols and credentials', () => {
  for (const input of ['https://example.com', 'http://localhost:9000']) assert.equal(isWebUrl(input), true);
  for (const input of ['about:blank', 'file:///test', 'javascript:alert(1)', 'https://a:b@example.com', 'not a url']) assert.equal(isWebUrl(input), false);
});

test('alternateScheme flips http/https for fallback navigation', () => {
  assert.equal(alternateScheme('https://10.6.13.92:9200/'), 'http://10.6.13.92:9200/');
  assert.equal(alternateScheme('http://10.6.13.92:9200/index'), 'https://10.6.13.92:9200/index');
  assert.equal(alternateScheme('https://example.com/a?q=1'), 'http://example.com/a?q=1');
  assert.equal(alternateScheme('ftp://example.com'), null);
  assert.equal(alternateScheme('not a url'), null);
});

test('normalizeCertHost strips ports, brackets and case', () => {
  assert.equal(normalizeCertHost('Es-Corp.LOCAL:8443'), 'es-corp.local');
  assert.equal(normalizeCertHost('[::1]:9200'), '::1');
  assert.equal(normalizeCertHost('[fe80::1]'), 'fe80::1');
  assert.equal(normalizeCertHost('::1'), '::1');
  assert.equal(normalizeCertHost('10.6.6.100'), '10.6.6.100');
  assert.equal(normalizeCertHost('  '), '');
});

test('IPC commands have strict input boundaries', () => {
  assert.deepEqual(parseCommand({ action: 'navigate', input: 'hello' }), { action: 'navigate', input: 'hello' });
  for (const input of [null, {}, { action: 'evaluate', code: 'process.exit()' }, { action: 'new-tab', extra: true }, { action: 'navigate', input: 123 }, { action: 'close-tab', tabId: 2 }]) assert.throws(() => parseCommand(input));
});

test('native bounds reject malformed or unbounded geometry', () => {
  assert.deepEqual(parseBounds({ x: 0, y: 117, width: 1000, height: 600 }), { x: 0, y: 117, width: 1000, height: 600 });
  for (const input of [{ x: -1, y: 1, width: 1, height: 1 }, { x: 0, y: 0, width: Infinity, height: 1 }, { x: 0, y: 0, width: 1.5, height: 1 }, {}]) assert.throws(() => parseBounds(input));
});

test('profile commands reject unsafe IDs and excess fields at IPC boundary', () => {
  assert.deepEqual(parseCommand({ action: 'switch-profile', profileId: 'instagram' }), { action: 'switch-profile', profileId: 'instagram' });
  assert.deepEqual(parseCommand({ action: 'create-profile', name: 'Akun kerja' }), { action: 'create-profile', name: 'Akun kerja' });
  for (const input of [
    { action: 'switch-profile', profileId: '../outside' },
    { action: 'delete-profile', profileId: 'default', force: true },
    { action: 'create-profile', name: 42 },
    { action: 'create-profile', name: 'x'.repeat(41) },
    { action: 'save-session', extra: true }
  ]) assert.throws(() => parseCommand(input));
});

test('share IPC schema rejects empty, duplicate, unsafe or injected targets', () => {
  assert.deepEqual(parseCommand({ action: 'share-session', targetIds: ['instagram', 'research'] }), { action: 'share-session', targetIds: ['instagram', 'research'] });
  for (const input of [
    { action: 'share-session', targetIds: [] },
    { action: 'share-session', targetIds: ['instagram', 'instagram'] },
    { action: 'share-session', targetIds: ['../outside'] },
    { action: 'share-session', targetIds: ['instagram'], sourceId: 'youtube' },
    { action: 'stop-sharing', all: true }
  ]) assert.throws(() => parseCommand(input));
});

test('identifies auth hosts and popup windows correctly', () => {
  assert.equal(isAuthHost('https://accounts.google.com/gsi/select'), true);
  assert.equal(isAuthHost('https://sub.accounts.google.com/oauth'), true);
  assert.equal(isAuthHost('https://appleid.apple.com/auth/authorize'), true);
  assert.equal(isAuthHost('https://login.microsoftonline.com/common/oauth2'), true);
  assert.equal(isAuthHost('https://login.live.com/oauth20_authorize.srf'), true);
  assert.equal(isAuthHost('https://www.google.com/search'), false);
  assert.equal(isAuthHost('https://en.wikipedia.org/wiki/OAuth'), false);
  assert.equal(isAuthHost('about:blank'), false);

  // Popup with features
  assert.equal(isPopupWindow({ url: 'https://example.com', features: 'width=500,height=600' }), true);
  // Popup with disposition new-window
  assert.equal(isPopupWindow({ url: 'https://example.com', disposition: 'new-window' }), true);
  // Popup with named window
  assert.equal(isPopupWindow({ url: 'https://example.com', frameName: 'gsi_login' }), true);
  // Popup with Google auth URL
  assert.equal(isPopupWindow({ url: 'https://accounts.google.com/gsi/select' }), true);
  // Regular link clicked with target _blank
  assert.equal(isPopupWindow({ url: 'https://example.com', frameName: '', features: '', disposition: 'foreground-tab' }), false);
  assert.equal(isPopupWindow({ url: 'https://example.com', frameName: '_blank', features: '', disposition: 'foreground-tab' }), false);
  // Login windows must keep window.opener (e.g. Shopee/Facebook/X "log in with" flows).
  assert.equal(isPopupWindow({ url: '', disposition: 'foreground-tab' }), true, 'empty window filled in by script');
  assert.equal(isPopupWindow({ url: 'about:blank', disposition: 'foreground-tab' }), true);
  assert.equal(isPopupWindow({ url: 'https://www.facebook.com/v19.0/dialog/oauth?client_id=1&redirect_uri=x', disposition: 'foreground-tab' }), true);
  assert.equal(isPopupWindow({ url: 'https://shop.example/connect?app_id=9&redirect_uri=https%3A%2F%2Fshop.example', disposition: 'foreground-tab' }), true);
  assert.equal(isPopupWindow({ url: 'https://x.com/i/oauth2/authorize?response_type=code', disposition: 'foreground-tab' }), true);
  assert.equal(isPopupWindow({ url: 'https://en.wikipedia.org/wiki/OAuth', disposition: 'foreground-tab' }), false, 'articles about OAuth stay tabs');
  assert.equal(isAuthHost('https://www.facebook.com/dialog/oauth'), true);
  assert.equal(isAuthHost('https://www.facebook.com/somepage'), false);
  assert.equal(isAuthHost('https://www.tiktok.com/v2/auth/authorize/'), true);
  assert.equal(isAuthHost('https://github.com/login/oauth/authorize'), true);
});
