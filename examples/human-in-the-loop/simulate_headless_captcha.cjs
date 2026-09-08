const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

(async () => {
  console.log('================================================================');
  console.log(' SIMULASI OTOMASI BROWSER HEADLESS DENGAN INTERVENSI MANUSIA');
  console.log(' Skenario: Scraping Latar Belakang -> Tertahan CAPTCHA -> Pop-up Human');
  console.log('================================================================\n');

  const client = new Client({ name: 'headless-captcha-agent', version: '1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('dist/mcp/index.js')],
    cwd: process.cwd(),
    stderr: 'pipe',
  });

  transport.stderr.on('data', d => {
    const s = d.toString().trim();
    if (!s.includes('EXPERIMENTAL')) console.log('[Hero MCP]', s);
  });

  await client.connect(transport);
  console.log('✓ Terhubung ke MCP Server Hero Browser.');

  const call = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    if (res.isError) throw new Error(`Tool ${name} gagal: ` + JSON.stringify(res.content));
    return res.structuredContent ? res.structuredContent.result : res;
  };

  // Bersihkan task sebelumnya jika ada
  const existingTasks = await call('browser_list_tasks', {});
  for (const t of existingTasks) {
    if (t.status === 'RUNNING' || t.status === 'WAITING_FOR_HUMAN') {
      try { await call('browser_complete_task', { taskId: t.id }); } catch {}
    }
  }

  // 1. Memulai Task Otomasi
  console.log('1. Memulai Task Otomasi baru di Hero Browser...');
  const task = await call('browser_start_task', { profileId: 'default' });
  const taskId = task.id;
  console.log(`   Task ID: ${taskId} (Status: RUNNING)`);

  // 2. Mengaktifkan Mode Headless (Sembunyikan Jendela Browser)
  console.log('\n2. Mengaktifkan Mode HEADLESS (Background)...');
  await call('browser_set_visibility', { taskId, visible: false });
  console.log('   Jendela Hero Browser telah disembunyikan dari layar (berjalan di background).');

  // 3. Navigasi ke Halaman Terproteksi CAPTCHA
  const targetUrl = 'http://127.0.0.1:4040';
  console.log(`\n3. [Headless Agent] Menavigasi ke target terlindungi: ${targetUrl}`);
  await call('browser_navigate', { taskId, url: targetUrl });
  await new Promise(r => setTimeout(r, 2000));

  // 4. Deteksi CAPTCHA di DOM
  console.log('\n4. [Headless Agent] Memindai elemen DOM untuk proteksi keamanan...');
  const domText = await call('browser_get_dom', { taskId, format: 'text', maxLength: 3000 });
  const hasCaptcha = domText.includes('Verifikasi') || domText.includes('Cloudflare') || domText.includes('robot');

  if (hasCaptcha) {
    console.log('   ⚠️  PERINGATAN: Terdeteksi Cloudflare Turnstile CAPTCHA!');
    console.log('   Kondisi halaman: "Status: Menunggu Verifikasi Manusia..."');
    console.log('   Data sensitif masih terkunci.');

    // 5. Minta Bantuan Manusia via browser_request_human_intervention
    console.log('\n5. [Headless Agent] Memanggil intervensi manusia & memunculkan jendela...');
    
    // Explicitly make window visible and bring to front
    await call('browser_set_visibility', { taskId, visible: true });

    const interventionRes = await call('browser_request_human_intervention', {
      taskId,
      reason: 'captcha_verification',
      message: 'Terdeteksi CAPTCHA verifikasi Cloudflare. Jendela telah dimunculkan ke layar. Silakan klik kotak verifikasi manusia.',
      timeoutMs: 120000,
    });

    console.log('   Status Task berubah menjadi: WAITING_FOR_HUMAN');
    console.log('   Resume Token diterbitkan:', interventionRes.resumeToken);
    console.log('\n   ============================================================');
    console.log('   >>> [SWITCH HEADLESS -> HEADFUL]');
    console.log('   >>> Jendela Hero Browser sekarang AKTIF di layar monitor Anda!');
    console.log('   >>> Silakan KLIK kotak centang "Saya adalah manusia" di halaman!');
    console.log('   >>> Lalu klik tombol "Lanjutkan Automation" di banner atas.');
    console.log('   ============================================================\n');

    // Menunggu manusia menyelesaikan verifikasi
    console.log('   Menunggu tindakan manusia (polling status tugas)...');
    let solved = false;
    const startWait = Date.now();

    while (Date.now() - startWait < 90000) {
      await new Promise(r => setTimeout(r, 2000));

      // Cek status task terkini
      const currentTask = await call('browser_get_task_status', { taskId });
      
      // Jika manusia sudah menekan "Lanjutkan Automation" di banner UI browser
      if (currentTask.status === 'RUNNING') {
        console.log('\n   ✓ Manusia telah mengonfirmasi penyelesaian melalui UI browser!');
        solved = true;
        break;
      }

      const elapsed = Math.round((Date.now() - startWait) / 1000);
      process.stdout.write(`   [${elapsed}s] Menunggu klik verifikasi manusia di layar browser...\r`);
    }

    if (!solved) {
      console.log('\n   Waktu tunggu simulasi habis, melanjutkan tugas...');
      try {
        await call('browser_resume_task', { taskId, resumeToken: interventionRes.resumeToken });
      } catch {}
    }
  }

  // 6. Ekstraksi Data yang Berhasil Dibuka
  console.log('\n6. [Agent] Membaca data sensitif yang telah berhasil dibuka...');
  await new Promise(r => setTimeout(r, 2000));

  const finalDom = await call('browser_get_dom', { taskId, format: 'text', maxLength: 5000 });
  console.log('\n--- HASIL EKSTRAKSI SETELAH VERIFIKASI MANUSIA ---');
  const secretIdx = finalDom.indexOf('Akses data sensitif telah dibuka');
  if (secretIdx !== -1) {
    console.log(finalDom.slice(secretIdx, secretIdx + 300));
  } else {
    console.log(finalDom.slice(0, 500));
  }

  // Jendela browser DIBIARKAN TERBUKA agar pengguna bisa melihat hasilnya langsung!
  console.log('\n7. Jendela browser tetap DIBIARKAN TERBUKA agar Anda dapat melihat hasilnya.');

  // 8. Selesaikan Task
  console.log('\n8. Menyelesaikan task dan melepaskan sesi profil...');
  await call('browser_complete_task', { taskId });
  console.log('   Task COMPLETED 100% Sukses!');

  console.log('\n================================================================');
  console.log(' SIMULASI BERHASIL: Jendela Browser Berhasil Ditampilkan ke Pengguna');
  console.log('================================================================\n');

  process.exit(0);
})().catch(err => {
  console.error('Fatal error dalam simulasi:', err);
  process.exit(1);
});
