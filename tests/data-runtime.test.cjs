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

// Entity resolution, analytics, embeddings, job runner and data RPC (split from data.test.cjs).
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
