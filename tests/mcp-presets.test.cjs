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
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createHeroMcpServer } = require('../dist/mcp');

function makeTempDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'hero-mcp-test-'));
}

// Task TTL / auto-resume and MCP tool presets (split from mcp.test.cjs).
test('TaskManager auto-releases stale locks on inactivity TTL and supports multi-agent resumption', async () => {
  const dir = makeTempDir();
  try {
    const profiles = new ProfileManager(dir);
    const tasks = new TaskManager(profiles);

    // Agent A creates task with 1 second TTL and 10 second retention
    const taskA = tasks.createTask('instagram', 'task-agent-a', 1, 10);
    assert.equal(taskA.ttlMs, 1000);
    assert.equal(taskA.retentionMs, 10000);
    assert.equal(profiles.isLocked('instagram'), true);

    // Sleep past TTL and sweep
    await new Promise(resolve => setTimeout(resolve, 3500));

    // Profile should now be unlocked and task PAUSED (retained in memory)
    const pausedTaskA = tasks.getTask('task-agent-a');
    assert.equal(pausedTaskA.status, 'PAUSED');
    assert.ok(pausedTaskA.error.includes('inactivity timeout'));
    assert.equal(profiles.isLocked('instagram'), false);

    // Agent B can now start task 2 on instagram profile
    const taskB = tasks.createTask('instagram', 'task-agent-b', 120);
    assert.equal(taskB.status, 'RUNNING');
    assert.equal(profiles.isLocked('instagram'), true);
    assert.equal(profiles.getLockOwner('instagram'), 'task-agent-b');

    // Agent B completes task 2
    tasks.completeTask('task-agent-b');
    assert.equal(profiles.isLocked('instagram'), false);

    // Agent A can now continue/resume task 1!
    const resumedTaskA = tasks.resumeTask('task-agent-a');
    assert.equal(resumedTaskA.status, 'RUNNING');
    assert.equal(profiles.isLocked('instagram'), true);
    assert.equal(profiles.getLockOwner('instagram'), 'task-agent-a');

    tasks.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('TaskManager supports seamless auto-resume on action call and fails on retention expiration', async () => {
  const dir = makeTempDir();
  try {
    const profiles = new ProfileManager(dir);
    const tasks = new TaskManager(profiles);

    // Create task with 1s TTL and 2s retention
    tasks.createTask('default', 'task-retention-test', 1, 2);
    assert.equal(profiles.isLocked('default'), true);

    // Wait 1100ms past 1s TTL and sweep
    await new Promise(resolve => setTimeout(resolve, 1100));
    tasks.sweepExpiredTasks();

    // Task should be PAUSED for inactivity, lock released
    assert.equal(tasks.getTask('task-retention-test').status, 'PAUSED');
    assert.equal(profiles.isLocked('default'), false);

    // Agent A calls assertRunnable directly on task -> auto-resumes!
    const running = tasks.assertRunnable('task-retention-test');
    assert.equal(running.status, 'RUNNING');
    assert.equal(profiles.isLocked('default'), true);

    // Wait 2100ms past 2s retention and sweep
    await new Promise(resolve => setTimeout(resolve, 2100));
    tasks.sweepExpiredTasks();

    const expired = tasks.getTask('task-retention-test');
    assert.equal(expired.status, 'FAILED');
    assert.ok(expired.error.includes('Waktu retensi tugas'));
    assert.equal(profiles.isLocked('default'), false);

    tasks.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Hero MCP Server defaults to the lean "core" preset and supports runtime preset switching', async () => {
  const server = createHeroMcpServer();
  const client = new Client({ name: 'preset-test-client', version: '1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    // 1. By default only the lean 'core' preset is visible
    const initialList = await client.listTools();
    assert.equal(initialList.tools.length, 33);
    for (const name of ['browser_read_text', 'browser_act', 'browser_fill_form', 'browser_restart_app']) assert.ok(initialList.tools.some(tool => tool.name === name), name);

    // 2. browser_get_tool_preset returns activePreset: 'core'
    const getPresetRes = await client.callTool({ name: 'browser_get_tool_preset', arguments: {} });
    assert.ok(!getPresetRes.isError);
    const parsedGet = JSON.parse(getPresetRes.content[0].text);
    assert.equal(parsedGet.result.activePreset, 'core');
    assert.equal(parsedGet.result.totalToolsCount, 113);

    // 2b. 'all' exposes every tool, including engine management
    await client.callTool({ name: 'browser_set_tool_preset', arguments: { preset: 'all' } });
    const allList = await client.listTools();
    assert.equal(allList.tools.length, 113);
    for (const name of ['browser_get_engine_status', 'browser_check_engine_update']) assert.ok(allList.tools.some(tool => tool.name === name));

    // 3. Agent switches to 'core' preset
    const setCoreRes = await client.callTool({ name: 'browser_set_tool_preset', arguments: { preset: 'core' } });
    assert.ok(!setCoreRes.isError);
    const parsedSetCore = JSON.parse(setCoreRes.content[0].text);
    assert.equal(parsedSetCore.result.activePreset, 'core');
    assert.equal(parsedSetCore.result.enabledToolsCount, 33);

    // Verify client tools list updated to 33 tools
    const coreList = await client.listTools();
    assert.equal(coreList.tools.length, 33);
    assert.ok(coreList.tools.some(t => t.name === 'browser_navigate'));
    assert.ok(coreList.tools.some(t => t.name === 'browser_click'));
    assert.ok(coreList.tools.some(t => t.name === 'browser_screenshot'));
    assert.ok(coreList.tools.some(t => t.name === 'browser_set_tool_preset'));
    // Heavy scraping tools should now be disabled
    assert.equal(coreList.tools.some(t => t.name === 'data_get_overview'), false);
    assert.equal(coreList.tools.some(t => t.name === 'scrape_create_job'), false);

    // 4. Agent adds customInclude and customExclude on top of preset
    await client.callTool({
      name: 'browser_set_tool_preset',
      arguments: { preset: 'core', customInclude: ['browser_get_cookies'], customExclude: ['browser_scroll'] },
    });
    const customList = await client.listTools();
    assert.equal(customList.tools.length, 33); // +1 cookie, -1 scroll
    assert.ok(customList.tools.some(t => t.name === 'browser_get_cookies'));
    assert.equal(customList.tools.some(t => t.name === 'browser_scroll'), false);

    // 5. Agent switches to 'automation' preset
    await client.callTool({ name: 'browser_set_tool_preset', arguments: { preset: 'automation' } });
    const autoList = await client.listTools();
    assert.equal(autoList.tools.length, 63);
    assert.ok(autoList.tools.some(t => t.name === 'browser_drag_and_drop'));
    assert.ok(autoList.tools.some(t => t.name === 'browser_heal_selector'));
    assert.equal(autoList.tools.some(t => t.name === 'data_get_overview'), false);

    // 6. Agent switches back to 'all'
    await client.callTool({ name: 'browser_set_tool_preset', arguments: { preset: 'all' } });
    const fullList = await client.listTools();
    assert.equal(fullList.tools.length, 113);

  } finally {
    await client.close();
    await server.close();
  }
});


test('MCP clients receive server instructions that steer agents to Hero instead of Playwright', async () => {
  const server = createHeroMcpServer();
  const client = new Client({ name: 'instructions-test', version: '1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const instructions = client.getInstructions();
    assert.ok(instructions && instructions.length < 3000, 'instructions exist and stay short');
    for (const phrase of ['not Playwright', 'browser_start_task', 'browser_read_text', 'browser_request_human_intervention']) {
      assert.ok(instructions.includes(phrase), phrase);
    }
  } finally {
    await client.close();
    await server.close();
  }
});
