import { RpcError } from '../shared/rpc-error';
import { paginate } from './data/analysis';
import type { BridgeConfig } from './mcp-bridge';

/** Marker returned when a method is not one of the data-runtime RPC methods. */
export const NOT_DATA_METHOD = Symbol('not-data-method');

/** Data-runtime RPC methods that do not touch the live browser (jobs, datasets, analytics, recorder). */
export async function dispatchDataMethod(config: BridgeConfig, method: string, params: Record<string, unknown>): Promise<unknown> {
  const { store, jobRunner, analysis, recorder } = config;
  if (method === 'data.overview') {
    if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return jobRunner.overview();
  }
  if (method === 'data.createJob') {
    if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return jobRunner.createJob(params as any);
  }
  if (method === 'data.listJobs') {
    if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return jobRunner.listJobs();
  }
  if (method === 'data.runJob') {
    if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return await jobRunner.runJob(String(params.jobId));
  }
  if (method === 'data.pauseJob') {
    if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return jobRunner.pauseJob(String(params.jobId));
  }
  if (method === 'data.resumeJob') {
    if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return await jobRunner.resumeJob(String(params.jobId));
  }
  if (method === 'data.cancelJob') {
    if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return jobRunner.cancelJob(String(params.jobId));
  }
  if (method === 'data.getJob') {
    if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return jobRunner.getJob(String(params.jobId));
  }
  if (method === 'data.results') {
    if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return jobRunner.getResults(params.jobId as string | undefined, params.offset as number | undefined, params.limit as number | undefined);
  }
  if (method === 'data.history') {
    if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return jobRunner.getHistory(String(params.jobId), params.offset as number | undefined, params.limit as number | undefined);
  }
  if (method === 'data.changes') {
    if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return jobRunner.getChanges(String(params.jobId), params.offset as number | undefined, params.limit as number | undefined);
  }
  if (method === 'data.compare') {
    if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return analysis.compare(String(params.beforeId), String(params.afterId));
  }
  if (method === 'data.recordStart') {
    if (!recorder) throw new RpcError('SERVICE_UNAVAILABLE', 'Recorder belum aktif.');
    return await recorder.start(String(params.name));
  }
  if (method === 'data.recordStop') {
    if (!recorder) throw new RpcError('SERVICE_UNAVAILABLE', 'Recorder belum aktif.');
    return await recorder.stop();
  }
  if (method === 'data.recordList') {
    if (!recorder) throw new RpcError('SERVICE_UNAVAILABLE', 'Recorder belum aktif.');
    return recorder.list();
  }
  if (method === 'data.recordUpdate') {
    if (!recorder) throw new RpcError('SERVICE_UNAVAILABLE', 'Recorder belum aktif.');
    return recorder.update(String(params.recordingId), params.steps as any);
  }
  if (method === 'data.recordConvert') {
    if (!recorder) throw new RpcError('SERVICE_UNAVAILABLE', 'Recorder belum aktif.');
    return recorder.convert(String(params.recordingId), params.schema as any, String(params.name), (params.intervalMinutes as number | null) ?? null);
  }
  if (method === 'data.buildDataset') {
    if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return analysis.build(params as any);
  }
  if (method === 'data.listDatasets') {
    if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return analysis.store.list('dataset').map((d: any) => analysis!.summary(d));
  }
  if (method === 'data.quality') {
    if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    const d = analysis.store.get('dataset', String(params.datasetId)) as any;
    return d.metrics;
  }
  if (method === 'data.datasetRows') {
    if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    const d = analysis.store.get('dataset', String(params.datasetId)) as any;
    return paginate(d.rows, Number(params.offset || 0), Number(params.limit || 50));
  }
  if (method === 'data.exportDataset') {
    if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return await analysis.export(String(params.datasetId), params.format as any);
  }
  if (method === 'data.search') {
    if (!store) throw new RpcError('SERVICE_UNAVAILABLE', 'Data store belum aktif.');
    return store.records(params as any);
  }
  if (method === 'data.entityCandidates') {
    if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return analysis.candidates(String(params.alias));
  }
  if (method === 'data.entityLink') {
    if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return analysis.link(params as any);
  }
  if (['data.get_activity_timeline', 'data.get_trends', 'data.detect_anomalies', 'data.compare_entities'].includes(method)) {
    if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return analysis.analytics(params as any);
  }
  if (method === 'data.graph') {
    if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return analysis.graph(params as any);
  }
  if (method === 'data.setEmbeddings') {
    if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return analysis.embeddings(String(params.model), params.items as any);
  }
  if (method === 'data.semantic') {
    if (!analysis) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return analysis.semantic(String(params.model), params.vector as any, Number(params.limit || 20));
  }
  if (method === 'data.networkRequests') {
    if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return jobRunner.network.getRequests(String(params.filter || ''), params.limit ? Number(params.limit) : 50);
  }
  if (method === 'data.networkRecipe') {
    if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return jobRunner.network.getRecipe(params.requestId ? String(params.requestId) : undefined);
  }
  if (method === 'data.networkReplay') {
    if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return await jobRunner.network.replayRecipe(String(params.recipeId), (params.params as any) || {});
  }
  if (method === 'data.frontierPush') {
    if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return jobRunner.frontier.push(params.urls as string[], Number(params.depth || 0), Number(params.priority || 50));
  }
  if (method === 'data.frontierPop') {
    if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return jobRunner.frontier.popBatch(Number(params.limit || 10));
  }
  if (method === 'data.frontierStats') {
    if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return jobRunner.frontier.getStats();
  }
  if (method === 'data.reviewList') {
    if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return jobRunner.reviewQueue.listItems((params.status as any) || 'pending', Number(params.limit || 50));
  }
  if (method === 'data.reviewResolve') {
    if (!jobRunner) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    return jobRunner.reviewQueue.resolveItem(String(params.reviewId), params.resolution as any, params.editedData as any);
  }
  if (method === 'data.lineage') {
    if (!store) throw new RpcError('SERVICE_UNAVAILABLE', 'Data store belum aktif.');
    return store.getLineage(String(params.recordId));
  }
  if (method === 'data.checkDrift') {
    if (!jobRunner || !store) throw new RpcError('SERVICE_UNAVAILABLE', 'Data runtime belum aktif.');
    const latestSnaps = store.list<any>('snapshot').filter((s: any) => s.jobId === String(params.jobId)) || [];
    const rows = latestSnaps.length > 0 ? latestSnaps[0].rows : [];
    return jobRunner.drift.checkDrift(String(params.jobId), params.schema as any, rows);
  }
  return NOT_DATA_METHOD;
}
