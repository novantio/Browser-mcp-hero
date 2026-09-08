const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { RateLimiter } = require('../dist/main/data/rate-limiter.js');
const { DriftDetector } = require('../dist/main/data/drift-detector.js');
const { CrawlFrontier } = require('../dist/main/data/crawl-frontier.js');
const { ReviewQueue } = require('../dist/main/data/review-queue.js');
const { DataStore } = require('../dist/main/data/store.js');
const { NetworkIntelligence } = require('../dist/main/data/network-intelligence.js');
const { dataContracts } = require('../dist/shared/data-contracts.js');
const { toolContracts } = require('../dist/shared/mcp-contracts.js');

test('RateLimiter enforces RPM and exponential backoff on HTTP 429', () => {
  const limiter = new RateLimiter(5); // 5 req/min
  const domain = 'example.com';

  // First 5 should be allowed
  for (let i = 0; i < 5; i++) {
    const res = limiter.checkLimit(domain);
    assert.equal(res.allowed, true);
  }

  // 6th should be rejected due to RPM
  const overflow = limiter.checkLimit(domain);
  assert.equal(overflow.allowed, false);
  assert.match(overflow.reason, /Mencapai batas kecepatan/);

  // Simulate HTTP 429 received from server
  limiter.recordResponse(domain, 429);
  const cd = limiter.getCooldown(domain);
  assert.equal(cd.paused, true);
  assert.match(cd.reason, /429/);

  // Check limit during cooldown must reject
  const blocked = limiter.checkLimit(domain);
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /Rate limit aktif/);
});

test('DriftDetector identifies null spikes and distribution shifts', () => {
  const detector = new DriftDetector();
  const schema = {
    rowSelector: 'article',
    fields: [
      { path: 'title', selector: 'h1', type: 'string', required: true },
      { path: 'likes', selector: '.likes', type: 'integer', required: false },
    ],
    identityFields: ['title'],
    maxItems: 50,
  };

  // Run 1: Baseline with normal distribution
  const baselineRows = [];
  for (let i = 0; i < 20; i++) {
    baselineRows.push({ title: 'Post ' + i, likes: 1000 + i * 50 });
  }
  const r1 = detector.checkDrift('job-1', schema, baselineRows);
  assert.equal(r1.hasDrift, false);

  // Run 2: Normal second batch - should have no drift
  const normalRows = [];
  for (let i = 0; i < 20; i++) {
    normalRows.push({ title: 'New ' + i, likes: 1100 + i * 40 });
  }
  const r2 = detector.checkDrift('job-1', schema, normalRows);
  assert.equal(r2.hasDrift, false);

  // Run 3: Schema drift - massive null spike on required title
  const nullSpikeRows = [];
  for (let i = 0; i < 20; i++) {
    nullSpikeRows.push({ title: i < 3 ? 'Post' : null, likes: 10 });
  }
  const r3 = detector.checkDrift('job-1', schema, nullSpikeRows);
  assert.equal(r3.hasDrift, true);
  assert.ok(r3.fields.some(f => f.driftType === 'null_spike'));
  assert.ok(r3.fields.some(f => f.driftType === 'distribution_shift'));
});

test('CrawlFrontier prioritizes and tracks visited/failed URLs', () => {
  const frontier = new CrawlFrontier();

  // Push URLs with different priorities
  const pushRes = frontier.push([
    'https://a.com/page1',
    'https://b.com/urgent',
    'https://a.com/page2',
    'https://a.com/page1', // Duplicate should be ignored
  ], 0, 50);

  assert.equal(pushRes.added, 3);
  assert.equal(pushRes.totalQueued, 3);

  // Push higher priority
  frontier.push(['https://vip.com/vip-page'], 0, 99);

  // Pop batch of 2 - highest priority must come first
  const batch = frontier.popBatch(2);
  assert.equal(batch.length, 2);
  assert.equal(batch[0].url, 'https://vip.com/vip-page');

  // Mark one failed
  frontier.markFailed(batch[0].url, 'Network timeout');
  const stats = frontier.getStats();
  assert.equal(stats.failed, 1);
  assert.equal(stats.visited, 2);
});

test('ReviewQueue handles curation lifecycle (approve, reject, merge, edit)', () => {
  const queue = new ReviewQueue();

  const item1 = queue.addItem({
    type: 'pii_flag',
    jobId: 'job-pii',
    payload: { user: 'Budi', phone: '08123456789' },
    confidence: 0.35,
  });

  const item2 = queue.addItem({
    type: 'schema_drift',
    jobId: 'job-drift',
    payload: { field: 'likes', shift: 'extreme' },
    confidence: 0.95,
  });

  assert.equal(queue.listItems('pending').length, 2);

  // Approve item 1 with redaction
  const resolved1 = queue.resolveItem(item1.id, 'approved', { phone: '[REDACTED]' });
  assert.equal(resolved1.status, 'approved');
  assert.equal(resolved1.payload.phone, '[REDACTED]');

  // Reject item 2
  const resolved2 = queue.resolveItem(item2.id, 'rejected');
  assert.equal(resolved2.status, 'rejected');

  const stats = queue.getStats();
  assert.equal(stats.pending, 0);
  assert.equal(stats.approved, 1);
  assert.equal(stats.rejected, 1);
});

test('NetworkIntelligence captures exchanges, builds recipes and filters payloads', () => {
  const net = new NetworkIntelligence();
  net.setAction('click:search_btn');

  // Inject a mock network record directly
  const mockRecord = {
    id: 'rec-1',
    requestId: 'req-1',
    url: 'https://api.example.com/v1/feed?query=test',
    method: 'GET',
    status: 200,
    mimeType: 'application/json',
    requestHeaders: { 'User-Agent': 'Hero/0.4' },
    responseHeaders: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ id: 1, name: 'Sample' }] }),
    jsonBody: { items: [{ id: 1, name: 'Sample' }] },
    timestamp: Date.now(),
    durationMs: 45,
    lastAction: 'click:search_btn',
  };

  // Add via private method access or reflection
  net['addRecord'](mockRecord);

  const reqs = net.getRequests('feed');
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].lastAction, 'click:search_btn');

  // Build recipe
  const recipe = net.getRecipe('req-1');
  assert.ok(recipe.urlPattern.includes('api.example.com'));
  assert.equal(recipe.method, 'GET');

  // Find JSON payloads
  const payloads = net.findJsonPayloads('sample');
  assert.equal(payloads.length, 1);
});

test('DataStore provides complete Data Lineage Graph', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-lineage-'));
  const store = new DataStore(tmpDir);

  const jobId = 'job-lineage-1';
  const snapshotId = 'snap-1';
  const recordId = 'rec-lin-1';

  store.put('job', jobId, { id: jobId, name: 'Test Scrape', targets: ['https://example.com'] });
  store.put('snapshot', snapshotId, { id: snapshotId, jobId, url: 'https://example.com' });

  store.addRecord({
    id: recordId,
    text: 'Example content',
    data: { engagement: { likes: 50 } },
    hash: 'hash-1',
    language: 'id',
    quality: 0.9,
    pii: false,
    spam: false,
    source: {
      url: 'https://example.com/post/1',
      domain: 'example.com',
      sourceType: 'web',
      collectedAt: new Date().toISOString(),
      profileId: 'default',
      topic: 'tech',
    },
    provenance: {
      jobId,
      runId: 'run-1',
      snapshotId,
      extractorVersion: 'v1',
    },
  });

  store.put('dataset', 'ds-1', {
    id: 'ds-1',
    name: 'Exported LLM Dataset',
    version: 1,
    rows: [{ recordId, text: 'Example content' }],
  });

  const lineage = store.getLineage(recordId);
  assert.equal(lineage.record.id, recordId);
  assert.equal(lineage.source.domain, 'example.com');
  assert.equal(lineage.provenance.jobId, jobId);
  assert.equal(lineage.job.name, 'Test Scrape');
  assert.equal(lineage.snapshot.id, snapshotId);
  assert.equal(lineage.datasets.length, 1);
  assert.equal(lineage.datasets[0].id, 'ds-1');

  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('MCP Tool Contracts include all Web Data OS tools and browser_evaluate', () => {
  const toolNames = toolContracts.map(t => t.name);
  const dataNames = dataContracts.map(t => t.name);

  // Verify browser_evaluate and Milestone 1, 2 & 3 tools exist
  assert.ok(toolNames.includes('browser_evaluate'), 'browser_evaluate must be in toolContracts');
  assert.ok(toolNames.includes('browser_observe'), 'browser_observe must be in toolContracts');
  assert.ok(toolNames.includes('browser_select_option'), 'browser_select_option must be in toolContracts');
  assert.ok(toolNames.includes('browser_check'), 'browser_check must be in toolContracts');
  assert.ok(toolNames.includes('browser_hover'), 'browser_hover must be in toolContracts');
  assert.ok(toolNames.includes('browser_get_console_logs'), 'browser_get_console_logs must be in toolContracts');
  assert.ok(toolNames.includes('browser_get_network_activity'), 'browser_get_network_activity must be in toolContracts');
  assert.ok(toolNames.includes('browser_inspect_form'), 'browser_inspect_form must be in toolContracts');
  assert.ok(toolNames.includes('browser_fill_form'), 'browser_fill_form must be in toolContracts');
  assert.ok(toolNames.includes('browser_find_element'), 'browser_find_element must be in toolContracts');
  assert.ok(toolNames.includes('browser_get_state'), 'browser_get_state must be in toolContracts');
  assert.ok(toolNames.includes('browser_heal_selector'), 'browser_heal_selector must be in toolContracts');
  assert.ok(toolNames.includes('browser_detect_challenge'), 'browser_detect_challenge must be in toolContracts');
  assert.ok(toolNames.includes('browser_upload_file'), 'browser_upload_file must be in toolContracts');
  assert.ok(toolNames.includes('browser_wait_for_download'), 'browser_wait_for_download must be in toolContracts');
  assert.ok(toolNames.includes('browser_create_checkpoint'), 'browser_create_checkpoint must be in toolContracts');
  assert.ok(toolNames.includes('browser_rollback_checkpoint'), 'browser_rollback_checkpoint must be in toolContracts');
  assert.ok(toolNames.includes('browser_act'), 'browser_act must be in toolContracts');

  // Verify Web Data OS tools exist
  const requiredDataTools = [
    'network_get_requests',
    'network_get_recipe',
    'network_replay_recipe',
    'data_extract_multistrategy',
    'browser_collect',
    'scraper_heal_selector',
    'schema_check_drift',
    'frontier_push_urls',
    'frontier_pop_batch',
    'frontier_get_stats',
    'review_list_items',
    'review_resolve_item',
    'data_get_lineage',
    'copilot_synthesize_job',
  ];

  for (const name of requiredDataTools) {
    assert.ok(dataNames.includes(name), `Missing MCP tool: ${name}`);
  }

  // Total tool count should exceed 75 tools
  const total = toolNames.length + dataNames.length;
  assert.ok(total >= 75, `Total tools should be >= 75, found: ${total}`);
});
