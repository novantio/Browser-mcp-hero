const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

(async () => {
  const client = new Client({ name: 'tiktok-comment-inspector', version: '1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('dist/mcp/index.js')],
    cwd: process.cwd(),
    stderr: 'pipe',
  });

  await client.connect(transport);

  const call = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    if (res.isError) throw new Error(`Tool ${name} failed: ` + JSON.stringify(res.content));
    return res.structuredContent ? res.structuredContent.result : res;
  };

  const tasks = await call('browser_list_tasks', {});
  for (const t of tasks) {
    if (t.status === 'RUNNING') try { await call('browser_complete_task', { taskId: t.id }); } catch {}
  }

  const task = await call('browser_start_task', { profileId: 'default' });
  const taskId = task.id;

  const targetUrl = 'https://www.tiktok.com/@madkucil/video/7672273354140945682?_r=1&_t=ZS-99YIw48bjKn';
  console.log('Navigating back to target video:', targetUrl);
  await call('browser_navigate', { taskId, url: targetUrl });
  await new Promise(r => setTimeout(r, 10000));

  // Click the comment icon to open comments panel
  console.log('Clicking comment button...');
  await call('browser_evaluate', {
    taskId,
    script: `(() => {
      const btn = document.querySelector('[data-e2e="comment-icon"]');
      if (btn) btn.click();
      return Boolean(btn);
    })()`
  });

  await new Promise(r => setTimeout(r, 5000));

  // Now inspect network requests
  const netRequests = await call('network_get_requests', { taskId, limit: 100, filter: '' });
  console.log('Total network requests recorded:', netRequests.length);

  const commentReqs = netRequests.filter(r => String(r.url).includes('comment'));
  console.log('Comment related requests:', commentReqs.length);
  for (const cr of commentReqs) {
    console.log(`URL: ${cr.url}`);
    if (cr.body) {
      console.log('Response body preview:', cr.body.slice(0, 300));
    }
  }

  // Get DOM text of the comments
  const dom = await call('browser_get_dom', { taskId, format: 'text', maxLength: 100000 });
  const cIdx = dom.indexOf('17.1K comments') !== -1 ? dom.indexOf('17.1K comments') : dom.indexOf('Comments');
  if (cIdx !== -1) {
    const commentSection = dom.slice(cIdx);
    console.log('Captured comment section text length:', commentSection.length);
    const fs = require('fs');
    fs.writeFileSync('video_comments.txt', commentSection, 'utf8');
    console.log('Saved to video_comments.txt');
  }

  await call('browser_complete_task', { taskId });
  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
