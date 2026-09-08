const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { ProfileManager } = require('../dist/main/profile-manager');
const { TaskManager } = require('../dist/main/task-manager');
const { McpBridge } = require('../dist/main/mcp-bridge');
const { AuditLogger } = require('../dist/main/audit-logger');

function makeTempDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'hero-mcp-test-'));
}

test('TaskManager creates task, acquires lock and releases on completion', () => {
  const dir = makeTempDir();
  try {
    const profiles = new ProfileManager(dir);
    const tasks = new TaskManager(profiles);

    const task = tasks.createTask('instagram', 'task-101');
    assert.equal(task.id, 'task-101');
    assert.equal(task.profileId, 'instagram');
    assert.equal(task.status, 'RUNNING');
    assert.equal(profiles.isLocked('instagram'), true);
    assert.equal(profiles.getLockOwner('instagram'), 'task-101');

    // Second task trying to lock the same profile fails
    assert.throws(() => tasks.createTask('instagram', 'task-102'), { code: 'PROFILE_BUSY' });

    tasks.completeTask('task-101');
    assert.equal(tasks.getTask('task-101').status, 'COMPLETED');
    assert.equal(profiles.isLocked('instagram'), false);

    // Now another task can lock it
    const task2 = tasks.createTask('instagram', 'task-102');
    assert.equal(task2.status, 'RUNNING');
    assert.equal(profiles.isLocked('instagram'), true);

    tasks.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('TaskManager supports human-in-the-loop pause and resume', async () => {
  const dir = makeTempDir();
  try {
    const profiles = new ProfileManager(dir);
    const tasks = new TaskManager(profiles);

    let requestedIntervention = null;
    tasks.setInterventionListener(req => {
      requestedIntervention = req;
    });

    tasks.createTask('default', 'task-human-1');

    const response = tasks.requestHumanIntervention('task-human-1', {
      reason: 'CAPTCHA Challenge',
      message: 'Selesaikan puzzle di browser.',
      timeoutMs: 5000,
    });
    assert.equal(response.status, 'human_required');
    assert.ok(response.resumeToken);

    assert.ok(requestedIntervention);
    assert.equal(requestedIntervention.taskId, 'task-human-1');
    assert.equal(requestedIntervention.reason, 'CAPTCHA Challenge');
    assert.equal(tasks.getTask('task-human-1').status, 'WAITING_FOR_HUMAN');

    // Simulate human clicking "Continue" in browser UI
    const resumed = tasks.resumeHumanIntervention('task-human-1');
    assert.equal(resumed, true);


    assert.equal(tasks.getTask('task-human-1').status, 'RUNNING');
    assert.equal(requestedIntervention, null); // cleared listener

    tasks.completeTask('task-human-1');
    tasks.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('McpBridge provides secure local RPC and manages bridge file', async () => {
  const dir = makeTempDir();
  try {
    const profiles = new ProfileManager(dir);
    const tasks = new TaskManager(profiles);

    const mockBrowser = {
      snapshot: () => ({ activeProfileId: 'default', tabs: [{ id: 'tab-1', title: 'Home', url: 'https://example.com' }] }),
      createProfile: (name) => profiles.createProfile(name),
      switchProfile: (id) => profiles.switchProfile(id),
      newTab: () => {},
      execute: () => {},
      click: async () => {},
      type: async () => {},
      pressKey: async () => {},
      getDOM: async () => '<h1>Hello</h1>',
      extract: async () => [{ tag: 'h1', text: 'Hello', attributes: {} }],
      captureScreenshot: async () => 'base64image',
      waitFor: async () => true,
      scroll: async () => {},
    };

    const bridge = new McpBridge({
      userDataDir: dir,
      browser: mockBrowser,
      profiles,
      tasks,
    });

    const { port, token } = await bridge.start();
    const bridgeFile = path.join(dir, 'mcp-bridge.json');
    assert.equal(existsSync(bridgeFile), true);

    const fileContent = JSON.parse(readFileSync(bridgeFile, 'utf8'));
    assert.equal(fileContent.port, port);
    assert.equal(fileContent.token, token);

    // Test helper
    async function rpc(method, params = {}, authHeader = `Bearer ${token}`) {
      return new Promise((resolve, reject) => {
        const postData = JSON.stringify({ method, params });
        const headers = { 'Content-Type': 'application/json' };
        if (authHeader) headers['Authorization'] = authHeader;
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          path: '/rpc',
          method: 'POST',
          headers,
        }, res => {
          let raw = '';
          res.on('data', c => { raw += c; });
          res.on('end', () => {
            resolve({ statusCode: res.statusCode, body: JSON.parse(raw) });
          });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
      });
    }

    // 1. Unauthorized request fails
    const unauth = await rpc('ping', {}, 'Bearer invalid-token');
    assert.equal(unauth.statusCode, 401);

    // 2. Ping succeeds
    const pingRes = await rpc('ping');
    assert.equal(pingRes.statusCode, 200);
    assert.equal(pingRes.body.ok, true);
    assert.equal(pingRes.body.result.activeProfileId, 'default');

    // 3. Profiles list
    const profList = await rpc('profiles.list');
    assert.equal(profList.statusCode, 200);
    assert.ok(Array.isArray(profList.body.result));
    assert.ok(profList.body.result.some(p => p.id === 'default' && p.isActive));

    // 4. Task creation and lifecycle over RPC
    const taskRes = await rpc('tasks.create', { profileId: 'youtube', taskId: 'rpc-task-1' });
    assert.equal(taskRes.body.ok, true);
    assert.equal(taskRes.body.result.id, 'rpc-task-1');
    assert.equal(taskRes.body.result.status, 'RUNNING');

    const statusRes = await rpc('tasks.get', { taskId: 'rpc-task-1' });
    assert.equal(statusRes.body.result.status, 'RUNNING');

    await rpc('tasks.complete', { taskId: 'rpc-task-1' });
    const afterComplete = await rpc('tasks.get', { taskId: 'rpc-task-1' });
    assert.equal(afterComplete.body.result.status, 'COMPLETED');

    // Stop bridge
    bridge.stop();
    assert.equal(existsSync(bridgeFile), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AuditLogger scrubs secrets, records to audit.log, and emits activity events', () => {
  const dir = makeTempDir();
  try {
    const logger = new AuditLogger(dir);
    const events = [];
    logger.setActivityListener(ev => events.push(ev));

    // 1. Log with sensitive selector and password text
    logger.log({
      source: 'mcp',
      action: 'automation.type',
      params: { selector: '#user_password', text: 'SuperSecret123!' },
      status: 'SUCCESS',
      durationMs: 15,
      taskId: 'task-sec-1',
    });

    // 2. Log with URL containing token query parameter
    logger.log({
      source: 'mcp',
      action: 'tabs.navigate',
      params: { url: 'https://example.com/oauth/callback?code=secret_code_xyz&state=123' },
      status: 'SUCCESS',
      durationMs: 42,
      taskId: 'task-sec-1',
    });

    // Verify events emitted
    assert.equal(events.length, 2);
    assert.equal(events[0].status, 'success');
    assert.equal(events[0].action, 'automation.type');
    assert.ok(events[0].summary.includes('#user_password'));
    assert.equal(events[1].action, 'tabs.navigate');
    assert.ok(events[1].summary.includes('code=[REDACTED]'));

    // Verify audit.log on disk
    const logPath = path.join(dir, 'audit.log');
    assert.equal(existsSync(logPath), true);
    const lines = readFileSync(logPath, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(lines.length, 2);

    // Assert sensitive parameters are masked on disk
    assert.equal(lines[0].params.text, '••••••••');
    assert.ok(!lines[1].params.url.includes('secret_code_xyz'));
    assert.ok(lines[1].params.url.includes('code=[REDACTED]'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
