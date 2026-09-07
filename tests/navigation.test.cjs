const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveAddress, isWebUrl, parseCommand, parseBounds } = require('../dist/shared/navigation');

test('normalizes URLs and search terms without leaking credentials to navigation', () => {
  assert.equal(resolveAddress(' example.com '), 'https://example.com/');
  assert.equal(resolveAddress('https://example.com/a?q=one'), 'https://example.com/a?q=one');
  assert.equal(resolveAddress('localhost:3210/test'), 'http://localhost:3210/test');
  assert.equal(resolveAddress('127.0.0.1:3210'), 'http://127.0.0.1:3210/');
  assert.equal(resolveAddress('browser manusia & AI'), 'https://www.google.com/search?q=browser%20manusia%20%26%20AI');
  for (const input of ['', 'javascript:alert(1)', 'file:///C:/Windows', 'data:text/html,hello', 'https://user:password@example.com', 'chrome://settings']) {
    assert.throws(() => resolveAddress(input), undefined, input);
  }
});

test('navigation policy rejects external protocols and credentials', () => {
  for (const input of ['https://example.com', 'http://localhost:9000']) assert.equal(isWebUrl(input), true);
  for (const input of ['about:blank', 'file:///test', 'javascript:alert(1)', 'https://a:b@example.com', 'not a url']) assert.equal(isWebUrl(input), false);
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
