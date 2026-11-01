/** Scraping job cards in the Data panel: run, pause, cancel and delete. */
export function renderJobsList(jobs: any[], refreshDataView: () => Promise<void>): void {
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

    const btnDelete = document.createElement('button');
    btnDelete.textContent = 'Hapus 🗑';
    btnDelete.className = 'btn-danger';
    btnDelete.title = 'Hapus job ini secara permanen';
    btnDelete.onclick = () => { void showDeleteConfirm(card, job, refreshDataView); };
    actions.append(btnDelete);

    card.append(header, meta, actions);
    container.append(card);
  }
}

/** Inline confirmation inside a job card; collected records are kept unless ticked. */
async function showDeleteConfirm(card: HTMLElement, job: any, refreshDataView: () => Promise<void>): Promise<void> {
  if (!window.browser.dataCommand || card.querySelector('.job-delete-confirm')) return;
  const count = await window.browser.dataCommand('job-records', { jobId: job.id }).then(r => (r.ok ? Number(r.result) : 0)).catch(() => 0);
  const box = document.createElement('div');
  box.className = 'job-delete-confirm';
  const question = document.createElement('p');
  question.textContent = `Hapus job "${job.name}" beserta riwayat snapshot & perubahannya?` + (job.status === 'running' ? ' Job yang sedang berjalan akan dihentikan.' : '');
  const label = document.createElement('label');
  const withResults = document.createElement('input');
  withResults.type = 'checkbox';
  withResults.disabled = count === 0;
  label.append(withResults, document.createTextNode(count ? ` Hapus juga ${count} record hasil scraping` : ' Tidak ada record hasil'));
  const yes = document.createElement('button');
  yes.className = 'btn-danger';
  yes.textContent = 'Ya, hapus';
  const no = document.createElement('button');
  no.textContent = 'Batal';
  no.onclick = () => box.remove();
  yes.onclick = async () => {
    yes.disabled = true;
    const res = await window.browser.dataCommand!('job-delete', { jobId: job.id, deleteResults: withResults.checked });
    if (!res.ok) { question.textContent = res.error || 'Job gagal dihapus.'; yes.disabled = false; return; }
    await refreshDataView();
  };
  const buttons = document.createElement('div');
  buttons.className = 'data-card-actions';
  buttons.append(yes, no);
  box.append(question, label, buttons);
  card.append(box);
}
