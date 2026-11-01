import { ipcMain } from 'electron';
import type { BrowserManager } from './browser-manager';
import type { DataStore } from './data/store';
import type { DataAnalysis } from './data/analysis';
import type { JobRunner } from './data/job-runner';
import type { InteractionRecorder } from './data/recorder';

export interface DataIpcDeps {
  trust: (event: Electron.IpcMainInvokeEvent) => BrowserManager;
  jobRunner: () => JobRunner | undefined; analysis: () => DataAnalysis | undefined;
  store: () => DataStore | undefined; recorder: () => InteractionRecorder | undefined;
}

/** IPC handlers for the Data workspace panel (jobs, datasets, recorder, review, search). */
export function registerDataIpc(deps: DataIpcDeps): void {
  // Verifies the sender is the browser UI, then exposes the (late-initialised) services.
  const services = (event: Electron.IpcMainInvokeEvent) => ({
    manager: deps.trust(event), jobRunner: deps.jobRunner()!, analysis: deps.analysis()!, store: deps.store()!, recorder: deps.recorder()!,
  });
  ipcMain.handle('data:overview', event => {
    const { manager, jobRunner, analysis, store, recorder } = services(event);
    return jobRunner?.overview() ?? {};
  });
  ipcMain.handle('data:jobs', event => {
    const { manager, jobRunner, analysis, store, recorder } = services(event);
    return jobRunner?.listJobs() ?? [];
  });
  ipcMain.handle('data:datasets', event => {
    const { manager, jobRunner, analysis, store, recorder } = services(event);
    return analysis ? store.list('dataset').map((d: any) => analysis.summary(d)) : [];
  });
  ipcMain.handle('data:recordings', event => {
    const { manager, jobRunner, analysis, store, recorder } = services(event);
    return recorder?.list() ?? [];
  });
  ipcMain.handle('data:command', async (event, value: unknown) => {
    const { manager, jobRunner, analysis, store, recorder } = services(event);
    if (!value || typeof value !== 'object') return { ok: false, error: 'Perintah tidak valid.' };
    const { action, payload } = value as { action: string; payload: any };
    try {
      switch (action) {
        case 'job-run': return { ok: true, result: await jobRunner.runJob(String(payload.jobId)) };
        case 'job-pause': return { ok: true, result: jobRunner.pauseJob(String(payload.jobId)) };
        case 'job-resume': return { ok: true, result: await jobRunner.resumeJob(String(payload.jobId)) };
        case 'job-cancel': return { ok: true, result: jobRunner.cancelJob(String(payload.jobId)) };
        case 'job-create': return { ok: true, result: jobRunner.createJob(payload) };
        case 'record-start': return { ok: true, result: await recorder.start(String(payload?.name || 'Sesi')) };
        case 'record-stop': return { ok: true, result: await recorder.stop() };
        case 'record-convert': return { ok: true, result: recorder.convert(String(payload.recordingId), payload.schema, String(payload.name), (payload.intervalMinutes as number | null) ?? null) };
        case 'dataset-build': return { ok: true, result: analysis.build(payload) };
        case 'dataset-export': return { ok: true, result: await analysis.export(String(payload.datasetId), payload.format) };
        case 'search': return { ok: true, result: store.records(payload) };
        case 'network-requests': return { ok: true, result: jobRunner.network.getRequests(payload?.filter, payload?.limit) };
        case 'review-list': return { ok: true, result: jobRunner.reviewQueue.listItems(payload?.status, payload?.limit) };
        case 'review-resolve': return { ok: true, result: jobRunner.reviewQueue.resolveItem(String(payload.reviewId), payload.resolution, payload.editedData) };
        case 'frontier-push': return { ok: true, result: jobRunner.frontier.push(payload.urls, payload.depth, payload.priority) };
        case 'frontier-stats': return { ok: true, result: jobRunner.frontier.getStats() };
        case 'copilot-synthesize': return { ok: true, result: await jobRunner.copilot.synthesize(manager.getActiveWebContents(), String(payload.targetUrl), payload.goalContract) };
        case 'lineage': return { ok: true, result: store.getLineage(String(payload.recordId)) };
        default: return { ok: false, error: 'Aksi data tidak dikenal.' };
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Operasi data gagal.' };
    }
  });
  
}
