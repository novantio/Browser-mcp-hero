const path = require('node:path');
const fs = require('fs');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

(async () => {
  const client = new Client({ name: 'tiktok-multi-fetcher', version: '1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('dist/mcp/index.js')],
    cwd: process.cwd(),
    stderr: 'pipe',
  });
  await client.connect(transport);

  const call = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    if (res.isError) throw new Error(`Tool ${name} failed`);
    return res.structuredContent ? res.structuredContent.result : res;
  };

  // Clean up and start fresh task
  const tasks = await call('browser_list_tasks', {});
  for (const t of tasks) {
    if (t.status === 'RUNNING') try { await call('browser_complete_task', { taskId: t.id }); } catch {}
  }
  const task = await call('browser_start_task', { profileId: 'default' });
  const taskId = task.id;

  const netRequests = await call('network_get_requests', { taskId, limit: 100, filter: 'comment/list' });
  if (netRequests.length === 0) {
    console.log('No comment/list request found.');
    process.exit(1);
  }

  const baseReq = netRequests[0];
  console.log('Base request URL:', baseReq.url);
  console.log('Base request headers count:', Object.keys(baseReq.requestHeaders).length);

  // Let's test fetching next batches via cursor in the browser context using browser_evaluate!
  // In the browser context, fetch() automatically carries full cookies, CORS credentials, and TLS fingerprint!
  console.log('\nFetching next comment batches inside browser context...');

  const allComments = [];
  let cursor = 0;
  let totalInApi = 0;

  for (let page = 0; page < 6; page++) {
    const pageUrl = baseReq.url.replace(/cursor=\d+/, `cursor=${cursor}`);
    console.log(`Fetching page ${page + 1} with cursor=${cursor}...`);

    const result = await call('browser_evaluate', {
      taskId,
      script: `(async () => {
        try {
          const res = await fetch(${JSON.stringify(pageUrl)}, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
          });
          const json = await res.json();
          return {
            ok: true,
            total: json.total,
            has_more: json.has_more,
            cursor: json.cursor,
            comments: (json.comments || []).map(c => ({
              cid: c.cid,
              text: c.text,
              time: c.create_time,
              likes: c.digg_count,
              replies: c.reply_comment_total,
              user: {
                uid: c.user?.uid,
                username: c.user?.unique_id,
                nickname: c.user?.nickname,
                avatar: Boolean(c.user?.avatar_thumb?.url_list?.length),
                verified: Boolean(c.user?.custom_verify || c.user?.enterprise_verify_reason),
                secUid: c.user?.sec_uid,
                signature: c.user?.signature
              }
            }))
          };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      })()`
    });

    if (result && result.ok && Array.isArray(result.comments)) {
      totalInApi = result.total || totalInApi;
      allComments.push(...result.comments);
      console.log(`  Page ${page + 1} returned ${result.comments.length} comments. Next cursor: ${result.cursor}`);
      if (!result.has_more || result.comments.length === 0) break;
      cursor = result.cursor;
    } else {
      console.log(`  Page ${page + 1} fetch failed or rejected:`, result);
      break;
    }

    await new Promise(r => setTimeout(r, 1200));
  }

  console.log(`\n=== HASIL EKSTRAKSI SAMPEL BESAR ===`);
  console.log(`Total komentar di metadata TikTok: ${totalInApi}`);
  console.log(`Total komentar terkumpul dalam sampel analisis: ${allComments.length}`);

  // Save comments
  fs.writeFileSync('tiktok_full_sample_comments.json', JSON.stringify(allComments, null, 2), 'utf8');

  // Perform In-depth Bot & Account Analysis
  const userMap = new Map();
  const textMap = new Map();
  let defaultNumericBotPattern = 0;
  let emptyBioCount = 0;
  let singleLetterOrEmojiText = 0;
  let highRepetitionUsers = [];

  for (const c of allComments) {
    // Account analysis
    const u = c.user.username || '';
    if (!userMap.has(u)) {
      userMap.set(u, { count: 0, details: c.user, comments: [] });
    }
    const uData = userMap.get(u);
    uData.count++;
    uData.comments.push(c.text);

    if (/^user\d{7,}$/i.test(u)) {
      defaultNumericBotPattern++;
    }
    if (!c.user.signature) {
      emptyBioCount++;
    }

    // Text analysis
    const t = c.text.trim();
    textMap.set(t, (textMap.get(t) || 0) + 1);
    if (/^[\p{Extended_Pictographic}\s\d.,!?:;~-]{1,4}$/u.test(t)) {
      singleLetterOrEmojiText++;
    }
  }

  const uniqueUsersCount = userMap.size;
  const duplicateTexts = Array.from(textMap.entries()).filter(([t, count]) => count > 1);

  console.log(`\n--- Metrik Akun & Keunikan ---`);
  console.log(`Total Unik Akun: ${uniqueUsersCount} dari ${allComments.length} komentar (${(uniqueUsersCount / allComments.length * 100).toFixed(1)}%)`);
  console.log(`Akun dengan format default bot ("user12345678"): ${defaultNumericBotPattern} (${(defaultNumericBotPattern / allComments.length * 100).toFixed(1)}%)`);
  console.log(`Akun tanpa bio/signature: ${emptyBioCount} (${(emptyBioCount / allComments.length * 100).toFixed(1)}%)`);

  console.log(`\n--- Metrik Spam & Duplikasi Teks ---`);
  console.log(`Komentar duplikat teks persis: ${duplicateTexts.length}`);
  console.log(`Komentar hanya emoji/sangat singkat: ${singleLetterOrEmojiText} (${(singleLetterOrEmojiText / allComments.length * 100).toFixed(1)}%)`);

  // Multiple comments by same user
  const multiCommentUsers = Array.from(userMap.entries()).filter(([u, d]) => d.count > 1);
  console.log(`Pengguna yang berkomentar > 1 kali: ${multiCommentUsers.length}`);
  multiCommentUsers.forEach(([u, d]) => {
    console.log(` - @${u}: ${d.count}x komentar`);
  });

  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
