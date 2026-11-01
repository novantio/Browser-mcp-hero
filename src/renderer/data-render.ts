import { renderJobsList } from './data-jobs.js';
/** Data workspace views: overview stats and the job, dataset, search, network, review and copilot lists. */
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
      renderJobsList(jobs, refreshDataView);
    }
    if (window.browser.dataDatasets) {
      const datasets = await window.browser.dataDatasets();
      renderDatasetsList(datasets);
    }
  } catch {
    // Ignore when bridge starting
  }
}

export function renderRecordingSteps(recording: any): void {
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

export function renderDatasetsList(datasets: any[]): void {
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

export function renderSearchResults(items: any[]): void {
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

export async function loadNetworkRequests(): Promise<void> {
  if (!window.browser.dataCommand) return;
  const filter = (document.getElementById('network-filter-input') as HTMLInputElement)?.value.trim() || '';
  const res = await window.browser.dataCommand('network-requests', { filter, limit: 40 });
  if (res.ok && res.result) {
    renderNetworkList(res.result as any[]);
  }
}

export function renderNetworkList(records: any[]): void {
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

export async function loadReviewQueue(): Promise<void> {
  if (!window.browser.dataCommand) return;
  const res = await window.browser.dataCommand('review-list', { status: 'pending', limit: 30 });
  if (res.ok && res.result) {
    renderReviewList(res.result as any[]);
  }
}

export function renderReviewList(items: any[]): void {
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

export function renderCopilotResult(data: any): void {
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
