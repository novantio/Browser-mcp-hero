// URL redaction keeps harmless search terms; read_text can see the page behind a dialog.
const test = require('node:test');
const assert = require('node:assert/strict');
const { redactText } = require('../dist/shared/redaction');
const { htmlToMarkdown, hasOpenDialog } = require('../dist/main/html-to-markdown');

test('redactText keeps search and paging parameters but hides everything else', () => {
  assert.equal(redactText('https://www.tiktok.com/search?q=blitar&page=2'), 'https://www.tiktok.com/search?q=blitar&page=2');
  assert.equal(redactText('https://x.test/cb?code=abc123&state=xyz'), 'https://x.test/cb?code=[REDACTED]&state=[REDACTED]');
  assert.equal(redactText('https://x.test/?Q=kopi&session_id=s3cret'), 'https://x.test/?Q=kopi&session_id=[REDACTED]');
  assert.equal(redactText('https://user:pass@host.test/'), 'https://[REDACTED]@host.test/');
});

test('hasOpenDialog recognises modal dialogs', () => {
  assert.equal(hasOpenDialog('<div role="dialog" aria-modal="true">Passkey</div>'), true);
  assert.equal(hasOpenDialog('<section aria-modal="true">x</section>'), true);
  assert.equal(hasOpenDialog('<div role="alertdialog">x</div>'), true);
  assert.equal(hasOpenDialog('<div role="button">x</div>'), false);
});

test('keepAriaHidden reads the page an open dialog marks aria-hidden', () => {
  const html = '<body><div id="app" aria-hidden="true"><h1>Hasil pencarian blitar</h1><p>Video tentang Blitar</p></div>'
    + '<div role="dialog" aria-modal="true"><p>Create a passkey</p></div></body>';
  const normal = htmlToMarkdown(html).markdown;
  assert.ok(normal.includes('Create a passkey') && !normal.includes('Hasil pencarian'), 'default skips aria-hidden');
  const withPage = htmlToMarkdown(html, { keepAriaHidden: true }).markdown;
  assert.ok(withPage.includes('Hasil pencarian blitar') && withPage.includes('Create a passkey'));
});
