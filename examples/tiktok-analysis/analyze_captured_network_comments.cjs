const path = require('node:path');
const fs = require('fs');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

(async () => {
  const client = new Client({ name: 'network-comment-analyzer', version: '1.0' });
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
  const activeTask = tasks[0];
  const taskId = activeTask ? activeTask.id : 'task-default';

  console.log('Retrieving all intercepted comment/list network requests...');
  const netRequests = await call('network_get_requests', { taskId, limit: 100, filter: 'comment/list' });
  console.log(`Total intercepted comment/list requests: ${netRequests.length}`);

  const commentsMap = new Map();
  let totalApiReported = 0;

  for (let i = 0; i < netRequests.length; i++) {
    const req = netRequests[i];
    const json = req.jsonBody || (req.body ? (() => { try { return JSON.parse(req.body); } catch { return null; } })() : null);
    if (json && Array.isArray(json.comments)) {
      totalApiReported = json.total || totalApiReported;
      for (const c of json.comments) {
        if (!commentsMap.has(c.cid)) {
          commentsMap.set(c.cid, {
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
              signature: c.user?.signature || '',
              secUid: c.user?.sec_uid,
              isVerified: Boolean(c.user?.custom_verify || c.user?.enterprise_verify_reason)
            }
          });
        }
      }
    }
  }

  const allComments = Array.from(commentsMap.values());
  console.log(`\n======================================================`);
  console.log(`HASIL EKSTRAKSI DARI INTERSEPT NETWORK INTELLIGENCE`);
  console.log(`======================================================`);
  console.log(`Total Komentar di Database TikTok (API total): ${totalApiReported}`);
  console.log(`Total Komentar Unik Terkumpul di Sampel Intersep: ${allComments.length}`);

  // 1. Analisis Keunikan Akun
  const userFrequency = new Map();
  let defaultBotUsernameCount = 0; // pattern user123456...
  let emptyBioCount = 0;
  let verifiedCount = 0;
  let numericUsernameCount = 0;

  for (const c of allComments) {
    const u = c.user.username || c.user.uid || 'anon';
    userFrequency.set(u, (userFrequency.get(u) || 0) + 1);

    if (/^user\d{6,}$/i.test(c.user.username)) {
      defaultBotUsernameCount++;
    }
    if (/^\d+$/.test(c.user.username)) {
      numericUsernameCount++;
    }
    if (!c.user.signature || c.user.signature.trim() === '') {
      emptyBioCount++;
    }
    if (c.user.isVerified) {
      verifiedCount++;
    }
  }

  const totalUniqueAccounts = userFrequency.size;
  const uniqueAccountRatio = ((totalUniqueAccounts / allComments.length) * 100).toFixed(2);

  // 2. Analisis Konten Teks & Duplikasi
  const textFrequency = new Map();
  let emojiOnlyCount = 0;
  let shortReactionCount = 0;
  let contextualDiscussionCount = 0;
  let politicalOrReligiousMentionCount = 0;
  let humorAppreciationCount = 0;

  for (const c of allComments) {
    const t = c.text.trim();
    textFrequency.set(t, (textFrequency.get(t) || 0) + 1);

    // Emoji-only regex
    if (/^[\p{Extended_Pictographic}\s\d.,!?:;~-]{1,6}$/u.test(t)) {
      emojiOnlyCount++;
    } else if (t.length <= 10) {
      shortReactionCount++;
    } else {
      contextualDiscussionCount++;
    }

    const tLower = t.toLowerCase();
    if (tLower.includes('korupsi') || tLower.includes('uang rakyat') || tLower.includes('pejabat') || tLower.includes('babi') || tLower.includes('halal') || tLower.includes('islam') || tLower.includes('kristen')) {
      politicalOrReligiousMentionCount++;
    }
    if (tLower.includes('lucu') || tLower.includes('ngakak') || tLower.includes('wkwk') || tLower.includes('😂') || tLower.includes('😭') || tLower.includes('🗿') || tLower.includes('juara') || tLower.includes('pace') || tLower.includes('kucil')) {
      humorAppreciationCount++;
    }
  }

  const duplicateTexts = Array.from(textFrequency.entries())
    .filter(([txt, count]) => count > 1)
    .sort((a, b) => b[1] - a[1]);

  // 3. Analisis Waktu (Timestamp clustering)
  const timestamps = allComments.map(c => c.time).sort((a, b) => a - b);
  const earliest = new Date(timestamps[0] * 1000).toISOString();
  const latest = new Date(timestamps[timestamps.length - 1] * 1000).toISOString();

  // Hitung komentar berulang oleh akun yang sama
  const multiCommentUsers = Array.from(userFrequency.entries())
    .filter(([u, cnt]) => cnt > 1)
    .sort((a, b) => b[1] - a[1]);

  console.log(`\n--- 1. METRIK KEUNIKAN AKUN ---`);
  console.log(`- Jumlah Sampel Komentar: ${allComments.length}`);
  console.log(`- Jumlah Akun Unik: ${totalUniqueAccounts}`);
  console.log(`- Rasio Akun Unik: ${uniqueAccountRatio}% (artinya ${allComments.length - totalUniqueAccounts} komentar berasal dari user yang sama)`);
  console.log(`- User dengan >1 komentar: ${multiCommentUsers.length}`);
  if (multiCommentUsers.length > 0) {
    multiCommentUsers.slice(0, 5).forEach(([u, cnt]) => console.log(`   * @${u}: ${cnt} komentar`));
  }

  console.log(`\n--- 2. INDIKASI BOT & POLA AKUN ---`);
  console.log(`- Akun berpola ID default bot ("user12345678"): ${defaultBotUsernameCount} (${((defaultBotUsernameCount / allComments.length) * 100).toFixed(2)}%)`);
  console.log(`- Akun dengan username murni angka: ${numericUsernameCount}`);
  console.log(`- Akun tanpa bio/signature: ${emptyBioCount} (${((emptyBioCount / allComments.length) * 100).toFixed(2)}%)`);
  console.log(`- Akun verified/centang: ${verifiedCount}`);

  console.log(`\n--- 3. ANALISIS KONTEN KOMENTAR ---`);
  console.log(`- Komentar duplikat (teks persis sama): ${duplicateTexts.length}`);
  if (duplicateTexts.length > 0) {
    console.log(`   Top teks duplikat:`);
    duplicateTexts.slice(0, 5).forEach(([txt, cnt]) => console.log(`   * "${txt}": ${cnt}x`));
  }
  console.log(`- Komentar hanya emoji: ${emojiOnlyCount} (${((emojiOnlyCount / allComments.length) * 100).toFixed(2)}%)`);
  console.log(`- Komentar reaksi sangat singkat (<=10 huruf): ${shortReactionCount} (${((shortReactionCount / allComments.length) * 100).toFixed(2)}%)`);
  console.log(`- Komentar kontekstual panjang: ${contextualDiscussionCount} (${((contextualDiscussionCount / allComments.length) * 100).toFixed(2)}%)`);
  console.log(`- Komentar mengangkat tema satir sosial / korupsi / dialog video: ${politicalOrReligiousMentionCount} (${((politicalOrReligiousMentionCount / allComments.length) * 100).toFixed(2)}%)`);
  console.log(`- Komentar apresiasi humor/tertawa: ${humorAppreciationCount} (${((humorAppreciationCount / allComments.length) * 100).toFixed(2)}%)`);

  console.log(`\n--- 4. DISTRIBUSI WAKTU KOMENTAR ---`);
  console.log(`- Rentang waktu sampel: ${earliest} s.d. ${latest}`);

  // Simpan hasil ke file JSON lengkap
  fs.writeFileSync('tiktok_comprehensive_analysis.json', JSON.stringify({
    summary: {
      totalApiReported,
      sampleSize: allComments.length,
      totalUniqueAccounts,
      uniqueAccountRatio: parseFloat(uniqueAccountRatio),
      defaultBotUsernameCount,
      emptyBioCount,
      duplicateTextsCount: duplicateTexts.length,
      emojiOnlyCount,
      contextualDiscussionCount,
      earliestTimestamp: earliest,
      latestTimestamp: latest
    },
    sampleComments: allComments.slice(0, 30)
  }, null, 2), 'utf8');

  console.log('\nData lengkap tersimpan di tiktok_comprehensive_analysis.json');
  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
