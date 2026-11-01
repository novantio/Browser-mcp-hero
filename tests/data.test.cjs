const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DataStore } = require('../dist/main/data/store');
const { clean, privateText, convert, setPath, getPath, differences, assess, hash } = require('../dist/main/data/processing');
const { DataAnalysis } = require('../dist/main/data/analysis');
const { JobRunner } = require('../dist/main/data/job-runner');
const { InteractionRecorder } = require('../dist/main/data/recorder');
const { ProfileManager } = require('../dist/main/profile-manager');
const { TaskManager } = require('../dist/main/task-manager');
const { McpBridge } = require('../dist/main/mcp-bridge');
const { requestRpc } = require('../dist/mcp');

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hero-data-test-'));
  const store = new DataStore(dir);
  const profiles = new ProfileManager(dir);
  const tasks = new TaskManager(profiles);
  const analysis = new DataAnalysis(store);
  return { dir, store, profiles, tasks, analysis };
}

test('DataStore stores documents and indexes records with FTS5 search', () => {
  const { store } = setup();
  store.put('doc', 'd1', { title: 'First Document', count: 42 });
  const retrieved = store.get('doc', 'd1');
  assert.equal(retrieved.title, 'First Document');
  assert.equal(retrieved.count, 42);
  assert.equal(store.list('doc').length, 1);

  const record1 = {
    id: 'r1',
    text: 'Pengembangan kecerdasan buatan untuk pemrosesan bahasa alami di Indonesia',
    data: { author: 'Budi', engagement: { likes: 1500 } },
    hash: 'h1',
    language: 'id',
    quality: 0.9,
    pii: false,
    spam: false,
    source: { url: 'https://example.id/post/1', domain: 'example.id', sourceType: 'web', collectedAt: '2026-09-08T10:00:00Z', profileId: 'default', topic: 'ai' },
    provenance: { jobId: 'j1', runId: 'run1', snapshotId: 's1', extractorVersion: 'v1' },
  };
  const record2 = {
    id: 'r2',
    text: 'Machine learning datasets and large language models benchmark for research',
    data: { author: 'Alice', likes: 50 },
    hash: 'h2',
    language: 'en',
    quality: 0.85,
    pii: false,
    spam: false,
    source: { url: 'https://example.com/post/2', domain: 'example.com', sourceType: 'web', collectedAt: '2026-09-08T11:00:00Z', profileId: 'default', topic: 'ai' },
    provenance: { jobId: 'j1', runId: 'run1', snapshotId: 's1', extractorVersion: 'v1' },
  };
  store.addRecord(record1);
  store.addRecord(record2);

  // FTS5 text search
  const searchId = store.records({ query: 'kecerdasan bahasa' });
  assert.equal(searchId.total, 1);
  assert.equal(searchId.items[0].id, 'r1');

  const searchEn = store.records({ query: 'machine learning' });
  assert.equal(searchEn.total, 1);
  assert.equal(searchEn.items[0].id, 'r2');

  // Filter by language
  const idOnly = store.records({ language: 'id' });
  assert.equal(idOnly.total, 1);
  assert.equal(idOnly.items[0].id, 'r1');

  // Filter by min engagement
  const highEngagement = store.records({ minEngagement: 1000 });
  assert.equal(highEngagement.total, 1);
  assert.equal(highEngagement.items[0].id, 'r1');

  store.close();
});

test('processing normalizes text, scrubs PII, and parses schema fields', () => {
  assert.equal(clean('  Halo \t dunia\r\n\n\nbaru   '), 'Halo dunia\n\nbaru');

  const pii = privateText('Hubungi john.doe@example.com atau +6281234567890 dengan Bearer token_secret_123');
  assert.ok(pii.pii);
  assert.ok(pii.text.includes('[EMAIL]'));
  assert.ok(pii.text.includes('[PHONE_OR_ID]'));
  assert.ok(pii.text.includes('[TOKEN]'));

  // Nested path setters & getters
  const obj = {};
  setPath(obj, 'engagement.likes', 1200);
  setPath(obj, 'author.name', 'John Doe');
  assert.equal(getPath(obj, 'engagement.likes'), 1200);
  assert.equal(getPath(obj, 'author.name'), 'John Doe');

  // Field type conversion
  const intField = { path: 'followers', selector: '', type: 'integer', required: true };
  assert.equal(convert('12.5k', intField, 'https://example.com'), 12500);
  assert.equal(convert('1.2M', intField, 'https://example.com'), 1200000);

  const urlField = { path: 'link', selector: '', type: 'url', required: true };
  assert.equal(convert('/profile/test', urlField, 'https://example.com'), 'https://example.com/profile/test');
  assert.equal(convert('/watch?v=dQw4w9WgXcQ', urlField, 'https://www.youtube.com'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(convert('/watch?v=dQw4w9WgXcQ&token=secret123&session=xyz', urlField, 'https://www.youtube.com'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

  const boolField = { path: 'verified', selector: '', type: 'boolean', required: false };
  assert.equal(convert('ya', boolField, 'https://example.com'), true);
  assert.equal(convert('tidak', boolField, 'https://example.com'), false);

  // Heuristic assessment (language, quality, spam)
  const idAssess = assess('Ini adalah contoh kalimat yang sangat bagus untuk dataset kami');
  assert.equal(idAssess.language, 'id');
  assert.ok(idAssess.quality > 0.5);

  const enAssess = assess('This is a great and awesome sentence for our research benchmark');
  assert.equal(enAssess.language, 'en');
});

test('snapshot differences detect numeric deltas and percentage changes', () => {
  const before = [
    { username: '@tech_hero', followers: 100000, posts: 250 },
    { username: '@daily_news', followers: 50000, posts: 120 },
  ];
  const after = [
    { username: '@tech_hero', followers: 105000, posts: 255 },
    { username: '@daily_news', followers: 49000, posts: 121 },
  ];
  const changes = differences(before, after, ['username']);
  assert.ok(changes.length >= 4);

  const heroFollowers = changes.find(c => c.field === 'followers' && c.key.includes('@tech_hero'));
  assert.ok(heroFollowers);
  assert.equal(heroFollowers.before, 100000);
  assert.equal(heroFollowers.after, 105000);
  assert.equal(heroFollowers.delta, 5000);
  assert.equal(heroFollowers.percent, 5);
});

test('DataAnalysis builds LLM datasets, computes quality metrics and exports multi-format', async () => {
  const { store, analysis } = setup();

  const samples = [
    'Indonesia adalah negara kepulauan terbesar di dunia dengan keberagaman budaya yang sangat kaya.',
    'Kecerdasan buatan berkembang pesat di berbagai sektor termasuk kesehatan dan pendidikan nasional.',
    'Pemerintah mendorong transformasi digital melalui penyediaan infrastruktur internet cepat.',
    'Pertumbuhan ekonomi nasional ditopang oleh konsumsi domestik dan ekspor komoditas unggulan.',
    'Artificial intelligence is transforming industries across global enterprises with neural networks for modern production systems and automated intelligent machine learning workflows worldwide.',
    'Renewable energy sources such as solar and wind power are essential for sustainable climate goals.',
    'Quantum computing provides exponential speedups for specialized optimization algorithms.',
    'Open source software ecosystems foster global innovation and transparent code standards.',
    'Indonesia adalah negara kepulauan terbesar di dunia dengan keberagaman budaya yang sangat kaya.', // duplicate
    'Artificial intelligence is transforming industries across global enterprises with neural networks for modern production systems and automated intelligent machine learning workflows locally.', // near duplicate
  ];
  for (let i = 0; i < samples.length; i++) {
    const text = samples[i];
    store.addRecord({
      id: `rec-${i}`,
      text,
      data: { index: i },
      hash: hash(text),
      language: i < 4 || i === 8 ? 'id' : 'en',
      quality: 0.85,
      pii: false,
      spam: false,
      source: { url: `https://example.com/p/${i}`, domain: 'example.com', sourceType: 'web', collectedAt: `2026-09-08T${10 + (i % 5)}:00:00Z`, profileId: 'default', topic: 'ai' },
      provenance: { jobId: 'job-1', runId: 'run-1', snapshotId: 'snap-1', extractorVersion: 'v1' },
    });
  }

  // Build dataset
  const datasetSummary = analysis.build({
    name: 'LLM Train V1',
    minQuality: 0.4,
    language: 'all',
    chunkSize: 500,
    nearDedup: true,
    removeBoilerplate: true,
  });

  assert.equal(datasetSummary.name, 'LLM Train V1');
  assert.equal(datasetSummary.version, 1);
  assert.ok(datasetSummary.metrics.unique >= 7);
  assert.ok(datasetSummary.metrics.duplicates >= 1);
  assert.ok(datasetSummary.metrics.nearDuplicates >= 1);
  assert.ok(datasetSummary.metrics.languages.id > 0);
  assert.ok(datasetSummary.metrics.languages.en > 0);

  // Multi-format export
  const exportJsonl = await analysis.export(datasetSummary.id, 'jsonl');
  assert.ok(existsSync(exportJsonl.path));
  assert.ok(readFileSync(exportJsonl.path, 'utf8').includes('recordId'));

  const exportCsv = await analysis.export(datasetSummary.id, 'csv');
  assert.ok(existsSync(exportCsv.path));
  assert.ok(readFileSync(exportCsv.path, 'utf8').includes('chunk'));

  const exportParquet = await analysis.export(datasetSummary.id, 'parquet');
  assert.ok(existsSync(exportParquet.path));
  assert.ok(readFileSync(exportParquet.path).length > 100);

  store.close();
});
