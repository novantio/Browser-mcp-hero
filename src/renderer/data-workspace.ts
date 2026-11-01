import { refreshDataView, loadNetworkRequests, loadReviewQueue, renderRecordingSteps, renderSearchResults, renderCopilotResult } from './data-render.js';

export { refreshDataView };

/** Wires the Data & AI Runtime panel: tabs, job form, recorder, datasets, search, copilot. */
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
