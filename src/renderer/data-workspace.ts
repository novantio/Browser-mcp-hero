export function setupDataWorkspace(): void {
  const tabProfiles = document.getElementById('view-tab-profiles');
  const tabData = document.getElementById('view-tab-data');
  const panelProfiles = document.getElementById('panel-profiles-view');
  const panelData = document.getElementById('panel-data-view');

  if (!tabProfiles || !tabData || !panelProfiles || !panelData) return;

  tabProfiles.addEventListener('click', () => {
    tabProfiles.classList.add('active');
    tabData.classList.remove('active');
    panelProfiles.hidden = false;
    panelData.hidden = true;
  });

  tabData.addEventListener('click', () => {
    tabData.classList.add('active');
    tabProfiles.classList.remove('active');
    panelData.hidden = false;
    panelProfiles.hidden = true;
    void refreshDataView();
  });

  // Sub tabs in data view
  const subTabs = ['jobs', 'copilot', 'network', 'review', 'recorder', 'datasets', 'search'];
  for (const tab of subTabs) {
    const btn = document.getElementById(`data-tab-${tab}`);
    btn?.addEventListener('click', () => {
      for (const t of subTabs) {
        document.getElementById(`data-tab-${t}`)?.classList.toggle('active', t === tab);
        const section = document.getElementById(`data-section-${t}`);
        if (section) section.hidden = (t !== tab);
      }
      if (tab === 'network') void loadNetworkRequests();
      if (tab === 'review') void loadReviewQueue();
      void refreshDataView();
    });
  }

  // Toggle New Job Form
  const btnToggleNewJob = document.getElementById('btn-toggle-new-job');
  const formNewJob = document.getElementById('new-job-form') as HTMLFormElement | null;
  const btnCancelJob = document.getElementById('btn-cancel-job');

  btnToggleNewJob?.addEventListener('click', () => {
    if (formNewJob) formNewJob.hidden = !formNewJob.hidden;
  });
  btnCancelJob?.addEventListener('click', () => {
    if (formNewJob) formNewJob.hidden = true;
  });

  formNewJob?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = (document.getElementById('job-name-input') as HTMLInputElement)?.value.trim();
    const target = (document.getElementById('job-target-input') as HTMLInputElement)?.value.trim();
    const rowSelector = (document.getElementById('job-row-input') as HTMLInputElement)?.value.trim() || 'article';
    const fieldDefs = (document.getElementById('job-field-input') as HTMLInputElement)?.value.trim() || 'title:h2';
    const intervalStr = (document.getElementById('job-interval-input') as HTMLInputElement)?.value.trim();
    const intervalMinutes = intervalStr ? parseInt(intervalStr, 10) : null;

    if (!name || !target) return;

    const fields = fieldDefs.split(',').map(pair => {
      const [path, sel] = pair.split(':');
      return { path: path?.trim() || 'title', selector: sel?.trim() || '', type: 'string', required: true };
    });

    const schema = {
      rowSelector,
      fields,
      identityFields: [fields[0]?.path || 'title'],
      maxItems: 50,
    };

    if (window.browser.dataCommand) {
      await window.browser.dataCommand('job-create', {
        name,
        profileId: 'default',
        targets: [target],
        schema,
        steps: [{ action: 'navigate', url: target }, { action: 'extract' }],
        intervalMinutes,
        topic: '',
        sourceType: 'web',
        captureScreenshot: false,
      });
      formNewJob.hidden = true;
      formNewJob.reset();
      await refreshDataView();
    }
  });

  // Recorder controls
  const btnRecordToggle = document.getElementById('btn-record-toggle');
  const recNameInput = document.getElementById('rec-name-input') as HTMLInputElement | null;
  const recStatusLabel = document.getElementById('recorder-label');
  const btnConvertScraper = document.getElementById('btn-convert-scraper') as HTMLButtonElement | null;
  let isRecording = false;
  let activeRecordingId = '';

  btnRecordToggle?.addEventListener('click', async () => {
    if (!window.browser.dataCommand) return;
    if (!isRecording) {
      const name = recNameInput?.value.trim() || 'Sesi Browsing';
      const res = await window.browser.dataCommand('record-start', { name });
      if (res.ok && res.result) {
        isRecording = true;
        activeRecordingId = (res.result as any).id;
        if (recStatusLabel) recStatusLabel.textContent = `Merekam: ${name} (aktif)`;
        if (btnRecordToggle) btnRecordToggle.textContent = 'Hentikan Rekam ⏹';
        if (btnRecordToggle) btnRecordToggle.classList.add('recording-btn');
      }
    } else {
      const res = await window.browser.dataCommand('record-stop');
      isRecording = false;
      if (recStatusLabel) recStatusLabel.textContent = 'Perekaman Selesai';
      if (btnRecordToggle) btnRecordToggle.textContent = 'Mulai Rekam ⏺';
      if (btnRecordToggle) btnRecordToggle.classList.remove('recording-btn');
      if (res.ok && res.result) {
        activeRecordingId = (res.result as any).id;
        renderRecordingSteps(res.result as any);
        if (btnConvertScraper) btnConvertScraper.disabled = false;
      }
    }
  });

  btnConvertScraper?.addEventListener('click', async () => {
    if (!activeRecordingId || !window.browser.dataCommand) return;
    const schema = {
      rowSelector: 'article',
      fields: [{ path: 'title', selector: 'h2', type: 'string', required: true }],
      identityFields: ['title'],
      maxItems: 50,
    };
    await window.browser.dataCommand('record-convert', {
      recordingId: activeRecordingId,
      schema,
      name: `Scraper dari ${recNameInput?.value.trim() || 'Rekaman'}`,
      intervalMinutes: 60,
    });
    alert('Rekaman berhasil dikonversi menjadi Scraping Job!');
    // Switch to jobs subtab
    document.getElementById('data-tab-jobs')?.click();
  });

  // Dataset builder
  const btnToggleBuildDs = document.getElementById('btn-toggle-build-dataset');
  const formBuildDs = document.getElementById('build-dataset-form') as HTMLFormElement | null;

  btnToggleBuildDs?.addEventListener('click', () => {
    if (formBuildDs) formBuildDs.hidden = !formBuildDs.hidden;
  });

  formBuildDs?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!window.browser.dataCommand) return;
    const name = (document.getElementById('dataset-name-input') as HTMLInputElement)?.value.trim() || 'LLM Dataset';
    const minQuality = parseFloat((document.getElementById('dataset-quality-input') as HTMLInputElement)?.value || '0.5');
    const language = (document.getElementById('dataset-lang-select') as HTMLSelectElement)?.value || 'all';

    await window.browser.dataCommand('dataset-build', {
      name,
      minQuality,
      language,
      chunkSize: 2000,
      nearDedup: true,
      removeBoilerplate: true,
    });

    formBuildDs.hidden = true;
    formBuildDs.reset();
    await refreshDataView();
  });

  // Search
  const formSearch = document.getElementById('fts-search-form') as HTMLFormElement | null;
  const inputSearch = document.getElementById('fts-search-input') as HTMLInputElement | null;

  formSearch?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!window.browser.dataCommand) return;
    const query = inputSearch?.value.trim() || '';
    const res = await window.browser.dataCommand('search', { query, limit: 30 });
    if (res.ok && res.result) {
      renderSearchResults((res.result as any).items || []);
    }
  });

  // Copilot run
  const btnCopilot = document.getElementById('btn-copilot-run');
  btnCopilot?.addEventListener('click', async () => {
    const url = (document.getElementById('copilot-url-input') as HTMLInputElement)?.value.trim();
    const rawContract = (document.getElementById('copilot-contract-input') as HTMLTextAreaElement)?.value.trim();
    if (!url || !window.browser.dataCommand) return;
    let goalContract: Record<string, string> = { title: 'string', content: 'string' };
    try {
      if (rawContract) goalContract = JSON.parse(rawContract);
    } catch {}
    const box = document.getElementById('copilot-result-box');
    if (box) box.innerHTML = '<div class="empty-hint">Sedang menganalisis struktur halaman & menyintesis scraper...</div>';
    const res = await window.browser.dataCommand('copilot-synthesize', { targetUrl: url, goalContract });
    if (res.ok && res.result && box) {
      renderCopilotResult(res.result);
    }
  });

  // Refresh Network
  const btnRefreshNet = document.getElementById('btn-refresh-network');
  btnRefreshNet?.addEventListener('click', () => void loadNetworkRequests());
}

export async function refreshDataView(): Promise<void> {
  if (!window.browser.dataOverview) return;

  try {
    const overview = await window.browser.dataOverview();
    const statJobs = document.getElementById('stat-jobs-count');
    const statRecords = document.getElementById('stat-records-count');
    const statActive = document.getElementById('stat-active-count');
    const statReview = document.getElementById('stat-review-pending');
    if (statJobs) statJobs.textContent = String(overview.jobs ?? 0);
    if (statRecords) statRecords.textContent = String(overview.records ?? 0);
    if (statActive) statActive.textContent = String(overview.activeJobs ?? 0);
    if (statReview) statReview.textContent = String(overview.reviewPending ?? 0);

    if (window.browser.dataJobs) {
      const jobs = await window.browser.dataJobs();
      renderJobsList(jobs);
    }
    if (window.browser.dataDatasets) {
      const datasets = await window.browser.dataDatasets();
      renderDatasetsList(datasets);
    }
  } catch {
    // Ignore when bridge starting
  }
}

function renderJobsList(jobs: any[]): void {
  const container = document.getElementById('jobs-container');
  if (!container) return;
  container.replaceChildren();

  if (jobs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-hint';
    empty.textContent = 'Belum ada job scraping/monitoring. Klik "+ Buat Scraping Job" di atas.';
    container.append(empty);
    return;
  }

  for (const job of jobs) {
    const card = document.createElement('div');
    card.className = 'data-card';

    const header = document.createElement('div');
    header.className = 'data-card-header';

    const title = document.createElement('strong');
    title.textContent = job.name;

    const badge = document.createElement('span');
    badge.className = `status-badge ${job.status}`;
    badge.textContent = job.status;
    header.append(title, badge);

    const meta = document.createElement('div');
    meta.className = 'data-card-meta';
    meta.textContent = `Target: ${job.targets?.[0] || '-'} · ${job.records || 0} records collected`;

    const actions = document.createElement('div');
    actions.className = 'data-card-actions';

    if (job.status === 'running') {
      const btnPause = document.createElement('button');
      btnPause.textContent = 'Jeda ⏸';
      btnPause.onclick = async () => {
        if (window.browser.dataCommand) {
          await window.browser.dataCommand('job-pause', { jobId: job.id });
          await refreshDataView();
        }
      };
      actions.append(btnPause);
    } else {
      const btnRun = document.createElement('button');
      btnRun.textContent = 'Jalankan ▶';
      btnRun.onclick = async () => {
        if (window.browser.dataCommand) {
          await window.browser.dataCommand('job-run', { jobId: job.id });
          await refreshDataView();
        }
      };
      actions.append(btnRun);
    }

    const btnCancel = document.createElement('button');
    btnCancel.textContent = 'Batal ⏹';
    btnCancel.className = 'btn-danger';
    btnCancel.onclick = async () => {
      if (window.browser.dataCommand) {
        await window.browser.dataCommand('job-cancel', { jobId: job.id });
        await refreshDataView();
      }
    };
    actions.append(btnCancel);

    card.append(header, meta, actions);
    container.append(card);
  }
}

function renderRecordingSteps(recording: any): void {
  const container = document.getElementById('recorder-steps-box');
  if (!container) return;
  container.replaceChildren();

  const omittedEl = document.getElementById('rec-omitted-count');
  if (omittedEl) omittedEl.textContent = `${recording.omitted || 0} input sensitif dilewati`;

  const steps = recording.steps || [];
  if (steps.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-hint';
    empty.textContent = 'Tidak ada langkah yang tercatat.';
    container.append(empty);
    return;
  }

  steps.forEach((step: any, idx: number) => {
    const item = document.createElement('div');
    item.className = 'step-item';
    const num = document.createElement('span');
    num.className = 'step-num';
    num.textContent = `${idx + 1}.`;
    const text = document.createElement('span');
    text.className = 'step-text';
    text.textContent = `${step.action.toUpperCase()}: ${step.url || step.selector || (step.amount ? step.amount + 'px' : '')}`;
    item.append(num, text);
    container.append(item);
  });
}

function renderDatasetsList(datasets: any[]): void {
  const container = document.getElementById('datasets-container');
  if (!container) return;
  container.replaceChildren();

  if (datasets.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-hint';
    empty.textContent = 'Belum ada dataset yang dibangun.';
    container.append(empty);
    return;
  }

  for (const ds of datasets) {
    const card = document.createElement('div');
    card.className = 'data-card';

    const header = document.createElement('div');
    header.className = 'data-card-header';
    const title = document.createElement('strong');
    title.textContent = `${ds.name} (v${ds.version})`;
    const tag = document.createElement('span');
    tag.className = 'dataset-tag';
    tag.textContent = `${ds.rowCount || 0} baris`;
    header.append(title, tag);

    const m = ds.metrics || {};
    const stats = document.createElement('div');
    stats.className = 'data-card-meta';
    stats.textContent = `Kualitas: ${(m.averageQuality || 0).toFixed(2)} · Duplikat: ${m.duplicates || 0} · PII: ${m.pii || 0} · ID: ${m.languages?.id || 0} | EN: ${m.languages?.en || 0}`;

    const exports = document.createElement('div');
    exports.className = 'data-card-actions';

    for (const fmt of ['jsonl', 'csv', 'parquet'] as const) {
      const btn = document.createElement('button');
      btn.textContent = `Export ${fmt.toUpperCase()}`;
      btn.onclick = async () => {
        if (window.browser.dataCommand) {
          const res = await window.browser.dataCommand('dataset-export', { datasetId: ds.id, format: fmt });
          if (res.ok && (res.result as any)?.path) {
            alert(`Ekspor selesai ke:\n${(res.result as any).path}`);
          }
        }
      };
      exports.append(btn);
    }

    card.append(header, stats, exports);
    container.append(card);
  }
}

function renderSearchResults(items: any[]): void {
  const container = document.getElementById('search-results-box');
  if (!container) return;
  container.replaceChildren();

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-hint';
    empty.textContent = 'Tidak ada record yang cocok.';
    container.append(empty);
    return;
  }

  for (const r of items) {
    const card = document.createElement('div');
    card.className = 'data-card';
    const header = document.createElement('div');
    header.className = 'data-card-header';
    const title = document.createElement('strong');
    title.textContent = r.source?.domain || 'Web Record';
    const badge = document.createElement('span');
    badge.className = 'status-badge idle';
    badge.textContent = r.language || 'unknown';
    header.append(title, badge);

    const body = document.createElement('div');
    body.className = 'search-snippet';
    body.textContent = (r.text || '').slice(0, 180) + '...';

    card.append(header, body);
    container.append(card);
  }
}

async function loadNetworkRequests(): Promise<void> {
  if (!window.browser.dataCommand) return;
  const filter = (document.getElementById('network-filter-input') as HTMLInputElement)?.value.trim() || '';
  const res = await window.browser.dataCommand('network-requests', { filter, limit: 40 });
  if (res.ok && res.result) {
    renderNetworkList(res.result as any[]);
  }
}

function renderNetworkList(records: any[]): void {
  const container = document.getElementById('network-requests-list');
  if (!container) return;
  container.replaceChildren();

  if (records.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-hint';
    empty.textContent = 'Belum ada pertukaran API yang tersadap. Buka halaman web atau navigasi tab.';
    container.append(empty);
    return;
  }

  for (const r of records) {
    const card = document.createElement('div');
    card.className = 'data-card';
    const header = document.createElement('div');
    header.className = 'data-card-header';
    const methodBadge = document.createElement('span');
    methodBadge.className = 'status-badge running';
    methodBadge.textContent = r.method;
    const urlSpan = document.createElement('strong');
    urlSpan.style.wordBreak = 'break-all';
    urlSpan.textContent = r.url;
    header.append(methodBadge, urlSpan);

    const stats = document.createElement('div');
    stats.className = 'data-card-stats';
    stats.innerHTML = `<span>Status: <b>${r.status}</b></span><span>MIME: <b>${r.mimeType || 'unknown'}</b></span><span>Durasi: <b>${r.durationMs}ms</b></span>`;

    card.append(header, stats);
    container.append(card);
  }
}

async function loadReviewQueue(): Promise<void> {
  if (!window.browser.dataCommand) return;
  const res = await window.browser.dataCommand('review-list', { status: 'pending', limit: 30 });
  if (res.ok && res.result) {
    renderReviewList(res.result as any[]);
  }
}

function renderReviewList(items: any[]): void {
  const container = document.getElementById('review-items-list');
  if (!container) return;
  container.replaceChildren();

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-hint';
    empty.textContent = 'Semua data lolos filter kualitas. Tidak ada item yang membutuhkan kurasi manual.';
    container.append(empty);
    return;
  }

  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'data-card';
    const header = document.createElement('div');
    header.className = 'data-card-header';
    const typeBadge = document.createElement('span');
    typeBadge.className = 'status-badge paused';
    typeBadge.textContent = item.type;
    const title = document.createElement('strong');
    title.textContent = `Confidence: ${(item.confidence * 100).toFixed(0)}%`;
    header.append(typeBadge, title);

    const body = document.createElement('div');
    body.className = 'search-snippet';
    body.textContent = JSON.stringify(item.payload, null, 2).slice(0, 200);

    const actions = document.createElement('div');
    actions.className = 'data-card-actions';
    const btnApprove = document.createElement('button');
    btnApprove.textContent = '✓ Setujui';
    btnApprove.onclick = async () => {
      if (window.browser.dataCommand) {
        await window.browser.dataCommand('review-resolve', { reviewId: item.id, resolution: 'approved' });
        await loadReviewQueue();
        await refreshDataView();
      }
    };
    const btnReject = document.createElement('button');
    btnReject.textContent = '✗ Tolak';
    btnReject.onclick = async () => {
      if (window.browser.dataCommand) {
        await window.browser.dataCommand('review-resolve', { reviewId: item.id, resolution: 'rejected' });
        await loadReviewQueue();
        await refreshDataView();
      }
    };
    actions.append(btnApprove, btnReject);

    card.append(header, body, actions);
    container.append(card);
  }
}

function renderCopilotResult(data: any): void {
  const container = document.getElementById('copilot-result-box');
  if (!container) return;
  container.replaceChildren();

  const card = document.createElement('div');
  card.className = 'data-card';
  const header = document.createElement('div');
  header.className = 'data-card-header';
  const title = document.createElement('strong');
  title.textContent = `Strategi: ${data.recommendedStrategy.toUpperCase()}`;
  const badge = document.createElement('span');
  badge.className = data.jobReady ? 'status-badge running' : 'status-badge failed';
  badge.textContent = `Akurasi Tes: ${data.testAccuracy}%`;
  header.append(title, badge);

  const stats = document.createElement('div');
  stats.className = 'data-card-stats';
  stats.innerHTML = `<span>Endpoints: <b>${data.discoveredEndpoints?.length || 0}</b></span><span>Sampel: <b>${data.sampleRecords?.length || 0}</b></span>`;

  const btnDeploy = document.createElement('button');
  btnDeploy.className = 'primary-button';
  btnDeploy.style.marginTop = '8px';
  btnDeploy.textContent = 'Deploy Scraper Monitor';
  btnDeploy.onclick = async () => {
    if (window.browser.dataCommand) {
      await window.browser.dataCommand('job-create', {
        name: 'Copilot ' + new URL(data.targetUrl).hostname,
        profileId: 'default',
        targets: [data.targetUrl],
        schema: data.suggestedSchema,
        intervalMinutes: 180,
      });
      alert('Job monitor berhasil di-deploy oleh Copilot!');
      await refreshDataView();
    }
  };

  card.append(header, stats, btnDeploy);
  container.append(card);
}
