const test = require('node:test');
const assert = require('node:assert/strict');
const { htmlToMarkdown, decodeEntities } = require('../dist/main/html-to-markdown.js');

const page = `<!doctype html><html><head><title>Toko &amp; Kopi</title>
<script>while(true){}</script><style>body{color:red}</style></head><body>
<nav><a href="/">Beranda</a> <a href="javascript:void(0)">Menu</a></nav>
<main><h1>Produk</h1><p>Harga   terbaik&nbsp;hari ini.</p>
<ul class="products"><li><a href="/p/kopi?ref=1">Kopi Gayo</a> Rp 85.000</li><li>Teh <b>Tubruk</b></li>
<li>Bertingkat<ul><li>Sub item</li></ul></li></ul>
<div hidden>rahasia tersembunyi</div><div style="display: none">juga tersembunyi</div>
<table><tr><th>Nama</th><th>Harga</th></tr><tr><td>Gula Aren</td><td>40.000</td></tr></table>
<pre>  kode
    terindentasi</pre>
<form><label>Kota <select name="kota"><option>Yogyakarta</option><option>Bandung</option></select></label>
<input type="search" placeholder="Cari produk"><button type="submit">Cari</button><button aria-label="ikon"><svg><path/></svg></button></form>
<a href="https://example.com/a">Satu</a> <a href="https://example.com/a">Dua</a>
</main><footer>Hak cipta</footer></body></html>`;

test('htmlToMarkdown renders a lynx-style page without scripts, styles or hidden text', () => {
  const result = htmlToMarkdown(page, { baseUrl: 'https://toko.test/kategori/' });
  assert.equal(result.title, 'Toko & Kopi');
  const md = result.markdown;
  assert.ok(md.includes('# Produk'));
  assert.ok(md.includes('Harga terbaik hari ini.'));
  assert.ok(md.includes('- [Kopi Gayo][2] Rp 85.000'), md);
  assert.ok(md.includes('- Teh **Tubruk**'));
  assert.ok(/\n {2}- Sub item/.test(md), 'nested list keeps its indentation');
  assert.ok(md.includes('| Gula Aren | 40.000 |'));
  assert.ok(md.includes('```\n  kode\n    terindentasi'), 'pre keeps whitespace');
  assert.ok(md.includes('[kota: Yogyakarta | Bandung]'));
  assert.ok(md.includes('[search: Cari produk]'));
  assert.ok(md.includes('[tombol: Cari]'));
  assert.ok(!/\[tombol:\s*\]/.test(md), 'icon-only buttons are dropped');
  for (const hidden of ['while(true)', 'color:red', 'rahasia', 'juga tersembunyi', 'Menu][']) assert.ok(!md.includes(hidden), hidden);
});

test('htmlToMarkdown numbers links, resolves them and reuses numbers for duplicate URLs', () => {
  const { markdown, links } = htmlToMarkdown(page, { baseUrl: 'https://toko.test/kategori/' });
  assert.ok(markdown.includes('[1]: https://toko.test/'));
  assert.ok(markdown.includes('[2]: https://toko.test/p/kopi?ref=1'));
  assert.ok(markdown.includes('[Satu][3]') && markdown.includes('[Dua][3]'));
  assert.equal(links, 3);
});

test('htmlToMarkdown mainOnly drops navigation and footer; includeLinks:false keeps plain text', () => {
  const main = htmlToMarkdown(page, { baseUrl: 'https://toko.test/', mainOnly: true, includeLinks: false });
  assert.ok(!main.markdown.includes('Beranda'));
  assert.ok(!main.markdown.includes('Hak cipta'));
  assert.ok(main.markdown.includes('Kopi Gayo Rp 85.000'));
  assert.ok(!main.markdown.includes('Tautan:'));
});

test('htmlToMarkdown truncates the body but keeps references for links still shown', () => {
  const many = '<body>' + Array.from({ length: 200 }, (_, i) => `<p><a href="/p/${i}">Item ${i}</a> ${'x'.repeat(50)}</p>`).join('') + '</body>';
  const result = htmlToMarkdown(many, { baseUrl: 'https://toko.test/', maxLength: 500 });
  assert.equal(result.truncated, true);
  assert.ok(result.markdown.includes('[1]: https://toko.test/p/0'));
  assert.ok(!result.markdown.includes('/p/150'));
  assert.ok(result.links < 200);
});

test('decodeEntities handles named and numeric entities', () => {
  assert.equal(decodeEntities('&lt;a&gt; &#65;&#x42; &hellip; &unknown;'), '<a> AB … &unknown;');
});
