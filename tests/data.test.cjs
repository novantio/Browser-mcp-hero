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

test('entity resolution and canonical linking with reviewed evidence', () => {
  const { store, analysis } = setup();

  // Create candidate records
  store.addRecord({
    id: 'r_alias_1',
    text: 'Postingan dari John Doe mengenai teknologi',
    data: { author: 'John Doe' },
    hash: 'h_a1',
    language: 'id',
    quality: 0.9,
    pii: false,
    spam: false,
    source: { url: 'https://example.com/1', domain: 'example.com', sourceType: 'web', collectedAt: '2026-09-08T10:00:00Z', profileId: 'default', topic: 'tech' },
    provenance: { jobId: 'j', runId: 'r', snapshotId: 's', extractorVersion: 'v1' },
  });

  // Link canonical entity
  const entity = analysis.link({
    name: 'John Doe',
    aliases: ['@john_doe', 'john.doe', 'John Doe'],
    recordIds: ['r_alias_1'],
    evidence: 'Verified matching personal domain and handle',
    reviewed: true,
  });
  assert.equal(entity.name, 'John Doe');

  // Query candidate aliases
  const candidates = analysis.candidates('@john_doe');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].confidence, 0.95);

  const updatedRec = store.record('r_alias_1');
  assert.equal(updatedRec.entityId, entity.id);

  store.close();
});

test('analytics computes temporal trends, interaction graph, and anomaly detection', () => {
  const { store, analysis } = setup();

  for (let i = 0; i < 25; i++) {
    const isSpike = i === 20;
    const count = isSpike ? 80 : 5;
    for (let c = 0; c < count; c++) {
      store.addRecord({
        id: `rec-${i}-${c}`,
        text: `Post #${i} mentioning @alice and @bob with hashtag #webai and link https://news.example.com/article-${i}`,
        data: { username: '@source_user' },
        hash: hash(`content-${i}-${c}`),
        language: 'en',
        quality: 0.8,
        pii: false,
        spam: false,
        source: { url: 'https://example.com', domain: 'example.com', sourceType: 'web', collectedAt: `2026-09-08T${String(10 + Math.floor(i / 3)).padStart(2, '0')}:00:00Z`, profileId: 'default', topic: 'brand' },
        provenance: { jobId: 'j1', runId: 'r1', snapshotId: 's1', extractorVersion: 'v1' },
      });
    }
  }

  // Analytics & anomalies
  const report = analysis.analytics({ topic: 'brand' });
  assert.ok(report.trends.length > 0);
  assert.ok(report.anomalies.length > 0);
  assert.ok(report.anomalies[0].score > 0.5);

  // Interaction graph
  const graph = analysis.graph({ topic: 'brand' });
  assert.ok(graph.nodes.includes('@alice'));
  assert.ok(graph.nodes.includes('@bob'));
  assert.ok(graph.nodes.includes('#webai'));
  assert.ok(graph.edges.some(e => e.kind === 'mentions'));
  assert.ok(graph.edges.some(e => e.kind === 'hashtag'));

  store.close();
});

test('vector embeddings and semantic search cosine similarity', () => {
  const { store, analysis } = setup();

  store.addRecord({
    id: 'rec_vec_1',
    text: 'Artificial intelligence and neural networks',
    data: {},
    hash: 'v1',
    language: 'en',
    quality: 0.9,
    pii: false,
    spam: false,
    source: { url: 'https://example.com/1', domain: 'example.com', sourceType: 'web', collectedAt: '2026-09-08T10:00:00Z', profileId: 'default', topic: 'ai' },
    provenance: { jobId: 'j', runId: 'r', snapshotId: 's', extractorVersion: 'v1' },
  });

  store.addRecord({
    id: 'rec_vec_2',
    text: 'Cooking recipes and culinary arts',
    data: {},
    hash: 'v2',
    language: 'en',
    quality: 0.9,
    pii: false,
    spam: false,
    source: { url: 'https://example.com/2', domain: 'example.com', sourceType: 'web', collectedAt: '2026-09-08T10:00:00Z', profileId: 'default', topic: 'food' },
    provenance: { jobId: 'j', runId: 'r', snapshotId: 's', extractorVersion: 'v1' },
  });

  analysis.embeddings('test-embed-v1', [
    { recordId: 'rec_vec_1', vector: [0.95, 0.05, 0.88] },
    { recordId: 'rec_vec_2', vector: [0.05, 0.92, 0.10] },
  ]);

  const queryAi = analysis.semantic('test-embed-v1', [0.90, 0.10, 0.85], 5);
  assert.equal(queryAi.length, 2);
  assert.equal(queryAi[0].record.id, 'rec_vec_1');
  assert.ok(queryAi[0].score > queryAi[1].score);

  store.close();
});

test('JobRunner manages job lifecycle and interaction recorder converts to job', () => {
  const { store, profiles, tasks } = setup();
  // Mock browser
  const mockBrowser = {
    getActiveWebContents: () => ({
      getURL: () => 'https://example.com',
      on: () => {},
      off: () => {},
      executeJavaScript: async () => [],
    }),
    execute: () => {},
    click: async () => {},
    type: async () => {},
    scroll: async () => {},
    waitFor: async () => true,
    extractSchema: async () => [],
    getDOM: async () => '<html></html>',
    switchProfile: () => {},
  };

  const runner = new JobRunner(store, mockBrowser, tasks, profiles);
  const recorder = new InteractionRecorder(store, mockBrowser, profiles, runner);

  const job = runner.createJob({
    name: 'Test Scrape Job',
    profileId: 'default',
    targets: ['https://example.com/posts'],
    schema: {
      rowSelector: 'article',
      fields: [{ path: 'title', selector: 'h2', type: 'string', required: true }],
      identityFields: ['title'],
      maxItems: 50,
    },
    steps: [{ action: 'navigate', url: 'https://example.com/posts' }, { action: 'extract' }],
    intervalMinutes: 60,
    topic: 'news',
    sourceType: 'web',
    captureScreenshot: false,
  });

  assert.equal(job.name, 'Test Scrape Job');
  assert.equal(job.status, 'idle');
  assert.ok(job.nextRunAt > Date.now());

  const listed = runner.listJobs();
  assert.equal(listed.length, 1);

  // Pause, resume, cancel
  const paused = runner.pauseJob(job.id);
  assert.equal(paused.status, 'idle'); // not running yet
  const cancelled = runner.cancelJob(job.id);
  assert.equal(cancelled.status, 'cancelled');

  // Recorder conversion
  store.put('recording', 'rec_demo', {
    id: 'rec_demo',
    name: 'Manual Browsing Flow',
    profileId: 'default',
    steps: [
      { action: 'navigate', url: 'https://example.com/browse' },
      { action: 'click', selector: '.view-more' },
    ],
    status: 'stopped',
    createdAt: Date.now(),
    omitted: 0,
  });

  const convertedJob = recorder.convert('rec_demo', job.schema, 'Scraper from Rec', 120);
  assert.equal(convertedJob.name, 'Scraper from Rec');
  assert.equal(convertedJob.targets[0], 'https://example.com/browse');
  assert.ok(convertedJob.steps.some(s => s.action === 'extract'));

  runner.stopScheduler();
  store.close();
});

test('McpBridge dispatches data contracts via authenticated RPC', async () => {
  const { dir, store, profiles, tasks, analysis } = setup();
  const mockBrowser = {
    snapshot: () => ({ tabs: [], activeTabId: '', profiles: [], activeProfileId: 'default', persistent: true }),
    getActiveWebContents: () => ({ getURL: () => 'https://example.com', on: () => {}, off: () => {}, executeJavaScript: async () => [] }),
  };
  const jobRunner = new JobRunner(store, mockBrowser, tasks, profiles);
  const recorder = new InteractionRecorder(store, mockBrowser, profiles, jobRunner);

  const bridge = new McpBridge({
    userDataDir: dir,
    browser: mockBrowser,
    profiles,
    tasks,
    store,
    jobRunner,
    analysis,
    recorder,
  });

  const { port, token } = await bridge.start();

  // Test data.overview
  const overview = await requestRpc(port, token, 'data.overview', {});
  assert.equal(overview.jobs, 0);

  // Test data.createJob
  const created = await requestRpc(port, token, 'data.createJob', {
    name: 'RPC Created Job',
    profileId: 'default',
    targets: ['https://example.com/feed'],
    schema: {
      rowSelector: 'item',
      fields: [{ path: 'headline', selector: 'h1', type: 'string', required: true }],
      identityFields: ['headline'],
      maxItems: 20,
    },
    steps: [],
  });
  assert.equal(created.name, 'RPC Created Job');
  assert.equal(created.status, 'idle');

  // Test data.listJobs
  const jobs = await requestRpc(port, token, 'data.listJobs', {});
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].name, 'RPC Created Job');

  // Test data.search
  const searchResult = await requestRpc(port, token, 'data.search', { query: 'test' });
  assert.equal(searchResult.total, 0);

  bridge.stop();
  jobRunner.stopScheduler();
  store.close();
});
