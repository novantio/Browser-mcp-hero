import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Job, JobDefinition, Snapshot, Change } from '../../shared/data-contracts';
import { DataStore } from './store';
import { BrowserManager } from '../browser-manager';
import { TaskManager } from '../task-manager';
import { ProfileManager } from '../profile-manager';
import { differences } from './processing';
import { buildRecord } from './record-builder';
import { paginate } from './analysis';
import { RpcError } from '../../shared/rpc-error';
import { NetworkIntelligence } from './network-intelligence';
import { ExtractionEngine } from './extraction-engine';
import { SelectorHealer } from './selector-healer';
import { DriftDetector } from './drift-detector';
import { RateLimiter } from './rate-limiter';
import { CollectorEngine } from './collector';
import { CrawlFrontier } from './crawl-frontier';
import { ReviewQueue } from './review-queue';
import { ScraperCopilot } from './copilot';

export class JobRunner {
  private readonly abortControllers = new Map<string, AbortController>();
  private schedulerTimer: NodeJS.Timeout | null = null;
  private changeListener: (() => void) | null = null;

  readonly network: NetworkIntelligence;
  readonly extractor: ExtractionEngine;
  readonly healer: SelectorHealer;
  readonly drift: DriftDetector;
  readonly rateLimiter: RateLimiter;
  readonly collector: CollectorEngine;
  readonly frontier: CrawlFrontier;
  readonly reviewQueue: ReviewQueue;
  readonly copilot: ScraperCopilot;

  constructor(
    private readonly store: DataStore,
    private readonly browser: BrowserManager,
    private readonly tasks: TaskManager,
    private readonly profiles: ProfileManager,
  ) {
    this.network = new NetworkIntelligence();
    if (typeof this.browser?.setNetworkIntelligence === 'function') {
      this.browser.setNetworkIntelligence(this.network);
    }
    this.extractor = new ExtractionEngine(this.network);
    this.healer = new SelectorHealer();
    this.drift = new DriftDetector();
    this.rateLimiter = new RateLimiter();
    this.collector = new CollectorEngine(this.extractor);
    this.frontier = new CrawlFrontier();
    this.reviewQueue = new ReviewQueue();
    this.copilot = new ScraperCopilot(this.network, this.extractor);
    this.startScheduler();
  }

  setChangeListener(listener: () => void): void {
    this.changeListener = listener;
  }

  private emit(): void {
    if (this.changeListener) this.changeListener();
  }

  startScheduler(): void {
    if (this.schedulerTimer) return;
    this.schedulerTimer = setInterval(() => void this.checkSchedules(), 20000);
  }

  stopScheduler(): void {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    for (const [, controller] of this.abortControllers) {
      controller.abort(new RpcError('SHUTDOWN', 'Aplikasi sedang ditutup.'));
    }
    this.abortControllers.clear();
  }

  private async checkSchedules(): Promise<void> {
    const jobs = this.listJobs();
    const now = Date.now();
    for (const job of jobs) {
      if ((job.status === 'idle' || job.status === 'completed') && job.intervalMinutes && job.nextRunAt && job.nextRunAt <= now) {
        if (this.profiles.isLocked(job.profileId)) continue;
        void this.runJob(job.id).catch(() => {});
      }
    }
  }

  overview(): Record<string, unknown> {
    const jobs = this.listJobs();
    const recordsCount = Number(this.store.db.prepare('SELECT count(*) AS n FROM records').get()?.n ?? 0);
    const datasets = this.store.list('dataset');
    const recordings = this.store.list('recording');
    return {
      jobs: jobs.length,
      records: recordsCount,
      datasets: datasets.length,
      recordings: recordings.length,
      activeJobs: jobs.filter(j => j.status === 'running').length,
      networkRequests: this.network.getRequests().length,
      reviewPending: this.reviewQueue.getStats().pending,
      frontierQueued: this.frontier.getStats().queued,
    };
  }

  createJob(input: JobDefinition): Job {
    const job: Job = {
      ...input,
      id: randomUUID(),
      status: 'idle',
      createdAt: Date.now(),
      nextRunAt: input.intervalMinutes ? Date.now() + input.intervalMinutes * 60 * 1000 : null,
      runId: null,
      taskId: null,
      cursor: 0,
      step: 0,
      records: 0,
      error: null,
    };
    this.store.put('job', job.id, job);
    this.emit();
    return job;
  }

  listJobs(): Job[] {
    return this.store.list<Job>('job');
  }

  getJob(jobId: string): Job {
    return this.store.get<Job>('job', jobId);
  }

  async runJob(jobId: string): Promise<Job> {
    const job = this.getJob(jobId);
    if (job.status === 'running') return job;

    const controller = new AbortController();
    this.abortControllers.set(jobId, controller);

    job.status = 'running';
    job.runId = job.runId || randomUUID();
    job.error = null;
    this.store.put('job', job.id, job);
    this.emit();

    void this.execute(job, controller.signal).catch(err => {
      if (controller.signal.aborted) return;
      const current = this.getJob(jobId);
      current.status = 'failed';
      current.error = err instanceof Error ? err.message : 'Eksekusi job gagal.';
      if (current.taskId) {
        try { this.tasks.cancelTask(current.taskId); } catch {}
        current.taskId = null;
      }
      this.store.put('job', current.id, current);
      this.emit();
    }).finally(() => {
      this.abortControllers.delete(jobId);
    });

    return job;
  }

  pauseJob(jobId: string): Job {
    const job = this.getJob(jobId);
    if (job.status === 'running') {
      job.status = 'paused';
      const controller = this.abortControllers.get(jobId);
      if (controller) {
        controller.abort(new RpcError('JOB_PAUSED', 'Job dijeda.'));
        this.abortControllers.delete(jobId);
      }
      if (job.taskId) {
        try { this.tasks.pauseTask(job.taskId); } catch {}
      }
      this.store.put('job', job.id, job);
      this.emit();
    }
    return job;
  }

  resumeJob(jobId: string): Promise<Job> {
    const job = this.getJob(jobId);
    if (job.status === 'paused') {
      if (job.taskId) {
        try { this.tasks.resumeTask(job.taskId); } catch {}
      }
      return this.runJob(jobId);
    }
    return Promise.resolve(job);
  }

  cancelJob(jobId: string): Job {
    const job = this.getJob(jobId);
    job.status = 'cancelled';
    const controller = this.abortControllers.get(jobId);
    if (controller) {
      controller.abort(new RpcError('JOB_CANCELLED', 'Job dibatalkan.'));
      this.abortControllers.delete(jobId);
    }
    if (job.taskId) {
      try { this.tasks.cancelTask(job.taskId); } catch {}
      job.taskId = null;
    }
    this.store.put('job', job.id, job);
    this.emit();
    return job;
  }

  /** Deletes a job (cancelling it first if it runs); its collected records only with deleteResults. */
  deleteJob(jobId: string, deleteResults = false): { jobId: string; documents: number; records: number } {
    const job = this.getJob(jobId);
    this.abortControllers.get(jobId)?.abort(new RpcError('JOB_CANCELLED', 'Job dihapus.'));
    this.abortControllers.delete(jobId);
    if (job.taskId) { try { this.tasks.cancelTask(job.taskId); } catch { /* already finished */ } }
    const removed = this.store.deleteJobData(jobId, { records: deleteResults });
    this.emit();
    return { jobId, ...removed };
  }

  getResults(jobId?: string, offset = 0, limit = 50): unknown {
    return this.store.records({ jobId, offset, limit });
  }

  getHistory(jobId: string, offset = 0, limit = 50): unknown {
    const snapshots = this.store.list<Snapshot>('snapshot').filter(s => s.jobId === jobId);
    return paginate(snapshots, offset, limit);
  }

  getChanges(jobId: string, offset = 0, limit = 50): unknown {
    const changes = this.store.list<Change & { jobId: string; runId: string; url: string; timestamp: number }>('change').filter(c => c.jobId === jobId);
    return paginate(changes, offset, limit);
  }

  private async execute(job: Job, signal: AbortSignal): Promise<void> {
    const task = this.tasks.createTask(job.profileId);
    job.taskId = task.id;
    this.store.put('job', job.id, job);
    this.emit();

    if (this.profiles.activeProfileId !== job.profileId) {
      this.browser.switchProfile(job.profileId);
    }

    try {
      while (job.cursor < job.targets.length) {
        signal.throwIfAborted();
        const target = job.targets[job.cursor]!;
        const steps = job.steps.length > 0 ? job.steps : [
          { action: 'navigate' as const, url: target },
          { action: 'wait' as const, ms: 1000 },
          { action: 'extract' as const },
        ];

        for (let i = job.step; i < steps.length; i++) {
          signal.throwIfAborted();
          job.step = i;
          this.store.put('job', job.id, job);

          const step = steps[i]!;
          switch (step.action) {
            case 'navigate': {
              const url = step.url || target;
              this.browser.execute({ action: 'navigate', input: url });
              await delay(1200, undefined, { signal });
              break;
            }
            case 'click': {
              await this.browser.click({ selector: step.selector });
              await delay(400, undefined, { signal });
              break;
            }
            case 'type': {
              await this.browser.type(step.selector, step.text, {}, signal);
              break;
            }
            case 'scroll': {
              await this.browser.scroll({ direction: step.direction, amount: step.amount });
              await delay(300, undefined, { signal });
              break;
            }
            case 'wait': {
              await this.browser.waitFor({ ms: step.ms, selector: step.selector }, signal);
              break;
            }
            case 'human': {
              await this.tasks.requestHumanIntervention(task.id, {
                reason: 'Langkah job membutuhkan tindakan manusia.',
                message: step.message,
              });
              job.status = 'waiting_human';
              this.store.put('job', job.id, job);
              this.emit();
              return;
            }
            case 'extract': {
              const rows = await this.browser.extractSchema(job.schema);
              const driftReport = this.drift.checkDrift(job.id, job.schema, rows);
              if (driftReport.hasDrift) {
                this.store.put('drift', randomUUID(), driftReport);
                this.reviewQueue.addItem({
                  type: 'schema_drift',
                  jobId: job.id,
                  payload: { fields: driftReport.fields as any },
                  confidence: 0.95,
                });
              }

              const html = await this.browser.getDOM({ format: 'html', maxLength: 50000 }).catch(() => '');
              const snapshotId = randomUUID();
              const collectedAt = new Date().toISOString();
              const snapshot: Snapshot = {
                id: snapshotId,
                jobId: job.id,
                runId: job.runId || '',
                url: target,
                collectedAt,
                rows,
                html,
              };
              this.store.put('snapshot', snapshot.id, snapshot);

              const prior = this.store.list<Snapshot>('snapshot')
                .filter(s => s.jobId === job.id && s.url === target && s.id !== snapshot.id)
                .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))[0];
              if (prior) {
                const diffs = differences(prior.rows, rows, job.schema.identityFields);
                for (const diff of diffs) {
                  this.store.put('change', randomUUID(), {
                    ...diff,
                    jobId: job.id,
                    runId: job.runId || '',
                    url: target,
                    timestamp: Date.now(),
                  });
                }
              }

              for (const row of rows) {
                const record = buildRecord(row, { job, url: target, snapshotId: snapshot.id, collectedAt });
                this.store.addRecord(record);
                if (record.pii || record.quality < 0.4) {
                  this.reviewQueue.addItem({
                    type: record.pii ? 'pii_flag' : 'low_confidence',
                    jobId: job.id,
                    recordId: record.id,
                    payload: row,
                    confidence: record.quality,
                  });
                }
                job.records++;
              }
              break;
            }
          }
        }
        job.cursor++;
        job.step = 0;
        this.store.put('job', job.id, job);
        this.emit();
      }

      job.status = 'completed';
      job.cursor = 0;
      job.step = 0;
      if (job.intervalMinutes) {
        job.nextRunAt = Date.now() + job.intervalMinutes * 60 * 1000;
      }
      this.tasks.completeTask(task.id);
      job.taskId = null;
      this.store.put('job', job.id, job);
      this.emit();
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      throw error;
    }
  }
}
