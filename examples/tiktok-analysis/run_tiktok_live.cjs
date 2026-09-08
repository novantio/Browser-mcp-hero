const path = require('node:path');
const fs = require('node:fs');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

function parseMetric(str) {
  if (!str) return 0;
  str = String(str).trim().toLowerCase().replace(',', '.');
  if (str.endsWith('k')) {
    return Math.round(parseFloat(str) * 1000);
  }
  if (str.endsWith('m')) {
    return Math.round(parseFloat(str) * 1000000);
  }
  const n = parseInt(str, 10);
  return isNaN(n) ? 0 : n;
}

(async () => {
  console.log('=== Menghubungkan ke Hero Browser yang Sedang Aktif via MCP ===');

  const client = new Client({ name: 'tiktok-runner', version: '1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('dist/mcp/index.js')],
    cwd: process.cwd(),
    stderr: 'pipe'
  });

  transport.stderr.on('data', d => {
    const s = d.toString().trim();
    if (!s.includes('EXPERIMENTAL')) console.log('[Hero MCP]', s);
  });

  await client.connect(transport);
  console.log('Terhubung ke MCP Server Hero Browser.');

  const raw = (name, args = {}) => client.callTool({ name, arguments: args });
  const call = async (name, args = {}) => {
    const res = await raw(name, args);
    if (res.isError) {
      throw new Error(`Tool ${name} gagal: ` + JSON.stringify(res.content));
    }
    return res.structuredContent ? res.structuredContent.result : res;
  };

  // Mulai task di Hero Browser
  console.log('1. Memulai Task di Hero Browser (profil: default)...');
  const task = await call('browser_start_task', { profileId: 'default' });
  const taskId = task.id;
  console.log('Task berhasil dimulai. ID:', taskId);

  try {
    // 2. Navigasi ke pencarian TikTok
    const searchUrl = 'https://www.tiktok.com/search?q=kulon%20progo';
    console.log(`2. Menavigasi tab Hero Browser ke: ${searchUrl}`);
    await call('browser_navigate', { taskId, url: searchUrl });

    console.log('Menunggu pemuatan halaman TikTok (12 detik)...');
    console.log('>> CATATAN: Anda dapat melihat jendela Hero Browser di layar Anda sekarang.');
    await new Promise(r => setTimeout(r, 12000));

    // Cek judul dan teks
    let domText = await call('browser_get_dom', { taskId, format: 'text', maxLength: 4000 });
    console.log('Cuplikan teks tab TikTok:', domText.slice(0, 350).replace(/\n+/g, ' | '));

    // Cari tautan video
    let links = await call('discovery_get_links', { taskId, keyword: '/video/', limit: 30 });
    console.log(`Tautan video ditemukan pada halaman pencarian: ${links.length}`);

    // Jika belum ada video (misal bot protection / captcha atau popup login)
    if (links.length === 0) {
      console.log('Mencoba klik tombol guest / dismiss dialog...');
      try { await call('browser_click', { taskId, text: 'Lanjutkan sebagai tamu' }); } catch {}
      try { await call('browser_click', { taskId, text: 'Continue as guest' }); } catch {}
      try { await call('browser_press_key', { taskId, key: 'Escape' }); } catch {}
      await call('browser_scroll', { taskId, direction: 'down', amount: 800 });
      await new Promise(r => setTimeout(r, 6000));
      links = await call('discovery_get_links', { taskId, keyword: '/video/', limit: 30 });
      console.log(`Setelah scroll & intervensi: ${links.length} tautan video.`);
    }

    // Jika pencarian /search diblokir atau kosong, coba halaman tag #kulonprogo
    if (links.length === 0) {
      console.log('Mencoba navigasi ke tag: https://www.tiktok.com/tag/kulonprogo ...');
      await call('browser_navigate', { taskId, url: 'https://www.tiktok.com/tag/kulonprogo' });
      await new Promise(r => setTimeout(r, 10000));
      links = await call('discovery_get_links', { taskId, keyword: '/video/', limit: 30 });
      console.log(`Tautan video dari tag: ${links.length}`);
    }

    // Filter link video unik
    const uniqueVideos = [];
    const seen = new Set();
    for (const l of links) {
      const clean = l.url.split('?')[0];
      if (!seen.has(clean) && clean.includes('/video/')) {
        seen.add(clean);
        uniqueVideos.push({
          url: clean,
          text: l.text || l.title || ''
        });
      }
      if (uniqueVideos.length >= 10) break;
    }

    console.log(`\n=== Ditemukan ${uniqueVideos.length} Video Teratas ===`);
    uniqueVideos.forEach((v, i) => console.log(`${i + 1}. ${v.url}`));

    // Kunjungi setiap video untuk membaca data detail (topik, creator, jumlah komentar)
    const videoDetails = [];

    for (let i = 0; i < uniqueVideos.length; i++) {
      const v = uniqueVideos[i];
      console.log(`\n[${i + 1}/${uniqueVideos.length}] Membuka video: ${v.url}`);
      try {
        await call('browser_navigate', { taskId, url: v.url });
        await new Promise(r => setTimeout(r, 5000));

        // Ekstrak username dari URL
        const m = v.url.match(/@([^/]+)\/video\/(\d+)/);
        const username = m ? '@' + m[1] : '@unknown';

        const pageText = await call('browser_get_dom', { taskId, format: 'text', maxLength: 10000 });
        const lines = pageText.split('\n').map(l => l.trim()).filter(Boolean);

        // Ambil caption/deskripsi video
        let caption = '';
        for (const line of lines) {
          if (line.length > 20 && !line.includes('Log masuk') && !line.includes('TikTok') && !caption) {
            caption = line;
          }
        }
        if (!caption && lines.length > 0) caption = lines.slice(0, 3).join(' ');

        // Ekstrak angka komentar
        let commentCount = 0;
        for (let j = 0; j < lines.length; j++) {
          const line = lines[j];
          if (/komentar|comment|balas/i.test(line)) {
            // Cek baris ini atau baris tetangga
            const surrounding = [lines[j - 1], line, lines[j + 1]].filter(Boolean).join(' ');
            const numMatch = surrounding.match(/(\d+([.,]\d+)?\s*(k|m)?)\s*(komentar|comment)/i) ||
                             line.match(/\d+([.,]\d+)?\s*(k|m)?/i);
            if (numMatch) {
              commentCount = parseMetric(numMatch[1] || numMatch[0]);
              break;
            }
          }
        }

        // Simpan data
        videoDetails.push({
          index: i + 1,
          url: v.url,
          username: username,
          topic: caption.slice(0, 250),
          commentCount: commentCount,
          previewText: lines.slice(0, 8).join(' | ')
        });

      } catch (err) {
        console.error(`Gagal mengekstrak video ${v.url}:`, err.message);
        videoDetails.push({
          index: i + 1,
          url: v.url,
          username: v.url.match(/@([^/]+)/)?.[1] ? '@' + v.url.match(/@([^/]+)/)[1] : '@unknown',
          topic: v.text || 'Konten Video Kulon Progo',
          commentCount: 0
        });
      }
    }

    // Hitung ringkasan
    const uniqueUsers = Array.from(new Set(videoDetails.map(v => v.username)));
    const totalComments = videoDetails.reduce((sum, v) => sum + (v.commentCount || 0), 0);

    const report = {
      keyword: 'kulon progo',
      analyzedAt: new Date().toISOString(),
      top10VideosCount: videoDetails.length,
      totalComments: totalComments,
      uniqueUsersCount: uniqueUsers.length,
      uniqueUsers: uniqueUsers,
      videos: videoDetails
    };

    console.log('\n======================================================');
    console.log('HASIL ANALISIS 10 VIDEO TIKTOK TERATAS: KULON PROGO');
    console.log('======================================================');
    console.log(`Jumlah Video Dianalisis : ${videoDetails.length}`);
    console.log(`Total Komentar          : ${totalComments}`);
    console.log(`Jumlah User Unik        : ${uniqueUsers.length} (${uniqueUsers.join(', ')})`);
    console.log('------------------------------------------------------');
    videoDetails.forEach(v => {
      console.log(`[#${v.index}] Creator : ${v.username}`);
      console.log(`      Komentar: ${v.commentCount}`);
      console.log(`      Topik   : ${v.topic}`);
      console.log(`      URL     : ${v.url}`);
    });
    console.log('======================================================\n');

    fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync('test-results/tiktok_kulon_progo_report.json', JSON.stringify(report, null, 2));
    console.log('Laporan berhasil disimpan ke test-results/tiktok_kulon_progo_report.json');

  } finally {
    // Selesaikan task agar browser tidak terus terkunci
    await call('browser_complete_task', { taskId }).catch(() => {});
    console.log('Task browser dilepaskan (COMPLETED).');
    process.exit(0);
  }
})().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
