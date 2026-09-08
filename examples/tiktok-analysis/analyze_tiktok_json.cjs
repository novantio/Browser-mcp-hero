const path = require('node:path');
const fs = require('node:fs');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

(async () => {
  const client = new Client({ name: 'tiktok-json-analyzer', version: '1.0' });
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
  const activeTask = tasks.find(t => t.status === 'RUNNING') || tasks[0];
  const taskId = activeTask ? activeTask.id : 'task-default';

  // Get network requests from the intelligence store
  const netRequests = await call('network_get_requests', { taskId, limit: 100, filter: 'comment/list' });
  console.log('Matching requests found:', netRequests.length);

  let allParsedComments = [];
  let totalCommentsInApi = 0;

  for (const req of netRequests) {
    const json = req.jsonBody || (req.body ? (() => { try { return JSON.parse(req.body); } catch { return null; } })() : null);
    if (json) {
      totalCommentsInApi = json.total || totalCommentsInApi;
      if (Array.isArray(json.comments)) {
        console.log(`Request has ${json.comments.length} comments. Has more: ${json.has_more}, cursor: ${json.cursor}, total: ${json.total}`);
        for (const c of json.comments) {
          allParsedComments.push({
            cid: c.cid,
            text: c.text,
            time: c.create_time,
            likes: c.digg_count,
            replies: c.reply_comment_total,
            user: {
              uid: c.user?.uid,
              username: c.user?.unique_id,
              nickname: c.user?.nickname,
              verified: c.user?.custom_verify || c.user?.enterprise_verify_reason || false,
              avatar: Boolean(c.user?.avatar_thumb?.url_list?.length),
              signature: c.user?.signature
            }
          });
        }
      }
    }
  }

  console.log('\n=== PARSED COMMENTS DUMP ===');
  console.log(`Total comments in API metadata: ${totalCommentsInApi}`);
  console.log(`Total comments parsed: ${allParsedComments.length}`);

  fs.writeFileSync('tiktok_api_comments.json', JSON.stringify(allParsedComments, null, 2), 'utf8');
  console.log('Saved parsed comments to tiktok_api_comments.json');

  // Let's print out the full data for the first 10 comments
  console.log('\nSample 10 comments:');
  allParsedComments.slice(0, 10).forEach((c, idx) => {
    console.log(`\n[#${idx + 1}] User: @${c.user.username} ("${c.user.nickname}") | UID: ${c.user.uid}`);
    console.log(`    Text: "${c.text}"`);
    console.log(`    Likes: ${c.likes} | Replies: ${c.replies} | Timestamp: ${new Date(c.time * 1000).toISOString()}`);
  });

  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
